/**
 * MikrotikApiStrategy — desconecta lease IPoE via RouterOS API (porta 8728/8729).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Único caminho funcional pra disconnect IPoE no Mikrotik (CoA-Disconnect
 * retorna Unsupported-Extension pra DHCP-RADIUS leases).
 *
 * Operação:
 *   1) Connect na API com credentials (cifradas no DB, decifradas em runtime)
 *   2) Procura lease com mac-address={{macAddress}}
 *   3) Remove com /ip/dhcp-server/lease/remove
 *   4) (Opcional) Adiciona IP em /ip/firewall/address-list "netx-blocked"
 *      pra reforço caso re-DHCP imediato.
 *
 * Lib usada: `node-routeros` (https://github.com/aluisiora/routeros-client).
 * Mantemos import dinâmico pra evitar quebra de build quando a lib não
 * estiver instalada — strategy só é instanciada se package presente.
 */
import { Injectable, Logger } from '@nestjs/common';

import { CryptoService } from '../../crypto/crypto.service';
import type {
  DisconnectStrategyExecutor,
  DisconnectResult,
  DisconnectTarget,
} from './types';
import type { NetworkEquipment } from '@prisma/client';

// Tipos mínimos da lib pra não amarrar export — facilita lazy-load
interface RouterOSClient {
  connect(): Promise<void>;
  close(): void;
  write(path: string[]): Promise<unknown[]>;
}

interface RouterOSClientFactory {
  new (opts: {
    host: string;
    port?: number;
    user: string;
    password: string;
    tls?: boolean;
    timeout?: number;
  }): RouterOSClient;
}

@Injectable()
export class MikrotikApiStrategy implements DisconnectStrategyExecutor {
  readonly kind = 'MIKROTIK_API' as const;
  private readonly logger = new Logger(MikrotikApiStrategy.name);
  private clientFactory: RouterOSClientFactory | null = null;
  private libLoadAttempted = false;

  constructor(private readonly crypto: CryptoService) {}

  /**
   * Lazy-load do `node-routeros`. Se não estiver instalado, strategy fica
   * disabled e canHandle() retorna false.
   */
  private async loadLib(): Promise<RouterOSClientFactory | null> {
    if (this.libLoadAttempted) return this.clientFactory;
    this.libLoadAttempted = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('node-routeros');
      // Algumas versões exportam { RouterOSAPI }, outras default
      this.clientFactory =
        (mod.RouterOSAPI as RouterOSClientFactory) ??
        (mod.default as RouterOSClientFactory) ??
        (mod as unknown as RouterOSClientFactory);
      return this.clientFactory;
    } catch {
      this.logger.warn(
        '[MikrotikApi] `node-routeros` não instalado — strategy desabilitada. ' +
          'Rode `npm install node-routeros` no core-service pra habilitar.',
      );
      return null;
    }
  }

  canHandle(equipment: NetworkEquipment, _target: DisconnectTarget): boolean {
    if (equipment.vendor !== 'MIKROTIK') return false;
    if (!equipment.apiUser || !equipment.apiPasswordEnc) return false;
    return true;
  }

  async execute(
    equipment: NetworkEquipment,
    target: DisconnectTarget,
  ): Promise<DisconnectResult> {
    const start = Date.now();
    const base: Omit<DisconnectResult, 'ok'> = {
      strategy: 'MIKROTIK_API',
      equipmentId: equipment.id,
      equipmentName: equipment.name,
      nasIp: equipment.ipAddress,
    };

    if (!target.macAddress && !target.framedIp) {
      return {
        ...base,
        ok: false,
        reason: 'error',
        message:
          'Mikrotik API precisa de macAddress ou framedIp pra localizar a lease',
      };
    }

    const Factory = await this.loadLib();
    if (!Factory) {
      return {
        ...base,
        ok: false,
        reason: 'error',
        message: '`node-routeros` não instalado no core-service',
      };
    }
    if (!equipment.apiUser || !equipment.apiPasswordEnc) {
      return {
        ...base,
        ok: false,
        reason: 'auth-failed',
        message: 'Equipment sem apiUser/apiPassword configurados',
      };
    }

    let password: string;
    try {
      password = this.crypto.decrypt(equipment.apiPasswordEnc);
    } catch (err) {
      return {
        ...base,
        ok: false,
        reason: 'auth-failed',
        message: 'Falha ao decifrar apiPassword — KMS_MASTER_KEY pode ter mudado',
        raw: err instanceof Error ? err.message : String(err),
      };
    }

    const client = new Factory({
      host: equipment.apiHost ?? equipment.ipAddress,
      port: equipment.apiPort ?? (equipment.apiTlsEnabled ? 8729 : 8728),
      user: equipment.apiUser,
      password,
      tls: equipment.apiTlsEnabled,
      timeout: 5,
    });

    try {
      await client.connect();

      // 1) Localiza lease(s) pelo MAC ou IP
      const queryPath = target.macAddress
        ? ['/ip/dhcp-server/lease/print', `?mac-address=${target.macAddress}`]
        : ['/ip/dhcp-server/lease/print', `?address=${target.framedIp}`];
      const leases = (await client.write(queryPath)) as Array<{
        '.id': string;
        'mac-address'?: string;
        address?: string;
      }>;

      if (leases.length === 0) {
        // Sem lease ativa — disconnect é no-op idempotente, retorna ok
        client.close();
        return {
          ...base,
          ok: true,
          message: 'Sem lease ativa (cliente já estava offline)',
          durationMs: Date.now() - start,
        };
      }

      // 2) Remove cada lease encontrada (raro >1, mas trata)
      for (const lease of leases) {
        await client.write([
          '/ip/dhcp-server/lease/remove',
          `=.id=${lease['.id']}`,
        ]);
      }

      client.close();
      return {
        ...base,
        ok: true,
        message: `${leases.length} lease(s) removida(s) via RouterOS API`,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      try {
        client.close();
      } catch {
        // ignore
      }
      const msg = err instanceof Error ? err.message : String(err);
      const isAuth = /login|password|invalid|auth/i.test(msg);
      return {
        ...base,
        ok: false,
        reason: isAuth ? 'auth-failed' : 'error',
        message: msg,
        durationMs: Date.now() - start,
      };
    }
  }

  async testConnectivity(equipment: NetworkEquipment): Promise<{
    ok: boolean;
    message?: string;
  }> {
    if (!equipment.apiUser || !equipment.apiPasswordEnc) {
      return { ok: false, message: 'apiUser/apiPassword não configurados' };
    }
    const Factory = await this.loadLib();
    if (!Factory) {
      return { ok: false, message: '`node-routeros` não instalado' };
    }

    let password: string;
    try {
      password = this.crypto.decrypt(equipment.apiPasswordEnc);
    } catch (err) {
      return {
        ok: false,
        message:
          'Falha ao decifrar apiPassword: ' +
          (err instanceof Error ? err.message : String(err)),
      };
    }

    const client = new Factory({
      host: equipment.apiHost ?? equipment.ipAddress,
      port: equipment.apiPort ?? (equipment.apiTlsEnabled ? 8729 : 8728),
      user: equipment.apiUser,
      password,
      tls: equipment.apiTlsEnabled,
      timeout: 4,
    });

    try {
      await client.connect();
      const identity = await client.write(['/system/identity/print']);
      client.close();
      const name = (identity[0] as { name?: string })?.name ?? 'unknown';
      return { ok: true, message: `Conectado a ${name}` };
    } catch (err) {
      try {
        client.close();
      } catch {
        // ignore
      }
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

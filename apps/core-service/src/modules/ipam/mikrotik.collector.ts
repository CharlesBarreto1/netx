import { Injectable, Logger } from '@nestjs/common';
import type { NetworkEquipment } from '@prisma/client';

import { CryptoService } from '../crypto/crypto.service';
import { detectVersion, ipToBigInt, isValidIp, normalizeIp } from './ip.util';
import type { Observation } from './reconcile.types';

/**
 * Coletor de IPs vivos direto do RouterOS (tabela ARP + leases DHCP).
 *
 * É a única fonte que enxerga IP em uso por quem NÃO passa por RADIUS —
 * impressora, câmera, servidor, roteador de cliente com IP estático posto na
 * mão. Justamente o que costuma sumir da documentação.
 *
 * Mesma abordagem do MikrotikApiStrategy do módulo de disconnect: lazy-load do
 * `node-routeros` (se a lib não estiver instalada o coletor se desabilita em
 * vez de quebrar o build) e credenciais decifradas em runtime pelo KMS.
 *
 * Falha de um equipamento nunca derruba a varredura inteira — cada erro vira
 * um aviso na resposta e os demais seguem.
 */

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

export interface CollectorWarning {
  equipmentId: string;
  equipmentName: string;
  message: string;
}

export interface MikrotikCollectResult {
  observations: Observation[];
  warnings: CollectorWarning[];
}

@Injectable()
export class MikrotikIpCollector {
  private readonly logger = new Logger(MikrotikIpCollector.name);
  private clientFactory: RouterOSClientFactory | null = null;
  private libLoadAttempted = false;

  constructor(private readonly crypto: CryptoService) {}

  private async loadLib(): Promise<RouterOSClientFactory | null> {
    if (this.libLoadAttempted) return this.clientFactory;
    this.libLoadAttempted = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('node-routeros');
      this.clientFactory =
        (mod.RouterOSAPI as RouterOSClientFactory) ??
        (mod.default as RouterOSClientFactory) ??
        (mod as unknown as RouterOSClientFactory);
      return this.clientFactory;
    } catch {
      this.logger.warn('[IpamReconcile] `node-routeros` ausente — coleta ao vivo desabilitada');
      return null;
    }
  }

  /** Equipamento tem o que precisa pra ser consultado? */
  canCollect(e: NetworkEquipment): boolean {
    return e.vendor === 'MIKROTIK' && !!e.apiUser && !!e.apiPasswordEnc;
  }

  async collect(equipments: NetworkEquipment[]): Promise<MikrotikCollectResult> {
    const observations: Observation[] = [];
    const warnings: CollectorWarning[] = [];

    const targets = equipments.filter((e) => this.canCollect(e));
    if (!targets.length) return { observations, warnings };

    const Factory = await this.loadLib();
    if (!Factory) {
      for (const e of targets)
        warnings.push({
          equipmentId: e.id,
          equipmentName: e.name,
          message: '`node-routeros` não instalado no core-service',
        });
      return { observations, warnings };
    }

    for (const e of targets) {
      try {
        observations.push(...(await this.collectOne(Factory, e)));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[IpamReconcile] ${e.name}: ${message}`);
        warnings.push({ equipmentId: e.id, equipmentName: e.name, message });
      }
    }

    return { observations, warnings };
  }

  private async collectOne(
    Factory: RouterOSClientFactory,
    e: NetworkEquipment,
  ): Promise<Observation[]> {
    const password = this.crypto.decrypt(e.apiPasswordEnc!);
    const client = new Factory({
      host: e.apiHost ?? e.ipAddress,
      port: e.apiPort ?? (e.apiTlsEnabled ? 8729 : 8728),
      user: e.apiUser!,
      password,
      tls: e.apiTlsEnabled,
      timeout: 8,
    });

    const out: Observation[] = [];
    try {
      await client.connect();

      const arp = (await client.write(['/ip/arp/print'])) as Array<{
        address?: string;
        'mac-address'?: string;
        interface?: string;
        complete?: string;
      }>;
      for (const row of arp) {
        // Entrada incompleta é ARP sem resposta — não prova IP em uso.
        if (row.complete === 'false') continue;
        const o = this.toObservation(row.address, 'MIKROTIK_ARP', {
          macAddress: row['mac-address'] ?? null,
          detail: `${e.name}${row.interface ? ` · ${row.interface}` : ''}`,
        });
        if (o) out.push(o);
      }

      const leases = (await client.write(['/ip/dhcp-server/lease/print'])) as Array<{
        address?: string;
        'mac-address'?: string;
        'host-name'?: string;
        status?: string;
        server?: string;
      }>;
      for (const row of leases) {
        // Só lease efetivamente entregue; 'waiting'/'offered' ainda não é uso.
        if (row.status && row.status !== 'bound') continue;
        const o = this.toObservation(row.address, 'MIKROTIK_DHCP', {
          macAddress: row['mac-address'] ?? null,
          hostname: row['host-name'] ?? null,
          detail: `${e.name}${row.server ? ` · ${row.server}` : ''}`,
        });
        if (o) out.push(o);
      }
    } finally {
      try {
        client.close();
      } catch {
        /* fechar é best-effort */
      }
    }

    return out;
  }

  private toObservation(
    raw: string | undefined,
    source: Observation['source'],
    extra: Partial<Observation>,
  ): Observation | null {
    if (!raw || !isValidIp(raw)) return null;
    const ip = normalizeIp(raw);
    return {
      ip,
      num: ipToBigInt(ip),
      version: detectVersion(ip),
      source,
      ...extra,
    };
  }
}

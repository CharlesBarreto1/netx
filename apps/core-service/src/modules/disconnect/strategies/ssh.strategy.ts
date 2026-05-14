/**
 * SshDisconnectStrategy — disconnect via comando SSH customizado.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Escape hatch genérico: roda `sshDisconnectCmd` substituindo placeholders.
 * Útil pra:
 *   - Vendors exóticos (ex: Mikrotik via SSH em vez de API)
 *   - BNG Linux com script customizado
 *   - Override de comportamento padrão sem mexer no código
 *
 * Placeholders aceitos no template:
 *   {{macAddress}}     — MAC do cliente (formato AA:BB:CC:DD:EE:FF)
 *   {{macAddressLow}}  — MAC lowercase sem separadores (aabbccddeeff)
 *   {{framedIp}}       — IP atribuído pelo BNG
 *   {{username}}       — pppoeUsername se PPPoE, MAC se IPoE
 *   {{acctSessionId}}  — ID da sessão RADIUS
 *   {{nasIp}}          — IP do próprio equipamento (útil em scripts genéricos)
 *
 * Lib usada: `node-ssh`. Lazy-loaded — strategy disabled se ausente.
 */
import { Injectable, Logger } from '@nestjs/common';

import { CryptoService } from '../../crypto/crypto.service';
import type {
  DisconnectStrategyExecutor,
  DisconnectResult,
  DisconnectTarget,
} from './types';
import type { NetworkEquipment } from '@prisma/client';

interface NodeSshClient {
  connect(opts: {
    host: string;
    port?: number;
    username: string;
    password?: string;
    privateKey?: string;
    readyTimeout?: number;
  }): Promise<NodeSshClient>;
  execCommand(cmd: string): Promise<{ stdout: string; stderr: string; code: number | null }>;
  dispose(): void;
  isConnected(): boolean;
}

interface NodeSshFactory {
  new (): NodeSshClient;
}

@Injectable()
export class SshDisconnectStrategy implements DisconnectStrategyExecutor {
  readonly kind = 'SSH' as const;
  private readonly logger = new Logger(SshDisconnectStrategy.name);
  private factory: NodeSshFactory | null = null;
  private libLoadAttempted = false;

  constructor(private readonly crypto: CryptoService) {}

  private async loadLib(): Promise<NodeSshFactory | null> {
    if (this.libLoadAttempted) return this.factory;
    this.libLoadAttempted = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('node-ssh');
      this.factory =
        (mod.NodeSSH as NodeSshFactory) ?? (mod.default as NodeSshFactory);
      return this.factory;
    } catch {
      this.logger.warn(
        '[SshStrategy] `node-ssh` não instalado — strategy desabilitada.',
      );
      return null;
    }
  }

  canHandle(equipment: NetworkEquipment, _target: DisconnectTarget): boolean {
    if (!equipment.sshDisconnectCmd) return false;
    if (!equipment.sshUser) return false;
    // Precisa de password OU keyName configurado
    return !!(equipment.sshPasswordEnc || equipment.sshKeyName);
  }

  async execute(
    equipment: NetworkEquipment,
    target: DisconnectTarget,
  ): Promise<DisconnectResult> {
    const start = Date.now();
    const base: Omit<DisconnectResult, 'ok'> = {
      strategy: 'SSH',
      equipmentId: equipment.id,
      equipmentName: equipment.name,
      nasIp: equipment.ipAddress,
    };

    const Factory = await this.loadLib();
    if (!Factory) {
      return {
        ...base,
        ok: false,
        reason: 'error',
        message: '`node-ssh` não instalado',
      };
    }
    if (!equipment.sshDisconnectCmd || !equipment.sshUser) {
      return {
        ...base,
        ok: false,
        reason: 'error',
        message: 'sshDisconnectCmd ou sshUser não configurados',
      };
    }

    const cmd = this.interpolate(equipment.sshDisconnectCmd, equipment, target);
    const client = new Factory();

    let password: string | undefined;
    if (equipment.sshPasswordEnc) {
      try {
        password = this.crypto.decrypt(equipment.sshPasswordEnc);
      } catch (err) {
        return {
          ...base,
          ok: false,
          reason: 'auth-failed',
          message: 'Falha ao decifrar sshPassword',
          raw: err instanceof Error ? err.message : String(err),
        };
      }
    }

    // TODO: resolução de sshKeyName → caminho da chave gerenciada
    // Pra MVP, só password é suportado. Key-based auth virá com KeyManager.

    try {
      await client.connect({
        host: equipment.sshHost ?? equipment.ipAddress,
        port: equipment.sshPort ?? 22,
        username: equipment.sshUser,
        password,
        readyTimeout: 5_000,
      });
      const result = await client.execCommand(cmd);
      client.dispose();

      const exitCode = result.code ?? -1;
      const ok = exitCode === 0;
      return {
        ...base,
        ok,
        reason: ok ? undefined : 'error',
        message: ok
          ? `Comando executado (exit ${exitCode})`
          : `Comando retornou exit=${exitCode}`,
        raw: this.truncate(result.stdout + (result.stderr ? `\n${result.stderr}` : '')),
        durationMs: Date.now() - start,
      };
    } catch (err) {
      try {
        client.dispose();
      } catch {
        // ignore
      }
      const msg = err instanceof Error ? err.message : String(err);
      const isAuth = /authentication|password|publickey/i.test(msg);
      const isTimeout = /timed?out|ECONNREFUSED/i.test(msg);
      return {
        ...base,
        ok: false,
        reason: isAuth ? 'auth-failed' : isTimeout ? 'timeout' : 'error',
        message: msg,
        durationMs: Date.now() - start,
      };
    }
  }

  async testConnectivity(equipment: NetworkEquipment): Promise<{
    ok: boolean;
    message?: string;
  }> {
    const Factory = await this.loadLib();
    if (!Factory) return { ok: false, message: '`node-ssh` não instalado' };
    if (!equipment.sshUser) return { ok: false, message: 'sshUser não configurado' };

    let password: string | undefined;
    if (equipment.sshPasswordEnc) {
      try {
        password = this.crypto.decrypt(equipment.sshPasswordEnc);
      } catch (err) {
        return {
          ok: false,
          message: 'Decrypt falhou: ' + (err instanceof Error ? err.message : String(err)),
        };
      }
    }

    const client = new Factory();
    try {
      await client.connect({
        host: equipment.sshHost ?? equipment.ipAddress,
        port: equipment.sshPort ?? 22,
        username: equipment.sshUser,
        password,
        readyTimeout: 4_000,
      });
      const r = await client.execCommand('echo netx-ssh-ok');
      client.dispose();
      const ok = r.code === 0 && r.stdout.includes('netx-ssh-ok');
      return ok
        ? { ok: true, message: 'SSH OK' }
        : { ok: false, message: 'SSH conectou mas echo falhou' };
    } catch (err) {
      try {
        client.dispose();
      } catch {
        // ignore
      }
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────
  private interpolate(
    template: string,
    equipment: NetworkEquipment,
    t: DisconnectTarget,
  ): string {
    const macLow = (t.macAddress ?? '').replace(/[:.\-]/g, '').toLowerCase();
    const replacements: Record<string, string> = {
      '{{macAddress}}': t.macAddress ?? '',
      '{{macAddressLow}}': macLow,
      '{{framedIp}}': t.framedIp ?? '',
      '{{username}}': t.pppoeUsername ?? t.macAddress ?? '',
      '{{acctSessionId}}': t.acctSessionId ?? '',
      '{{nasIp}}': equipment.ipAddress,
    };
    let out = template;
    for (const [key, val] of Object.entries(replacements)) {
      out = out.split(key).join(val);
    }
    return out;
  }

  private truncate(s: string, max = 800): string {
    return s.length > max ? s.slice(0, max) + '… (truncado)' : s;
  }
}

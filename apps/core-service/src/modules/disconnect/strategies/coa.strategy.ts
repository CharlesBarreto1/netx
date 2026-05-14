/**
 * CoaStrategy — Disconnect-Request via RADIUS porta 3799 (RFC 5176).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Suporta:
 *   - Mikrotik PPPoE     ✅ (via User-Name ou Acct-Session-Id)
 *   - Cisco PPPoE/IPoE   ✅ (Acct-Session-Id é o lock principal)
 *   - Juniper PPPoE/IPoE ✅ (Acct-Session-Id + subscriber-id)
 *   - Huawei PPPoE/IPoE  ✅ (Acct-Session-Id + Framed-IP)
 *
 * NÃO suporta:
 *   - Mikrotik IPoE/DHCP ❌ (RouterOS retorna Disconnect-NAK / Unsupported-Extension)
 *     Pra esse caso use MikrotikApiStrategy.
 */
import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';

import type {
  DisconnectStrategyExecutor,
  DisconnectResult,
  DisconnectTarget,
} from './types';
import type { NetworkEquipment } from '@prisma/client';

@Injectable()
export class CoaStrategy implements DisconnectStrategyExecutor {
  readonly kind = 'COA' as const;
  private readonly logger = new Logger(CoaStrategy.name);
  private readonly defaultPort = Number(process.env.RADIUS_COA_PORT ?? 3799);
  private readonly binary = process.env.RADCLIENT_BIN ?? 'radclient';

  /**
   * CoA não funciona em Mikrotik DHCP-IPoE. Pra resto, qualquer vendor com
   * `radiusSecret` configurado é suportado.
   */
  canHandle(equipment: NetworkEquipment, target: DisconnectTarget): boolean {
    if (!equipment.radiusSecret) return false;
    if (equipment.vendor === 'MIKROTIK' && target.authType === 'IPOE') {
      return false; // limitação do RouterOS
    }
    return true;
  }

  async execute(
    equipment: NetworkEquipment,
    target: DisconnectTarget,
  ): Promise<DisconnectResult> {
    const start = Date.now();
    const baseResult: Omit<DisconnectResult, 'ok'> = {
      strategy: 'COA',
      equipmentId: equipment.id,
      equipmentName: equipment.name,
      nasIp: equipment.ipAddress,
    };

    if (!equipment.radiusSecret) {
      return {
        ...baseResult,
        ok: false,
        reason: 'auth-failed',
        message: 'Equipment sem radiusSecret cadastrado',
      };
    }

    const payload = this.buildPayload(equipment, target);
    if (!payload) {
      return {
        ...baseResult,
        ok: false,
        reason: 'error',
        message: 'Sem atributos suficientes pra montar Disconnect-Request',
      };
    }

    const port = equipment.coaPort ?? this.defaultPort;
    const targetHost = `${equipment.ipAddress}:${port}`;

    try {
      const { stdout, stderr } = await this.runRadclient(
        ['-r', '2', '-t', '3', targetHost, 'disconnect', equipment.radiusSecret],
        payload,
      );

      const isAck = /Received Disconnect-ACK/i.test(stdout);
      const isNak = /Received Disconnect-NAK/i.test(stdout);
      const noReply = /No reply from server/i.test(stdout) || stdout.trim() === '';

      if (isAck) {
        return {
          ...baseResult,
          ok: true,
          message: 'Disconnect-ACK recebido',
          durationMs: Date.now() - start,
        };
      }
      if (isNak) {
        const errorCause = stdout.match(/Error-Cause\s*=\s*(\S+)/i)?.[1];
        const isSessionNotFound = /Session-Context-Not-Found/i.test(errorCause ?? '');
        const isUnsupported = /Unsupported-Extension/i.test(errorCause ?? '');
        return {
          ...baseResult,
          ok: false,
          reason: isSessionNotFound
            ? 'session-not-found'
            : isUnsupported
              ? 'not-supported'
              : 'error',
          message: `Disconnect-NAK (Error-Cause=${errorCause ?? 'unknown'})`,
          raw: this.truncate(stdout),
          durationMs: Date.now() - start,
        };
      }
      if (noReply) {
        return {
          ...baseResult,
          ok: false,
          reason: 'timeout',
          message: 'Sem resposta do equipamento (timeout)',
          raw: this.truncate(stdout + stderr),
          durationMs: Date.now() - start,
        };
      }
      return {
        ...baseResult,
        ok: false,
        reason: 'error',
        message: 'Resposta inesperada do radclient',
        raw: this.truncate(stdout + stderr),
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ...baseResult,
        ok: false,
        reason: 'error',
        message: msg,
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Test connectivity = manda CoA com User-Name fictício e espera NAK
   * (significa que canal funciona; ACK não vem porque sessão não existe).
   * Se vier "no reply" → firewall ou serviço down.
   */
  async testConnectivity(equipment: NetworkEquipment): Promise<{
    ok: boolean;
    message?: string;
  }> {
    if (!equipment.radiusSecret) {
      return { ok: false, message: 'Sem radiusSecret configurado' };
    }
    const port = equipment.coaPort ?? this.defaultPort;
    const host = `${equipment.ipAddress}:${port}`;
    try {
      const { stdout } = await this.runRadclient(
        ['-r', '1', '-t', '2', host, 'disconnect', equipment.radiusSecret],
        'User-Name = "__netx_health_check__"\n',
      );
      const respondedAtAll =
        /Received Disconnect-NAK|Received Disconnect-ACK/i.test(stdout);
      return respondedAtAll
        ? { ok: true, message: 'Equipamento respondeu (CoA channel OK)' }
        : { ok: false, message: 'Sem resposta — verifique firewall e secret' };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Payload builder — atributos por vendor
  // ───────────────────────────────────────────────────────────────────────
  /**
   * Monta o payload de atributos RADIUS apropriado pro vendor.
   * Retorna `null` se faltam dados essenciais.
   */
  private buildPayload(
    equipment: NetworkEquipment,
    t: DisconnectTarget,
  ): string | null {
    const lines: string[] = [];

    switch (equipment.vendor) {
      case 'CISCO': {
        // Cisco ASR9k/ASR1k: Acct-Session-Id é o ID primário pra IPoE.
        // PPPoE também usa Acct-Session-Id, com fallback pra User-Name.
        if (t.acctSessionId) lines.push(`Acct-Session-Id = "${t.acctSessionId}"`);
        else if (t.pppoeUsername)
          lines.push(`User-Name = "${t.pppoeUsername}"`);
        else if (t.framedIp) lines.push(`Framed-IP-Address = ${t.framedIp}`);
        break;
      }
      case 'JUNIPER': {
        // Juniper MX: usa Acct-Session-Id + atributo VSA ERX (subscriber).
        // Em IPoE/DHCP, framed-ip é fortemente útil pra desambiguar.
        if (t.acctSessionId) lines.push(`Acct-Session-Id = "${t.acctSessionId}"`);
        if (t.subscriberId)
          lines.push(`ERX-Pppoe-Description = "${t.subscriberId}"`);
        if (t.framedIp) lines.push(`Framed-IP-Address = ${t.framedIp}`);
        if (lines.length === 0 && t.pppoeUsername)
          lines.push(`User-Name = "${t.pppoeUsername}"`);
        break;
      }
      case 'HUAWEI': {
        // Huawei NE/ME/MA: Acct-Session-Id padrão + Framed-IP, com vendor-attr
        // pra domínio se especificado.
        if (t.acctSessionId) lines.push(`Acct-Session-Id = "${t.acctSessionId}"`);
        if (t.framedIp) lines.push(`Framed-IP-Address = ${t.framedIp}`);
        if (lines.length === 0 && t.pppoeUsername)
          lines.push(`User-Name = "${t.pppoeUsername}"`);
        break;
      }
      case 'MIKROTIK': {
        // PPPoE only (IPoE foi recusado por canHandle()).
        // User-Name é o login PPPoE.
        if (t.pppoeUsername) lines.push(`User-Name = "${t.pppoeUsername}"`);
        else if (t.acctSessionId)
          lines.push(`Acct-Session-Id = "${t.acctSessionId}"`);
        break;
      }
      default: {
        // OTHER / ZTE / FIBERHOME — best-effort com tudo que tiver.
        if (t.acctSessionId) lines.push(`Acct-Session-Id = "${t.acctSessionId}"`);
        if (t.pppoeUsername) lines.push(`User-Name = "${t.pppoeUsername}"`);
        else if (t.macAddress) lines.push(`User-Name = "${t.macAddress}"`);
        if (t.framedIp) lines.push(`Framed-IP-Address = ${t.framedIp}`);
        if (t.callingStationId)
          lines.push(`Calling-Station-Id = "${t.callingStationId}"`);
      }
    }

    return lines.length > 0 ? lines.join('\n') + '\n' : null;
  }

  private runRadclient(
    args: string[],
    payload: string,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        this.binary,
        args,
        { timeout: 8000 },
        (err, stdout, stderr) => {
          if (err && !stdout) {
            reject(new Error(`${stderr || err.message}`.trim()));
            return;
          }
          resolve({ stdout: String(stdout), stderr: String(stderr) });
        },
      );
      child.stdin?.write(payload);
      child.stdin?.end();
    });
  }

  private truncate(s: string, max = 400): string {
    return s.length > max ? s.slice(0, max) + '… (truncado)' : s;
  }
}

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
import { createHash } from 'crypto';

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
    /**
     * ssh2 underlying option — chamado com a host key apresentada pelo servidor.
     * Retornar false aborta o handshake antes de enviar credenciais.
     */
    hostVerifier?: (hashedKey: Buffer | string) => boolean;
  }): Promise<NodeSshClient>;
  execCommand(cmd: string): Promise<{ stdout: string; stderr: string; code: number | null }>;
  dispose(): void;
  isConnected(): boolean;
}

/**
 * Regex de whitelist por placeholder. Valores que NÃO casarem são rejeitados
 * antes de chegar no `execCommand` — defesa contra command injection via
 * PPPoE-username/MAC/etc maliciosos. Permitir apenas chars seguros pra shell:
 * letras, dígitos, `:`, `.`, `_`, `-`, `@`. Sem espaços, sem aspas, sem `;`,
 * sem `$`, sem backticks, sem nada que possa quebrar quoting.
 */
const PLACEHOLDER_VALIDATORS: Record<string, RegExp> = {
  '{{macAddress}}': /^[0-9A-Fa-f:.\-]{0,32}$/,
  '{{macAddressLow}}': /^[0-9a-f]{0,16}$/,
  '{{framedIp}}': /^[0-9A-Fa-f:.]{0,45}$/, // IPv4 ou IPv6
  '{{username}}': /^[A-Za-z0-9._@\-]{0,128}$/,
  '{{acctSessionId}}': /^[A-Za-z0-9._\-]{0,64}$/,
  '{{nasIp}}': /^[0-9A-Fa-f:.]{0,45}$/,
};

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

    // Anti-MITM: sshHostKey é obrigatório. Sem ele, qualquer máquina no
    // caminho de rede entre core-service e o BNG consegue se passar pelo
    // equipamento e capturar a sshPassword decifrada. Operador cadastra
    // primeiro via test-connectivity (que faz TOFU explícito).
    if (!equipment.sshHostKey) {
      return {
        ...base,
        ok: false,
        reason: 'auth-failed',
        message:
          'sshHostKey ausente — rode test-connectivity primeiro pra capturar o fingerprint do equipamento.',
      };
    }

    // Anti-RCE: valida placeholders ANTES de qualquer execução. Se um valor
    // contém shell metachars, rejeita aqui em vez de injetar no comando.
    let cmd: string;
    try {
      cmd = this.interpolate(equipment.sshDisconnectCmd, equipment, target);
    } catch (err) {
      return {
        ...base,
        ok: false,
        reason: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }

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

    const expectedHostKey = equipment.sshHostKey;
    try {
      await client.connect({
        host: equipment.sshHost ?? equipment.ipAddress,
        port: equipment.sshPort ?? 22,
        username: equipment.sshUser,
        password,
        readyTimeout: 5_000,
        hostVerifier: (key) => verifyHostKey(key, expectedHostKey),
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
    /**
     * Fingerprint capturado durante TOFU (sshHostKey ausente no equipamento).
     * Frontend deve apresentar pro operador confirmar antes de salvar via
     * UPDATE em network_equipment.sshHostKey. Não usado quando já há
     * fingerprint cadastrado (que é validado estritamente).
     */
    capturedHostKey?: string;
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

    let capturedHostKey: string | undefined;
    const expectedHostKey = equipment.sshHostKey;

    const client = new Factory();
    try {
      await client.connect({
        host: equipment.sshHost ?? equipment.ipAddress,
        port: equipment.sshPort ?? 22,
        username: equipment.sshUser,
        password,
        readyTimeout: 4_000,
        hostVerifier: (key) => {
          if (!expectedHostKey) {
            // TOFU: captura o fingerprint pra o operador confirmar. Aceita
            // a conexão pra que possamos validar credenciais também.
            capturedHostKey = computeFingerprint(key);
            return true;
          }
          return verifyHostKey(key, expectedHostKey);
        },
      });
      const r = await client.execCommand('echo netx-ssh-ok');
      client.dispose();
      const ok = r.code === 0 && r.stdout.includes('netx-ssh-ok');
      return ok
        ? { ok: true, message: 'SSH OK', capturedHostKey }
        : { ok: false, message: 'SSH conectou mas echo falhou', capturedHostKey };
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

  /**
   * Substitui placeholders no template. Cada valor é validado contra um
   * whitelist regex específico do placeholder — se algum valor contém char
   * fora do whitelist (shell metachar, espaço, aspas, etc), LANÇA antes de
   * qualquer interpolação. Isso bloqueia command injection via PPPoE-username
   * malicioso (ex: `admin"; rm -rf /`) que vem de input não-confiável.
   */
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

    // Validação estrita ANTES de qualquer substring replace.
    for (const [key, val] of Object.entries(replacements)) {
      // Só valida placeholders que estão de fato no template — se o operador
      // não usa {{nasIp}}, não importa o que ipAddress contém.
      if (!template.includes(key)) continue;
      const validator = PLACEHOLDER_VALIDATORS[key];
      if (!validator) {
        throw new Error(`SSH interpolate: placeholder ${key} sem validator registrado`);
      }
      if (!validator.test(val)) {
        throw new Error(
          `SSH interpolate: valor de ${key} contém caracteres inválidos (anti-RCE). ` +
            `Valor rejeitado: ${JSON.stringify(val.slice(0, 32))}`,
        );
      }
    }

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

/**
 * Calcula fingerprint SHA256 base64 da host key apresentada pelo servidor.
 * Formato `SHA256:<base64>` — mesmo de `ssh-keygen -lf` e known_hosts.
 * Compatível com Buffer (ssh2 ≥1) e string (versões antigas).
 */
function computeFingerprint(key: Buffer | string): string {
  const buf = typeof key === 'string' ? Buffer.from(key, 'binary') : key;
  // Remove o padding `=` igual ssh-keygen faz.
  const b64 = createHash('sha256').update(buf).digest('base64').replace(/=+$/, '');
  return `SHA256:${b64}`;
}

/**
 * Compara fingerprint computado contra o esperado (constant-time).
 */
function verifyHostKey(key: Buffer | string, expected: string): boolean {
  const actual = computeFingerprint(key);
  if (actual.length !== expected.length) return false;
  // Comparação byte-a-byte sem early-exit (timing-safe pra strings curtas).
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

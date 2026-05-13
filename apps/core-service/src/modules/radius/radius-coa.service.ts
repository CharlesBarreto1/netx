import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Resultado de um envio CoA Disconnect.
 */
export interface CoAResult {
  nasIp: string;
  ok: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
}

/**
 * Atributos pra construir o Disconnect-Request. Pelo menos um identificador
 * deve estar presente. Mikrotik aceita:
 *   - User-Name (PPPoE login OU MAC pra IPoE)
 *   - Acct-Session-Id (mais confiável quando há sessão ativa)
 *   - Framed-IP-Address (fallback pra IPoE)
 */
export interface CoATarget {
  userName?: string | null;
  acctSessionId?: string | null;
  framedIp?: string | null;
  callingStationId?: string | null;
}

/**
 * Contrato simplificado pra disparar CoA — campos relevantes pra match.
 */
export interface ContractCoAInput {
  pppoeUsername?: string | null;
  macAddress?: string | null;
  circuitId?: string | null;
}

/**
 * Envia Disconnect-Request (CoA) via `radclient` para todos os NASes candidatos.
 *
 * Estratégia:
 *   - Se existe sessão ativa em `radius.radacct` (acctstoptime IS NULL) para o
 *     usuário, manda CoA apenas para o NAS que detém a sessão (mais rápido).
 *   - Caso contrário, manda para todos os NASes cadastrados em `radius.nas`.
 *
 * Binário `radclient` vem com o pacote `freeradius-utils`.
 * Porta padrão CoA no RouterOS é 3799.
 */
@Injectable()
export class RadiusCoAService {
  private readonly logger = new Logger(RadiusCoAService.name);
  private readonly coaPort = Number(process.env.RADIUS_COA_PORT ?? 3799);
  private readonly binary = process.env.RADCLIENT_BIN ?? 'radclient';

  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────────────────────────────────────────────────────
  // API pública nova — recebe o contrato e decide o melhor identificador
  // ───────────────────────────────────────────────────────────────────────
  /**
   * Disconnect baseado no contrato (cobre PPPoE e IPoE/MAC).
   * Resolve a sessão ativa em radacct pra extrair Acct-Session-Id e NAS IP
   * (mais confiável que mandar só User-Name). Se não houver sessão ativa,
   * cai no fallback de mandar User-Name pra todos os NASes.
   */
  async disconnectContract(c: ContractCoAInput): Promise<CoAResult[]> {
    // Identificadores possíveis pra match em radacct.
    const usernames: string[] = [];
    if (c.pppoeUsername) usernames.push(c.pppoeUsername);
    if (c.macAddress) {
      usernames.push(c.macAddress);
      usernames.push(c.macAddress.toLowerCase());
    }
    if (c.circuitId) usernames.push(c.circuitId);

    const normalizedMac = (c.macAddress ?? '')
      .replace(/^[0-9]+:/, '')
      .replace(/[:\-.]/g, '')
      .toLowerCase();

    if (usernames.length === 0 && !normalizedMac) {
      throw new Error(
        'Contrato sem identificador RADIUS — preencha pppoeUsername, macAddress ou circuitId',
      );
    }

    // Busca sessão ativa pra pegar acctsessionid + nasipaddress + framedip.
    // Match com normalização (cobre `1:b8:9f:..` do Mikrotik).
    const sessions = await this.prisma.$queryRawUnsafe<
      Array<{
        nasipaddress: string;
        acctsessionid: string | null;
        framedipaddress: string | null;
        username: string | null;
        callingstationid: string | null;
      }>
    >(
      `SELECT host(nasipaddress) AS nasipaddress,
              acctsessionid, framedipaddress, username, callingstationid
         FROM radius.radacct
        WHERE acctstoptime IS NULL
          AND (
                username = ANY($1::text[])
             OR ($2 <> '' AND LOWER(REGEXP_REPLACE(
                  REGEXP_REPLACE(callingstationid, '^[0-9]+:', ''),
                  '[:\\-.]', '', 'g')) = $2)
             OR ($2 <> '' AND LOWER(REGEXP_REPLACE(
                  REGEXP_REPLACE(username, '^[0-9]+:', ''),
                  '[:\\-.]', '', 'g')) = $2)
              )`,
      usernames,
      normalizedMac,
    );

    const nasRows = await this.prisma.$queryRawUnsafe<
      Array<{ nasname: string; secret: string }>
    >(`SELECT nasname, secret FROM radius.nas`);

    if (nasRows.length === 0) {
      this.logger.warn('[CoA] nenhum NAS cadastrado em radius.nas');
      return [];
    }

    // Se achou sessão ativa, manda CoA com Acct-Session-Id pro NAS dela.
    if (sessions.length > 0) {
      const results: CoAResult[] = [];
      for (const s of sessions) {
        const nas = nasRows.find((n) => n.nasname === s.nasipaddress);
        if (!nas) {
          this.logger.warn(
            `[CoA] sessão ativa em ${s.nasipaddress} mas NAS não cadastrado — pulando`,
          );
          continue;
        }
        const target: CoATarget = {
          userName: s.username ?? c.pppoeUsername ?? c.macAddress ?? null,
          acctSessionId: s.acctsessionid,
          framedIp: s.framedipaddress,
          callingStationId: s.callingstationid,
        };
        results.push(await this.sendOne(nas.nasname, nas.secret, target));
      }
      return results;
    }

    // Fallback: sem sessão ativa, manda User-Name pra todos NASes
    // (Mikrotik retorna Disconnect-NAK pro que não tem a sessão, ok).
    const userName =
      c.pppoeUsername ?? c.macAddress ?? c.circuitId ?? null;
    if (!userName) return [];

    this.logger.log(
      `[CoA] sem sessão ativa pra ${userName} — fallback broadcast pros NASes`,
    );
    const results: CoAResult[] = [];
    for (const t of nasRows) {
      results.push(
        await this.sendOne(t.nasname, t.secret, { userName }),
      );
    }
    return results;
  }

  /**
   * Dispara Disconnect-Request para o username em todos os NASes relevantes.
   * Resolve sempre — falhas individuais ficam em `result.error` para logging;
   * não lança.
   */
  async disconnect(pppoeUsername: string): Promise<CoAResult[]> {
    if (!pppoeUsername) return [];

    // 1) Tenta localizar sessão ativa no accounting
    const activeRows = await this.prisma.$queryRawUnsafe<
      Array<{ nasipaddress: string }>
    >(
      `SELECT DISTINCT host(nasipaddress) AS nasipaddress
         FROM radius.radacct
        WHERE username = $1 AND acctstoptime IS NULL`,
      pppoeUsername,
    );

    const targetIps = activeRows.map((r) => r.nasipaddress);

    // 2) Lê os NASes (para pegar o shared secret; e opcionalmente fallback)
    const nasRows = await this.prisma.$queryRawUnsafe<
      Array<{ nasname: string; secret: string }>
    >(
      `SELECT nasname, secret FROM radius.nas`,
    );

    if (nasRows.length === 0) {
      this.logger.warn(
        `[CoA] nenhum NAS cadastrado em radius.nas — pulando disconnect de ${pppoeUsername}`,
      );
      return [];
    }

    // Fallback: sem sessão ativa, manda pra todos (Mikrotik responde nack pro
    // que não tem a sessão, ok).
    const targets =
      targetIps.length > 0
        ? nasRows.filter((n) => targetIps.includes(n.nasname))
        : nasRows;

    // Se o IP da sessão ativa não bate com nenhuma entrada em `nas`
    // (desalinhamento de cadastro), cai pro fallback de "tudo".
    const effectiveTargets = targets.length > 0 ? targets : nasRows;

    const results: CoAResult[] = [];
    for (const t of effectiveTargets) {
      const r = await this.sendOne(t.nasname, t.secret, pppoeUsername);
      results.push(r);
    }
    return results;
  }

  private async sendOne(
    nasIp: string,
    secret: string,
    target: CoATarget | string,
  ): Promise<CoAResult> {
    // radclient lê os atributos do stdin.
    // `-r 2` retries, `-t 3` timeout em segundos, `-x` verbose
    const targetHost = `${nasIp}:${this.coaPort}`;
    const t: CoATarget =
      typeof target === 'string' ? { userName: target } : target;

    // Constrói payload com atributos disponíveis. Acct-Session-Id é o mais
    // confiável; demais ajudam o Mikrotik a localizar a sessão certa.
    const lines: string[] = [];
    if (t.userName) lines.push(`User-Name = "${t.userName}"`);
    if (t.acctSessionId)
      lines.push(`Acct-Session-Id = "${t.acctSessionId}"`);
    if (t.framedIp) lines.push(`Framed-IP-Address = ${t.framedIp}`);
    if (t.callingStationId)
      lines.push(`Calling-Station-Id = "${t.callingStationId}"`);
    if (lines.length === 0) {
      return {
        nasIp,
        ok: false,
        error: 'CoA target vazio — nenhum atributo pra enviar',
      };
    }
    const payload = lines.join('\n') + '\n';
    const username =
      t.userName ?? t.acctSessionId ?? t.framedIp ?? '<unknown>';

    try {
      const { stdout, stderr } = await this.runWithInput(
        this.binary,
        ['-r', '2', '-t', '3', targetHost, 'disconnect', secret],
        payload,
      );
      const ok = /Received Disconnect-ACK/i.test(stdout);
      if (!ok) {
        this.logger.warn(
          `[CoA] ${nasIp} user=${username} nack/timeout — stdout=${stdout.trim().slice(0, 200)}`,
        );
      }
      return { nasIp, ok, stdout, stderr };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[CoA] ${nasIp} user=${username} erro: ${msg}`);
      return { nasIp, ok: false, error: msg };
    }
  }

  /** execFile sem shell, passando payload via stdin. */
  private runWithInput(
    cmd: string,
    args: string[],
    input: string,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = execFile(cmd, args, { timeout: 8000 }, (err, stdout, stderr) => {
        if (err) {
          // radclient retorna exit=0 em sucesso; outro valor vira erro aqui
          const merged = `${stderr || ''}\n${stdout || ''}`.trim();
          reject(new Error(merged || err.message));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      });
      child.stdin?.write(input);
      child.stdin?.end();
    });
  }
}

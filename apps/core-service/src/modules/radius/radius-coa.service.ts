import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { PrismaService } from '../prisma/prisma.service';

const execFileAsync = promisify(execFile);

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
    username: string,
  ): Promise<CoAResult> {
    // radclient lê os atributos do stdin.
    // `-r 2` retries, `-t 3` timeout em segundos, `-x` verbose
    const target = `${nasIp}:${this.coaPort}`;
    const payload = `User-Name = "${username}"\n`;

    try {
      const { stdout, stderr } = await this.runWithInput(
        this.binary,
        ['-r', '2', '-t', '3', target, 'disconnect', secret],
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

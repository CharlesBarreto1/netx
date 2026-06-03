/**
 * Endpoint HTTP/SOAP do ACS — recebe POST /cwmp do CPE.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import {
  All,
  Controller,
  Get,
  HttpException,
  Logger,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { CwmpSessionService } from './cwmp-session.service';

const SESSION_COOKIE = 'cwmp.session';

@Controller()
export class CwmpController {
  private readonly logger = new Logger(CwmpController.name);

  constructor(private readonly session: CwmpSessionService) {}

  /**
   * Catch-all CWMP endpoint. CPEs Huawei mandam pra `/` ou `/cwmp` —
   * aceitamos ambos por flexibilidade. Body é XML cru (parsed por
   * express.raw() no main.ts).
   */
  @All(['/cwmp', '/cwmp/*', '/'])
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.status(405).send('Method Not Allowed');
      return;
    }
    if (req.method === 'GET') {
      res.status(200).type('text/plain').send('NetX ACS — CWMP/TR-069 endpoint OK');
      return;
    }

    // Auth opcional (default OFF). Quando CWMP_AUTH_USER está setado, exige
    // Basic auth — as CPEs autenticam com ManagementServer.Username/Password.
    // ⚠️ Antes de habilitar, provisione essas credenciais nos CPEs (SET_PARAMS),
    // senão todos tomam 401 e param de informar.
    if (!this.checkAuth(req)) {
      res
        .status(401)
        .set('WWW-Authenticate', 'Basic realm="NetX ACS"')
        .send('Unauthorized');
      return;
    }

    const rawBody = (req.body as Buffer | undefined) ?? Buffer.alloc(0);
    const xml = rawBody.toString('utf8');
    const sessionId = this.extractSessionCookie(req);

    try {
      const result = await this.session.handle(xml, sessionId);

      // Renova cookie em toda response (CPE persiste durante a session HTTP).
      res.cookie(SESSION_COOKIE, result.sessionId, {
        httpOnly: true,
        path: '/',
        sameSite: 'strict',
      });
      res.status(result.status);
      if (result.xml) {
        res.type('text/xml; charset=utf-8').send(result.xml);
      } else {
        res.end();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[CWMP] handler error: ${msg}`, err instanceof Error ? err.stack : undefined);
      if (err instanceof HttpException) {
        res.status(err.getStatus()).send(err.message);
      } else {
        res.status(500).send('Internal CWMP error');
      }
    }
  }

  /** Health pra monitoramento / status do daemon. */
  @Get('/health')
  health() {
    const stats = this.session.getStats();
    return {
      status: 'ok',
      service: 'cwmp-server',
      cwmpVersion: '1-0',
      ...stats,
    };
  }

  /** Valida Basic auth quando CWMP_AUTH_USER está configurado (senão libera). */
  private checkAuth(req: Request): boolean {
    const user = process.env.CWMP_AUTH_USER;
    const pass = process.env.CWMP_AUTH_PASSWORD ?? '';
    if (!user) return true; // auth desligada
    const header = req.headers.authorization ?? '';
    if (!/^Basic /i.test(header)) return false;
    try {
      const [u, p] = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8').split(':');
      return u === user && (p ?? '') === pass;
    } catch {
      return false;
    }
  }

  private extractSessionCookie(req: Request): string | null {
    // Express trustando cookie-parser teria req.cookies, mas pra evitar deps
    // extras, parseamos manualmente. Header simples key=value;key2=value2.
    const header = req.headers.cookie;
    if (!header) return null;
    for (const part of header.split(';')) {
      const [k, v] = part.trim().split('=');
      if (k === SESSION_COOKIE && v) return decodeURIComponent(v);
    }
    return null;
  }
}

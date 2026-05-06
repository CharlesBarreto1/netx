import { HttpService } from '@nestjs/axios';
import { Injectable, HttpException } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import type { Request } from 'express';

import { loadConfig } from '@netx/config';

export interface ProxyResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

@Injectable()
export class ProxyService {
  private readonly config = loadConfig();

  constructor(private readonly http: HttpService) {}

  /**
   * Forward an incoming request to the Core service, preserving method, path,
   * headers (sans hop-by-hop), body, and query string.
   */
  async forwardToCore(req: Request, targetPath: string): Promise<ProxyResult> {
    const base = `http://${this.config.coreService.host}:${this.config.coreService.port}`;
    const url = `${base}${targetPath}`;

    const forwardedHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!v) continue;
      if (['host', 'connection', 'content-length', 'transfer-encoding'].includes(k)) continue;
      forwardedHeaders[k] = Array.isArray(v) ? v.join(', ') : (v as string);
    }
    // Always propagate tenant and correlation context
    if (req.headers['x-correlation-id']) {
      forwardedHeaders['x-correlation-id'] = req.headers['x-correlation-id'] as string;
    }
    // Garantir IP real do cliente. Quando vem via Nginx, X-Forwarded-For já
    // está populado e é só repassar. Quando o gateway recebe direto (dev,
    // healthcheck), `req.ip` aqui já está correto graças ao trust proxy do
    // gateway. Forçamos o header pra que o core-service NUNCA veja
    // 127.0.0.1 (que era o caso antes — log de auditoria com IP do
    // gateway ao invés do cliente).
    const clientIp = req.ip;
    if (clientIp) {
      const existing = forwardedHeaders['x-forwarded-for'];
      forwardedHeaders['x-forwarded-for'] = existing
        ? `${existing}, ${clientIp}`
        : clientIp;
    }
    if (!forwardedHeaders['x-real-ip'] && clientIp) {
      forwardedHeaders['x-real-ip'] = clientIp;
    }

    try {
      const res = await firstValueFrom(
        this.http.request({
          method: req.method,
          url,
          headers: forwardedHeaders,
          // NÃO passar `params: req.query` — `targetPath` já carrega a query
          // string (vem de `req.originalUrl`). Se passar de novo, o axios faz
          // append e duplica cada parâmetro (`?page=1&pageSize=20&page=1&pageSize=20`),
          // o que o Express do core parseia como `{ page: ['1','1'] }`. Aí o
          // `z.coerce.number()` recebe array e devolve `NaN`, retornando 400
          // "Expected number, received nan".
          data: req.body,
          validateStatus: () => true, // never throw on 4xx/5xx
          timeout: 15_000,
        }),
      );
      return { status: res.status, headers: res.headers as any, body: res.data };
    } catch (err: any) {
      throw new HttpException(
        {
          type: 'urn:netx:error:upstream-unreachable',
          title: 'Upstream unavailable',
          detail: err?.message ?? 'core-service unreachable',
        },
        502,
      );
    }
  }
}

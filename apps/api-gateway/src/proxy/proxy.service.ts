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

    try {
      const res = await firstValueFrom(
        this.http.request({
          method: req.method,
          url,
          headers: forwardedHeaders,
          params: req.query,
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

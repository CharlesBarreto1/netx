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

    // Headers que NÃO repassamos pro core-service:
    //
    // - Hop-by-hop standard (RFC 7230 §6.1): host, connection, content-length,
    //   transfer-encoding — proxy não deve forwardar.
    //
    // - Tenant/auth headers controlados pelo gateway/core: o gateway NÃO
    //   resolve tenant — quem decide é o core-service via TENANT_RESOLUTION_STRATEGY
    //   (subdomain | header | jwt). Se o cliente envia `x-tenant-id` num cenário
    //   onde a strategy é `subdomain` ou `jwt`, ele tentaria forçar tenant
    //   arbitrário. Stripping aqui é defesa em profundidade — qualquer cliente
    //   que precise setar tenant via header DEVE estar com TENANT_RESOLUTION_STRATEGY=header
    //   explicitamente (e nesse caso o gateway propaga normalmente, vide config).
    //
    // - `x-forwarded-*` exceto os que renomeamos: cliente NÃO deveria poder
    //   spoofar o IP visto pelo backend. Sobrescrevemos com `req.ip` mais abaixo.
    const STRIP_HEADERS = new Set([
      'host',
      'connection',
      'content-length',
      'transfer-encoding',
      'x-real-ip',
      'x-forwarded-for',
      'x-forwarded-host',
      'x-forwarded-proto',
    ]);
    const tenancyStrategy = this.config.tenancy.strategy;
    const tenantHeader = this.config.tenancy.headerName.toLowerCase();

    const forwardedHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!v) continue;
      const key = k.toLowerCase();
      if (STRIP_HEADERS.has(key)) continue;
      // Strip do header de tenant quando a strategy NÃO é `header` —
      // impede um cliente de forçar tenant arbitrário via header injection.
      if (key === tenantHeader && tenancyStrategy !== 'header') continue;
      forwardedHeaders[key] = Array.isArray(v) ? v.join(', ') : (v as string);
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

    // Multipart (uploads, ex.: import KMZ/KML, fotos): o Express do gateway NÃO
    // parseia multipart, então `req.body` fica vazio. Re-enviar `req.body` aqui
    // mandaria um corpo vazio com o header `multipart/...; boundary=...`, e o
    // busboy do core estoura "Multipart: Unexpected end of form". Pra esses, o
    // gateway transmite o STREAM cru do request (o body ainda não foi consumido,
    // pois json/urlencoded só leem seus próprios content-types). Demais
    // requests seguem com o body já parseado (JSON/urlencoded).
    const contentType = (req.headers['content-type'] ?? '').toString().toLowerCase();
    const isMultipart = contentType.includes('multipart/form-data');
    // Rotas que falam com integrações externas lentas (Ufinet: cadeia
    // orquestrador→NCS→OLT→ONT) precisam de mais que os 15s padrão — só a ONT
    // responder já passa disso. Timeout ampliado SÓ pra elas; resto segue 15s.
    const isSlowExternal = /\/v1\/ufinet\/.*ont-action/.test(targetPath);

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
          data: isMultipart ? req : req.body,
          // Streams de upload não devem ser limitados pelo axios (o core aplica
          // o limite real via multer). Sem buffering — o stream é repassado.
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          validateStatus: () => true, // never throw on 4xx/5xx
          timeout: isMultipart ? 60_000 : isSlowExternal ? 90_000 : 15_000,
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

import { HttpService } from '@nestjs/axios';
import { Injectable, HttpException } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import type { Request, Response } from 'express';
import type { Readable } from 'node:stream';

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
    return this.forward(req, base, targetPath);
  }

  /**
   * Forward to the NMS module (apps/nms — canal 4 do ecossistema). Mesmo
   * tratamento de headers/stream do Core; só muda o destino. O Bearer do
   * operador é preservado (não está no STRIP), então o SSO do NMS valida o
   * mesmo token (canal 1).
   */
  async forwardToNms(req: Request, targetPath: string): Promise<ProxyResult> {
    const base = `http://${this.config.nmsService.host}:${this.config.nmsService.port}`;
    // Endpoints do NMS que ESPERAM o device-gateway falar com o equipamento (SSH/NETCONF/
    // SNMP) podem levar dezenas de segundos — mais que os 15s padrão. Num device
    // inalcançável, só os timeouts de SSH+NETCONF+SNMP já passam de 20s; o apply espera
    // até 90s no NMS. Sem folga aqui, o proxy corta antes e devolve 502 (confundindo
    // "device não respondeu" com "NMS fora do ar"). Timeout ampliado só pra essas rotas.
    const isSlowDeviceOp =
      /\/devices\/[^/]+\/(connectivity-test|backup|discover-interfaces|snmp-config\/sync|config\/(plan|apply|confirm)|playbooks\/[^/]+\/run)$/.test(
        targetPath,
      );
    return this.forward(req, base, targetPath, isSlowDeviceOp ? 100_000 : undefined);
  }

  /**
   * Monta os headers repassados ao backend, removendo hop-by-hop e headers de
   * tenant/IP que o cliente não pode spoofar.
   *
   * - Hop-by-hop standard (RFC 7230 §6.1): host, connection, content-length,
   *   transfer-encoding — proxy não deve forwardar.
   * - Tenant header: removido quando a strategy NÃO é `header` (defesa contra
   *   header injection de tenant arbitrário).
   * - `x-forwarded-*`/`x-real-ip`: sobrescritos com `req.ip` (anti-spoof).
   */
  private buildForwardedHeaders(req: Request): Record<string, string> {
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
      if (key === tenantHeader && tenancyStrategy !== 'header') continue;
      forwardedHeaders[key] = Array.isArray(v) ? v.join(', ') : (v as string);
    }
    if (req.headers['x-correlation-id']) {
      forwardedHeaders['x-correlation-id'] = req.headers['x-correlation-id'] as string;
    }
    const clientIp = req.ip;
    if (clientIp) {
      const existing = forwardedHeaders['x-forwarded-for'];
      forwardedHeaders['x-forwarded-for'] = existing ? `${existing}, ${clientIp}` : clientIp;
    }
    if (!forwardedHeaders['x-real-ip'] && clientIp) {
      forwardedHeaders['x-real-ip'] = clientIp;
    }
    return forwardedHeaders;
  }

  /** Encaminha o Core como STREAM (SSE) — pipe direto, sem buffering nem timeout. */
  streamFromCore(req: Request, res: Response, targetPath: string): Promise<void> {
    const base = `http://${this.config.coreService.host}:${this.config.coreService.port}`;
    return this.streamResponse(req, res, base, targetPath);
  }

  /**
   * Repassa uma resposta de streaming (Server-Sent Events) sem bufferizar.
   *
   * O `forward()` normal usa `firstValueFrom` + timeout, que NUNCA resolve num
   * stream infinito (SSE) — a conexão estoura em 15s e o EventSource do cliente
   * fica reconectando sem receber eventos (o chat só atualizava no reload).
   *
   * Aqui pedimos `responseType: 'stream'`, timeout 0, e damos `pipe` direto.
   * `X-Accel-Buffering: no` diz ao Nginx pra não bufferizar a resposta. Ao
   * cliente desconectar, abortamos o upstream.
   */
  private async streamResponse(
    req: Request,
    res: Response,
    base: string,
    targetPath: string,
  ): Promise<void> {
    const url = `${base}${targetPath}`;
    const controller = new AbortController();
    req.on('close', () => controller.abort());

    try {
      const upstream = await firstValueFrom(
        this.http.request<Readable>({
          method: req.method,
          url,
          headers: this.buildForwardedHeaders(req),
          responseType: 'stream',
          timeout: 0,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          validateStatus: () => true,
          signal: controller.signal,
        }),
      );

      res.status(upstream.status);
      res.setHeader('Content-Type', (upstream.headers['content-type'] as string) ?? 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Nginx: não bufferizar
      res.flushHeaders?.();

      const stream = upstream.data;
      stream.pipe(res);
      stream.on('error', () => res.end());
      stream.on('end', () => res.end());
      res.on('close', () => stream.destroy());
    } catch (err: any) {
      if (err?.name === 'CanceledError' || err?.name === 'AbortError') return; // cliente fechou
      if (!res.headersSent) res.status(502);
      res.end();
    }
  }

  private async forward(
    req: Request,
    base: string,
    targetPath: string,
    timeoutMs?: number,
  ): Promise<ProxyResult> {
    const url = `${base}${targetPath}`;
    const forwardedHeaders = this.buildForwardedHeaders(req);

    // Multipart (uploads, ex.: import KMZ/KML, fotos): o Express do gateway NÃO
    // parseia multipart, então `req.body` fica vazio. Re-enviar `req.body` aqui
    // mandaria um corpo vazio com o header `multipart/...; boundary=...`, e o
    // busboy do core estoura "Multipart: Unexpected end of form". Pra esses, o
    // gateway transmite o STREAM cru do request (o body ainda não foi consumido,
    // pois json/urlencoded só leem seus próprios content-types). Demais
    // requests seguem com o body já parseado (JSON/urlencoded).
    const contentType = (req.headers['content-type'] ?? '').toString().toLowerCase();
    const isMultipart = contentType.includes('multipart/form-data');
    // Webhooks assinados (Meta/WAHA): o core valida HMAC sobre os bytes EXATOS.
    // Repassa o corpo CRU (req.rawBody) em vez do JSON re-serializado, senão
    // payloads com unicode (acentos/emoji/figurinhas) quebram a assinatura.
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const isSignedWebhook = targetPath.includes('/webhooks/') && !!rawBody;
    // Rotas que falam com integrações externas lentas (Ufinet: cadeia
    // orquestrador→NCS→OLT→ONT) precisam de mais que os 15s padrão — só a ONT
    // responder já passa disso. Timeout ampliado SÓ pra elas; resto segue 15s.
    const isSlowExternal = /\/v1\/ufinet\/.*ont-action/.test(targetPath);
    // Transcrição de áudio (whisper local) pode levar dezenas de segundos.
    const isTranscribe = /\/transcribe$/.test(targetPath);

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
          data: isMultipart ? req : isSignedWebhook ? rawBody : req.body,
          // arraybuffer: o axios padrão (responseType json) lê QUALQUER resposta
          // como texto e re-serializa — o que CORROMPE binário (imagem, áudio,
          // figurinha .webp: bytes inflam e o arquivo fica inválido). Pegando o
          // corpo cru como Buffer, repassamos intacto. JSON continua funcionando
          // (os bytes são o próprio JSON; o cliente faz .json() normal).
          responseType: 'arraybuffer',
          // Streams de upload não devem ser limitados pelo axios (o core aplica
          // o limite real via multer). Sem buffering — o stream é repassado.
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          validateStatus: () => true, // never throw on 4xx/5xx
          timeout:
            timeoutMs ??
            (isMultipart ? 60_000 : isTranscribe ? 240_000 : isSlowExternal ? 90_000 : 15_000),
        }),
      );
      return { status: res.status, headers: res.headers as any, body: Buffer.from(res.data as ArrayBuffer) };
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

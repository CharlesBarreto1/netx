/**
 * Cliente HTTP de baixo nível da API Ufinet (TM Forum, Azure APIM).
 *
 * - Auth: OAuth2 client_credentials no Microsoft login → Bearer (~3599s),
 *   cacheado por (tokenUrl|clientId|scope). Renova 60s antes de expirar.
 * - Todo request leva DOIS headers: `Authorization: Bearer` + `Access: <key>`.
 * - fetch nativo + AbortController (padrão do TraccarService). Sem axios.
 *
 * Convenção de erro: lança `UfinetApiError` (com status + corpo) em respostas
 * não-2xx ou timeout. Quem chama (orders service) captura e persiste em
 * UfinetService.error / lifecycle=FAILED — o cliente não decide política.
 *
 * Stateless exceto o cache de token em memória → instanciável fora do Nest
 * (usado por scripts de smoke test contra QA).
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { ufinetTrace } from './ufinet-trace';
import type {
  UfinetConnection,
  UfinetInventoryService,
  UfinetMutationResponse,
  UfinetOrderResponse,
} from './ufinet.types';

const TOKEN_TIMEOUT_MS = 15_000;
// APIM de QA da Ufinet é lento/variável (10-30s observado). Timeout folgado;
// o design assíncrono (poll por cron) absorve latência alta.
const API_TIMEOUT_MS = 60_000;
const TOKEN_SKEW_MS = 60_000; // renova 60s antes de expirar

export class UfinetApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'UfinetApiError';
  }
}

@Injectable()
export class UfinetClientService {
  private readonly logger = new Logger(UfinetClientService.name);
  private readonly tokenCache = new Map<string, { token: string; expiresAt: number }>();

  // @Optional: scripts de smoke contra QA instanciam o cliente sem Nest (sem
  // Prisma) — nesse caso o trace só não é persistido.
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  /** Persiste 1 linha de trace (best-effort, nunca quebra a chamada). */
  private async persistTrace(entry: {
    method: string;
    path: string;
    status: number | null;
    durationMs: number;
    requestBody?: unknown;
    responseBody?: unknown;
    error?: string | null;
  }): Promise<void> {
    const ctx = ufinetTrace.getStore();
    if (!ctx || !this.prisma) return;
    try {
      await this.prisma.ufinetRequestLog.create({
        data: {
          tenantId: ctx.tenantId,
          externalId: ctx.externalId,
          method: entry.method,
          path: entry.path.slice(0, 255),
          status: entry.status ?? null,
          durationMs: entry.durationMs,
          requestBody: toJsonInput(entry.requestBody),
          // ServiceInventory devolve o inventário INTEIRO (todos os clientes).
          // Guarda só o bundle deste externalId — evita vazar PII de terceiros
          // no trace e impede a tabela de inchar com o inventário em cada GET.
          responseBody: toJsonInput(
            trimInventoryResponse(entry.responseBody, ctx.externalId),
          ),
          error: entry.error?.slice(0, 2000) ?? null,
        },
      });
    } catch {
      /* trace é evidência best-effort — nunca propaga erro */
    }
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------
  async getToken(conn: UfinetConnection): Promise<string> {
    const key = `${conn.tokenUrl}|${conn.clientId}|${conn.scope}`;
    const cached = this.tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
    try {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: conn.clientId,
        client_secret: conn.clientSecret,
        scope: conn.scope,
      });
      const res = await fetch(conn.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        expires_in?: number;
        error_description?: string;
      };
      if (!res.ok || !json.access_token) {
        // Sem segredos no log — só o motivo retornado pela Microsoft.
        this.logger.warn(`OAuth token → ${res.status}: ${json.error_description ?? 'sem access_token'}`);
        throw new UfinetApiError(
          `Ufinet OAuth falhou: ${json.error_description ?? res.status}`,
          res.status,
          json,
        );
      }
      const expiresInMs = (json.expires_in ?? 3599) * 1000;
      this.tokenCache.set(key, {
        token: json.access_token,
        expiresAt: Date.now() + expiresInMs - TOKEN_SKEW_MS,
      });
      this.logger.debug(`OAuth token novo OK (expires_in=${json.expires_in ?? '?'}s)`);
      return json.access_token;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------------------------------------------------------------------------
  // Request genérico
  // ---------------------------------------------------------------------------
  private async request<T>(
    conn: UfinetConnection,
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = await this.getToken(conn);
    const url = `${conn.baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    const startedAt = Date.now();
    // "Conversa" NetX↔Ufinet: corpo do request em debug (sem token/Access key).
    if (body !== undefined) {
      this.logger.debug(`→ ${method} ${path} req=${truncate(JSON.stringify(body))}`);
    }
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Access: conn.accessKey,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      const ms = Date.now() - startedAt;
      const parsed = text ? safeJson(text) : null;
      if (!res.ok) {
        throw new UfinetApiError(
          `Ufinet ${method} ${path} respondeu ${res.status}`,
          res.status,
          parsed ?? text,
        );
      }
      this.logger.log(`${method} ${path} → ${res.status} (${ms}ms)`);
      this.logger.debug(`← ${method} ${path} resp=${truncate(text)}`);
      await this.persistTrace({
        method, path, status: res.status, durationMs: ms, requestBody: body, responseBody: parsed,
      });
      return parsed as T;
    } catch (err) {
      const ms = Date.now() - startedAt;
      if (err instanceof UfinetApiError) {
        this.logger.warn(`${method} ${path} → ${err.status || 'ERRO'} (${ms}ms): ${err.message}`);
        this.logger.debug(`← ${method} ${path} erro-body=${truncate(JSON.stringify(err.body))}`);
        await this.persistTrace({
          method, path, status: err.status || null, durationMs: ms,
          requestBody: body, responseBody: err.body, error: err.message,
        });
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`${method} ${path} → FALHA (${ms}ms): ${message}`);
      await this.persistTrace({
        method, path, status: null, durationMs: ms, requestBody: body, error: message,
      });
      throw new UfinetApiError(`Ufinet ${method} ${path} falhou: ${message}`, 0, null);
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------------------------------------------------------------------------
  // ServiceOrder
  // ---------------------------------------------------------------------------
  /** POST ServiceOrder/order — cria ordem (provide/cease/suspend/etc). Envelopado. */
  createOrder(conn: UfinetConnection, payload: unknown): Promise<UfinetMutationResponse> {
    return this.request<UfinetMutationResponse>(conn, 'POST', 'ServiceOrder/order', payload);
  }

  /** GET ServiceOrder/order/{id} — detalhe (poll de estado). */
  getOrder(conn: UfinetConnection, orderId: string): Promise<UfinetOrderResponse> {
    return this.request<UfinetOrderResponse>(conn, 'GET', `ServiceOrder/order/${orderId}`);
  }

  /** GET ServiceOrder/order — lista (diagnóstico). */
  listOrders(conn: UfinetConnection): Promise<UfinetOrderResponse[]> {
    return this.request<UfinetOrderResponse[]>(conn, 'GET', 'ServiceOrder/order');
  }

  /** PATCH ServiceOrder/order/{id} — confirmação final (CTO_PORT + LABEL_DROP). */
  patchOrder(conn: UfinetConnection, orderId: string, payload: unknown): Promise<UfinetMutationResponse> {
    return this.request<UfinetMutationResponse>(conn, 'PATCH', `ServiceOrder/order/${orderId}`, payload);
  }

  // ---------------------------------------------------------------------------
  // ServiceInventory
  // ---------------------------------------------------------------------------
  /** GET ServiceInventory/service/{id}. */
  getService(conn: UfinetConnection, serviceId: string): Promise<UfinetInventoryService> {
    return this.request<UfinetInventoryService>(conn, 'GET', `ServiceInventory/service/${serviceId}`);
  }

  /**
   * GET ServiceInventory/service — lista. Quando a OLT tem `inventoryFilterParam`
   * configurado e passamos `externalServiceId`, filtra no SERVIDOR
   * (`?<param>=<id>`) e a Ufinet devolve só aquele bundle — em vez do inventário
   * inteiro do operador (inviável com milhares de clientes).
   */
  listServices(
    conn: UfinetConnection,
    externalServiceId?: string,
  ): Promise<UfinetInventoryService[]> {
    let path = 'ServiceInventory/service';
    if (conn.inventoryFilterParam && externalServiceId) {
      path += `?${encodeURIComponent(conn.inventoryFilterParam)}=${encodeURIComponent(externalServiceId)}`;
    }
    return this.request<UfinetInventoryService[]>(conn, 'GET', path);
  }

  /** PATCH ServiceInventory/service/{id} — confirmar ONT / sincronizar. */
  patchService(conn: UfinetConnection, serviceId: string, payload: unknown): Promise<UfinetInventoryService> {
    return this.request<UfinetInventoryService>(conn, 'PATCH', `ServiceInventory/service/${serviceId}`, payload);
  }

  // ---------------------------------------------------------------------------
  // Cancelación
  // ---------------------------------------------------------------------------
  /** POST CancelServiceOrder — cancela ordem (só se ONT não confirmada). */
  cancelOrder(conn: UfinetConnection, payload: unknown): Promise<UfinetMutationResponse> {
    return this.request<UfinetMutationResponse>(conn, 'POST', 'CancelServiceOrder', payload);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Limita o tamanho do corpo no log (debug pode ter payloads grandes). */
function truncate(s: string | null | undefined, max = 4000): string {
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…[+${s.length - max} chars]` : s;
}

/** Normaliza um corpo pra coluna JSONB do trace (undefined = NULL). */
function toJsonInput(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  try {
    JSON.stringify(v);
    return v as Prisma.InputJsonValue;
  } catch {
    return String(v);
  }
}

/**
 * Quando a resposta é uma lista do ServiceInventory (a Ufinet devolve TODO o
 * inventário do operador em cada GET), mantém só os itens cujo
 * `externalServiceId` é o deste serviço — individualiza o trace, não vaza PII
 * de outros clientes e impede a `ufinet_request_logs` de inchar.
 *
 * Aceita a lista crua (array) ou embrulhada em `{ service: [...] }` /
 * `{ data: [...] }`. Qualquer outra forma (ordem, erro, etc) passa intacta.
 */
function trimInventoryResponse(body: unknown, externalId: string): unknown {
  const isBundle = (x: unknown): boolean =>
    !!x && typeof x === 'object' && 'externalServiceId' in (x as object);
  const mine = (arr: unknown[]): unknown[] => {
    // Se nenhum item tem externalServiceId, não é inventário — devolve igual.
    if (!arr.some(isBundle)) return arr;
    return arr.filter(
      (x) => (x as { externalServiceId?: string })?.externalServiceId === externalId,
    );
  };
  if (Array.isArray(body)) return mine(body);
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    for (const key of ['service', 'data', 'result'] as const) {
      if (Array.isArray(obj[key]) && (obj[key] as unknown[]).some(isBundle)) {
        return { ...obj, [key]: mine(obj[key] as unknown[]) };
      }
    }
  }
  return body;
}

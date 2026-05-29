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
import { Injectable, Logger } from '@nestjs/common';

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
      const parsed = text ? safeJson(text) : null;
      if (!res.ok) {
        throw new UfinetApiError(
          `Ufinet ${method} ${path} respondeu ${res.status}`,
          res.status,
          parsed ?? text,
        );
      }
      return parsed as T;
    } catch (err) {
      if (err instanceof UfinetApiError) throw err;
      const message = err instanceof Error ? err.message : String(err);
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

  /** GET ServiceInventory/service — lista. */
  listServices(conn: UfinetConnection): Promise<UfinetInventoryService[]> {
    return this.request<UfinetInventoryService[]>(conn, 'GET', 'ServiceInventory/service');
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

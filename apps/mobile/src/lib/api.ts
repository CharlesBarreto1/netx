/**
 * Fetch wrapper central do app.
 *
 * Responsabilidades:
 *  - Injetar Authorization: Bearer <accessToken>
 *  - Detectar 401 e tentar refresh via POST /auth/refresh (uma vez)
 *  - Em refresh OK: re-executar request original
 *  - Em refresh falho: chamar onUnauthorized() pra deslogar + voltar pro login
 *  - Normalizar erros como ApiError (mensagem amigável + status + payload)
 *
 * Espelha o comportamento do apps/web/src/lib/api.ts pra que mobile e web
 * tenham a mesma semântica.
 */
import { authStorage } from './auth-storage';
import { getApiBaseUrl } from './server';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Init = Omit<RequestInit, 'body'> & {
  body?: unknown;
  skipAuth?: boolean;
  silentUnauthorized?: boolean;
  signal?: AbortSignal;
};

let onUnauthorized: (() => void) | null = null;

/** Registra o callback que dispara logout. Chamado pelo AuthProvider. */
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

// Lock simples pra evitar refresh paralelo (3 requests em 401 ao mesmo tempo
// virariam 3 refreshes — só queremos 1).
let refreshPromise: Promise<string | null> | null = null;

async function tryRefresh(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refreshToken = await authStorage.getRefreshToken();
    if (!refreshToken) return null;

    try {
      const base = await getApiBaseUrl();
      const res = await fetch(`${base}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        accessToken: string;
        refreshToken: string;
      };
      await authStorage.saveTokens(data.accessToken, data.refreshToken);
      return data.accessToken;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function rawFetch(path: string, init: Init): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (!init.skipAuth) {
    const token = await authStorage.getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const base = await getApiBaseUrl();
  return fetch(`${base}${path}`, {
    ...init,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

export async function api<T = unknown>(path: string, init: Init = {}): Promise<T> {
  let res = await rawFetch(path, init);

  // Tenta refresh em 401, exceto se a chamada já é o próprio /auth/*
  if (res.status === 401 && !init.skipAuth && !path.startsWith('/auth/')) {
    const newToken = await tryRefresh();
    if (newToken) {
      res = await rawFetch(path, init); // retry com novo token (rawFetch lê do storage)
    } else if (!init.silentUnauthorized) {
      // Endpoints opcionais (ex. /mobile/*) podem passar silentUnauthorized
      // pra evitar desautenticar o user quando o backend ainda não tem o módulo.
      onUnauthorized?.();
    }
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);

  if (!res.ok) {
    const message =
      (payload && typeof payload === 'object' && 'title' in payload && typeof payload.title === 'string'
        ? payload.title
        : null) ||
      (payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
        ? payload.message
        : null) ||
      `Erro ${res.status}`;
    throw new ApiError(message, res.status, payload);
  }

  return payload as T;
}

/**
 * Cliente HTTP para o API Gateway do NetX.
 *
 * Convenções:
 *   - Token em localStorage (`netx.accessToken`) — compartilhado entre abas pra
 *     que páginas de print abertas em nova aba mantenham sessão.
 *   - Base URL via NEXT_PUBLIC_API_URL (default `/api`, ou seja, same-origin —
 *     o Next proxia `/api/*` para o gateway via rewrite em next.config.mjs).
 *     Só sobrescreva se o frontend e o backend rodam em domínios diferentes.
 *   - Em caso de 401 no client, limpa sessão e redireciona para /login.
 *   - Erros devolvidos pelo backend no formato RFC 7807-like são expostos via ApiError.
 */

import type { LoginResponse } from '@netx/shared';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? '/api').replace(/\/$/, '');

/**
 * Timeout default por request. Sem isso, um gateway lento (ou pendurado)
 * mantém a UI travada indefinidamente — spinner infinito, user reclamando
 * de "tela congelada". 30s é generoso pra request mais lento que deveríamos
 * ter (export de relatório, etc); mutations curtas falham bem antes.
 *
 * Override individual via api.get(path, { timeoutMs: 60_000 }).
 */
const DEFAULT_TIMEOUT_MS = 30_000;

export interface LoginInput {
  email: string;
  password: string;
  tenantSlug?: string;
  /** Código TOTP (6 dígitos) ou backup code, quando o user tem 2FA. */
  mfaToken?: string;
}

export interface ApiProblem {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  errors?: Array<{ path: string; message: string }>;
  /**
   * Campo padrão do NestJS (HttpException). Pode ser string ou array de strings
   * (em ValidationPipe). Usado como fallback caso o backend ainda não tenha o
   * filtro RFC 7807 aplicado — sem isso, ConflictException/NotFoundException
   * apareciam como "HTTP 409" no toast.
   */
  message?: string | string[];
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: ApiProblem,
  ) {
    super(
      problem.detail ??
        problem.title ??
        nestMessageToString(problem.message) ??
        `HTTP ${status}`,
    );
    this.name = 'ApiError';
  }

  /**
   * Mensagem amigável para toast / inline error. Ordem de fallback:
   *   1. `errors[]` (Zod pipe / RFC 7807) — junta em uma linha
   *   2. `detail` (RFC 7807)
   *   3. `title` (RFC 7807)
   *   4. `message` (NestJS HttpException default) — string ou array
   *   5. mensagem genérica do `super`
   */
  get friendlyMessage(): string {
    if (this.problem.errors && this.problem.errors.length) {
      return this.problem.errors
        .map((e) => `${e.path ? e.path + ': ' : ''}${e.message}`)
        .join(' · ');
    }
    return (
      this.problem.detail ??
      this.problem.title ??
      nestMessageToString(this.problem.message) ??
      this.message
    );
  }
}

function nestMessageToString(m: string | string[] | undefined): string | undefined {
  if (!m) return undefined;
  if (Array.isArray(m)) return m.length ? m.join(' · ') : undefined;
  return m;
}

function authHeaders(): HeadersInit {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('netx.accessToken');
  return token ? { authorization: `Bearer ${token}` } : {};
}

function handleUnauthorized(): void {
  if (typeof window === 'undefined') return;
  // Limpa só as chaves do NetX (não usa .clear()). Mantemos consistência com
  // session.ts:clearSession.
  localStorage.removeItem('netx.accessToken');
  localStorage.removeItem('netx.refreshToken');
  localStorage.removeItem('netx.user');
  localStorage.removeItem('netx.tenant');
  // Evita loop se já estivermos na /login
  if (!window.location.pathname.startsWith('/login')) {
    window.location.href = '/login';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-refresh em 401
// ─────────────────────────────────────────────────────────────────────────────
// Quando o access token expira, ao invés de mandar o user pra /login direto:
//   1. Tenta trocar o refresh token por um novo par via POST /auth/refresh.
//   2. Se rolar, reexecuta o request original com o novo access.
//   3. Se falhar, aí sim limpa sessão e redireciona.
//
// Singleton promise: se 5 requests dispararem 401 simultaneamente, todos
// esperam o MESMO refresh — sem flood no backend nem race condition.

let refreshInFlight: Promise<string | null> | null = null;

async function tryRefresh(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  if (refreshInFlight) return refreshInFlight;

  const refreshToken = localStorage.getItem('netx.refreshToken');
  if (!refreshToken) return null;

  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return null;
      const text = await res.text();
      const parsed = text ? safeParse(text) : null;
      if (!parsed || typeof parsed !== 'object') return null;
      const next = parsed as { accessToken?: string; refreshToken?: string };
      if (!next.accessToken) return null;
      localStorage.setItem('netx.accessToken', next.accessToken);
      if (next.refreshToken) {
        localStorage.setItem('netx.refreshToken', next.refreshToken);
      }
      return next.accessToken;
    } catch {
      return null;
    } finally {
      // Libera o slot — próximo 401 dispara um novo refresh se necessário.
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  // Endpoints de refresh/login NÃO devem entrar no ciclo de auto-refresh —
  // se /auth/refresh devolve 401, a única coisa a fazer é deslogar.
  const isRefreshCall = path.startsWith('/v1/auth/refresh') || path.startsWith('/v1/auth/login');

  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // AbortController + setTimeout: gateway lento não trava UI indefinidamente.
  // Se o caller passou seu próprio `signal`, encadeamos — qualquer um aborta.
  const doFetch = () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const callerSignal = init.signal;
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    return fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...authHeaders(),
        ...(init.headers ?? {}),
      },
      body: body == null ? undefined : JSON.stringify(body),
      ...init,
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
  };

  let res: Response;
  try {
    res = await doFetch();
  } catch (err) {
    // AbortError vira ApiError pra fluxo consistente no caller.
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(0, {
        title: 'Request timeout',
        detail: `Request demorou mais de ${timeoutMs}ms — backend lento ou indisponível.`,
      });
    }
    throw err;
  }

  if (res.status === 401 && !isRefreshCall) {
    const newToken = await tryRefresh();
    if (newToken) {
      // Reexecuta o request original com o novo token. authHeaders() lê do
      // localStorage atualizado automaticamente.
      try {
        res = await doFetch();
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw new ApiError(0, {
            title: 'Request timeout',
            detail: `Request demorou mais de ${timeoutMs}ms — backend lento ou indisponível.`,
          });
        }
        throw err;
      }
    }
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const parsed = text ? safeParse(text) : null;

  if (!res.ok) {
    if (res.status === 401) handleUnauthorized();
    const problem: ApiProblem =
      parsed && typeof parsed === 'object'
        ? (parsed as ApiProblem)
        : { title: res.statusText, status: res.status };
    throw new ApiError(res.status, problem);
  }

  return (parsed ?? undefined) as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// -----------------------------------------------------------------------------
// Helpers públicos
// -----------------------------------------------------------------------------

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T = void>(path: string) => request<T>('DELETE', path),
};

/** Fetcher padrão para SWR (usa GET + auth headers). */
export const swrFetcher = <T>(path: string) => api.get<T>(path);

// -----------------------------------------------------------------------------
// Auth — mantém compatível com login/page.tsx existente
// -----------------------------------------------------------------------------

export async function apiLogin(input: LoginInput): Promise<LoginResponse> {
  // Não pode usar `api.post` porque não queremos interceptar 401 aqui (o 401
  // nesse fluxo é o feedback legítimo de credenciais inválidas).
  const res = await fetch(`${API_BASE}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const text = await res.text();
  const parsed = text ? safeParse(text) : null;
  if (!res.ok) {
    const problem: ApiProblem =
      parsed && typeof parsed === 'object'
        ? (parsed as ApiProblem)
        : { title: res.statusText, status: res.status };
    throw new ApiError(res.status, problem);
  }
  // Trust the shared LoginResponse contract — backend serialize com o mesmo
  // shape (auth.service.ts ↔ packages/shared/src/auth.dto.ts).
  return parsed as LoginResponse;
}

/** Compat com o código antigo — delega pro api.get. */
export const apiGet = <T>(path: string) => api.get<T>(path);

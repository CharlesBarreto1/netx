/**
 * Cliente HTTP para o API Gateway do NetX.
 *
 * Convenções:
 *   - Token em sessionStorage (`netx.accessToken`) — mesma chave do fluxo de login.
 *   - Base URL via NEXT_PUBLIC_API_URL (default `/api`, ou seja, same-origin —
 *     o Next proxia `/api/*` para o gateway via rewrite em next.config.mjs).
 *     Só sobrescreva se o frontend e o backend rodam em domínios diferentes.
 *   - Em caso de 401 no client, limpa sessão e redireciona para /login.
 *   - Erros devolvidos pelo backend no formato RFC 7807-like são expostos via ApiError.
 */

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? '/api').replace(/\/$/, '');

export interface LoginInput {
  email: string;
  password: string;
  tenantSlug?: string;
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
  const token = sessionStorage.getItem('netx.accessToken');
  return token ? { authorization: `Bearer ${token}` } : {};
}

function handleUnauthorized(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.clear();
  // Evita loop se já estivermos na /login
  if (!window.location.pathname.startsWith('/login')) {
    window.location.href = '/login';
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...authHeaders(),
      ...(init.headers ?? {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
    ...init,
  });

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

export async function apiLogin(input: LoginInput) {
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
  return parsed as {
    accessToken: string;
    refreshToken: string;
    user: unknown;
    tenant: unknown;
  };
}

/** Compat com o código antigo — delega pro api.get. */
export const apiGet = <T>(path: string) => api.get<T>(path);

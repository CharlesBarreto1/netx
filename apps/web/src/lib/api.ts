const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api';

export interface LoginInput {
  email: string;
  password: string;
  tenantSlug?: string;
}

export async function apiLogin(input: LoginInput) {
  const res = await fetch(`${API}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ title: 'Erro' }));
    throw new Error(body?.detail ?? body?.title ?? 'Falha ao autenticar');
  }
  return res.json();
}

export async function apiGet<T>(path: string): Promise<T> {
  const token = typeof window !== 'undefined' ? sessionStorage.getItem('netx.accessToken') : null;
  const res = await fetch(`${API}${path}`, {
    headers: { authorization: token ? `Bearer ${token}` : '' },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

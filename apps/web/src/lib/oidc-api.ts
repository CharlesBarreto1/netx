/**
 * Cliente HTTP do fluxo de interaction do OIDC.
 *
 * Isolado de `lib/api.ts` de propósito: aquele carrega o token da operação e
 * redireciona pra /login em 401. Aqui não existe sessão do NetX — a pessoa
 * está justamente autenticando — e um 401 é resposta esperada (senha errada,
 * MFA pendente), não motivo pra navegar pra lugar nenhum.
 *
 * `credentials: 'include'` é obrigatório: o cookie `_interaction` do provider
 * tem path restrito ao caminho da própria interaction, e sem ele o backend não
 * sabe qual autorização está em curso.
 */

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? '/api').replace(/\/$/, '');

export interface InteractionDetails {
  uid: string;
  prompt: string;
  clientId: string;
  clientName?: string;
  scopes: string[];
  tenantName: string;
}

/** Motivo da recusa, para a tela decidir o que pedir em seguida. */
export type LoginFailureReason = 'invalid_credentials' | 'mfa_required' | 'mfa_invalid';

export class OidcInteractionError extends Error {
  constructor(
    readonly reason: LoginFailureReason | 'unknown',
    message: string,
  ) {
    super(message);
    this.name = 'OidcInteractionError';
  }
}

function base(slug: string, uid: string): string {
  return `${API_BASE}/v1/oidc/${encodeURIComponent(slug)}/interaction/${encodeURIComponent(uid)}`;
}

export async function fetchInteractionDetails(
  slug: string,
  uid: string,
): Promise<InteractionDetails> {
  const res = await fetch(`${base(slug, uid)}/details`, { credentials: 'include' });
  if (!res.ok) {
    throw new OidcInteractionError('unknown', 'Autorização não encontrada ou expirada.');
  }
  return res.json() as Promise<InteractionDetails>;
}

export async function submitInteractionLogin(
  slug: string,
  uid: string,
  body: { email: string; password: string; mfaToken?: string },
): Promise<{ returnTo: string }> {
  const res = await fetch(`${base(slug, uid)}/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (res.ok) return res.json() as Promise<{ returnTo: string }>;

  const payload = (await res.json().catch(() => ({}))) as {
    reason?: LoginFailureReason;
    title?: string;
  };
  throw new OidcInteractionError(payload.reason ?? 'unknown', payload.title ?? 'Falha ao entrar.');
}

export async function abortInteraction(slug: string, uid: string): Promise<{ returnTo: string }> {
  const res = await fetch(`${base(slug, uid)}/abort`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) throw new OidcInteractionError('unknown', 'Não foi possível cancelar.');
  return res.json() as Promise<{ returnTo: string }>;
}

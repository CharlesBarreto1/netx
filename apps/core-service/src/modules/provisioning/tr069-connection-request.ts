/**
 * TR-069 Connection Request — aciona o CPE pra abrir uma sessão CWMP imediata.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * O ACS faz um GET na ManagementServer.ConnectionRequestURL do CPE. O CPE
 * responde 401 com desafio HTTP Digest; reautenticamos com as credenciais de
 * Connection Request (que o NetX define e guarda cifradas). Em sucesso o CPE
 * abre na hora uma sessão com evento "6 CONNECTION REQUEST", e o ACS despacha
 * as tasks pendentes (ex.: o GET_PARAMS de diagnóstico).
 *
 * Best-effort: em rede neutra com NAT o CPE costuma ser inalcançável — aí
 * caímos no Periodic Inform. Implementado sem dependência externa (Digest na
 * mão com node:crypto) pra não mexer no lockfile.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { createHash, randomBytes } from 'node:crypto';

export interface ConnectionRequestResult {
  ok: boolean;
  /** Código de status HTTP final (quando houve resposta). */
  status?: number;
  /** Motivo curto quando falhou (pra log/UI): no-url, timeout, unreachable… */
  reason?: string;
}

function md5(s: string): string {
  return createHash('md5').update(s).digest('hex');
}

/** Quebra o header WWW-Authenticate: Digest em pares chave→valor. */
function parseDigestChallenge(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  const body = header.replace(/^Digest\s+/i, '');
  // key="value" ou key=value, separados por vírgula.
  const re = /(\w+)=(?:"([^"]*)"|([^,]*))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out[m[1].toLowerCase()] = (m[2] ?? m[3] ?? '').trim();
  }
  return out;
}

/** Monta o header Authorization: Digest pra um desafio. */
function buildDigestAuth(
  username: string,
  password: string,
  method: string,
  uri: string,
  challenge: Record<string, string>,
): string {
  const realm = challenge.realm ?? '';
  const nonce = challenge.nonce ?? '';
  const qop = challenge.qop;
  const opaque = challenge.opaque;
  const algorithm = challenge.algorithm ?? 'MD5';

  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);

  let response: string;
  const parts: string[] = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `algorithm=${algorithm}`,
  ];

  if (qop) {
    const nc = '00000001';
    const cnonce = randomBytes(8).toString('hex');
    // qop pode vir "auth" ou "auth,auth-int" — usamos "auth".
    response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`);
    parts.push(`qop=auth`, `nc=${nc}`, `cnonce="${cnonce}"`);
  } else {
    response = md5(`${ha1}:${nonce}:${ha2}`);
  }
  parts.push(`response="${response}"`);
  if (opaque) parts.push(`opaque="${opaque}"`);
  return `Digest ${parts.join(', ')}`;
}

/**
 * Dispara a Connection Request. Faz GET, trata o desafio (Digest ou Basic) e
 * refaz o GET autenticado. Nunca lança — devolve {ok,reason}.
 */
export async function performConnectionRequest(
  url: string,
  username: string,
  password: string,
  timeoutMs = 5000,
): Promise<ConnectionRequestResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  const uri = `${parsed.pathname}${parsed.search}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const first = await fetch(url, { method: 'GET', signal: controller.signal });
    if (first.status === 200 || first.status === 204) {
      return { ok: true, status: first.status };
    }
    if (first.status !== 401) {
      return { ok: false, status: first.status, reason: 'unexpected-status' };
    }

    const wwwAuth = first.headers.get('www-authenticate') ?? '';
    let authHeader: string;
    if (/^digest/i.test(wwwAuth)) {
      authHeader = buildDigestAuth(username, password, 'GET', uri, parseDigestChallenge(wwwAuth));
    } else if (/^basic/i.test(wwwAuth)) {
      authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    } else {
      return { ok: false, status: 401, reason: 'unsupported-auth' };
    }

    const second = await fetch(url, {
      method: 'GET',
      headers: { Authorization: authHeader },
      signal: controller.signal,
    });
    const ok = second.status === 200 || second.status === 204;
    return { ok, status: second.status, reason: ok ? undefined : 'auth-failed' };
  } catch (err) {
    const reason =
      err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'unreachable';
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

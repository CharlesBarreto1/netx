/**
 * Fluxo OIDC completo — authorization code + PKCE, ponta a ponta.
 *
 * Este é o teste que corresponde ao primeiro critério de aceitação: um usuário
 * existente autentica e o cliente recebe um id_token verificável.
 *
 * Percorre de verdade: /auth -> interaction -> login -> code -> /token ->
 * verificação da assinatura contra o JWKS -> /me. Com cookies, como um
 * navegador faria.
 *
 * O que ele protege: qualquer regressão que quebre o SSO só apareceria, sem
 * isto, quando alguém tentasse entrar no Nextcloud e não conseguisse.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { hashPassword } from '@netx/auth';
import { createLocalJWKSet, jwtVerify } from 'jose';

import { AuditService } from '../src/modules/audit/audit.service';
import { CryptoService } from '../src/modules/crypto/crypto.service';
import { MfaService } from '../src/modules/auth/mfa.service';
import { OidcInteractionService } from '../src/modules/oidc/oidc-interaction.service';
import { OidcKeyService } from '../src/modules/oidc/oidc-key.service';
import { OidcProviderService } from '../src/modules/oidc/oidc-provider.service';
import type { PrismaService } from '../src/modules/prisma/prisma.service';

import { testPrisma } from './setup/db';
import { createTenant, createUser } from './setup/factories';

const BASE = 'https://netx.exemplo.test';
const REDIRECT = 'https://cloud.zux.net.br/apps/user_oidc/code';
const SENHA = 'Senha-Muito-Forte-123';

function setOidcEnv(): void {
  process.env.OIDC_PUBLIC_BASE_URL = BASE;
  process.env.OIDC_COOKIE_SECRET = 'c'.repeat(48);
  process.env.OIDC_NEXTCLOUD_CLIENT_ID = 'nextcloud';
  process.env.OIDC_NEXTCLOUD_CLIENT_SECRET = 's'.repeat(48);
  process.env.OIDC_NEXTCLOUD_REDIRECT_URIS = REDIRECT;
  process.env.OIDC_NEXTCLOUD_POST_LOGOUT_REDIRECT_URIS = 'https://cloud.zux.net.br/';
}

/** Jar mínimo: o fluxo é todo baseado em cookie e o fetch não guarda nada. */
class CookieJar {
  private readonly jar = new Map<string, string>();

  absorb(res: Response): void {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq < 1) continue;
      const nome = pair.slice(0, eq).trim();
      const valor = pair.slice(eq + 1).trim();
      if (valor === '' || /expires=Thu, 01 Jan 1970/i.test(raw)) this.jar.delete(nome);
      else this.jar.set(nome, valor);
    }
  }

  header(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

describe('fluxo OIDC completo', () => {
  let service: OidcProviderService;
  let server: Server;
  let origin: string;
  let slug: string;
  let tenantId: string;
  let userId: string;
  let email: string;
  let jar: CookieJar;

  beforeEach(async () => {
    setOidcEnv();
    const prisma = testPrisma() as unknown as PrismaService;

    const crypto = new CryptoService();
    crypto.onModuleInit();
    const audit = new AuditService(prisma);
    const keys = new OidcKeyService(prisma, crypto, audit);
    service = new OidcProviderService(prisma, keys);

    const interaction = new OidcInteractionService(prisma, new MfaService(prisma, audit), audit);

    const tenant = await createTenant({ slug: `zux-${Date.now()}`, name: 'Zux Internet' });
    slug = tenant.slug;
    tenantId = tenant.id;

    const user = await createUser(tenant.id, {
      email: `pessoa-${Date.now()}@zux.net.br`,
      firstName: 'Maria',
      lastName: 'Souza',
      passwordHash: await hashPassword(SENHA),
    });
    userId = user.id;
    email = user.email;

    jar = new CookieJar();

    // Servidor cru replicando o roteamento do controller: interaction antes do
    // catch-all.
    server = createServer((req, res) => {
      const url = req.url ?? '/';
      const partes = url.split('?')[0].split('/').filter(Boolean); // v1, oidc, <slug>, ...
      const s = partes[2] ?? '';

      const rota = async () => {
        if (partes[3] === 'interaction' && partes[5] === 'details') {
          const d = await service.interactionDetails(s, req, res);
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(d));
          return;
        }
        if (partes[3] === 'interaction' && partes[5] === 'login') {
          const body = await new Promise<string>((resolve) => {
            let b = '';
            req.on('data', (c) => (b += c));
            req.on('end', () => resolve(b));
          });
          const { email: e, password, mfaToken } = JSON.parse(body || '{}');
          try {
            const id = await interaction.authenticate({
              tenantId,
              email: e,
              password,
              mfaToken,
            });
            const returnTo = await service.finishInteraction(s, req, res, id, true);
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ returnTo }));
          } catch (err) {
            res.statusCode = 401;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ reason: (err as { reason?: string }).reason }));
          }
          return;
        }
        await service.handle(s, req, res);
      };

      void rota().catch(() => {
        if (!res.headersSent) res.statusCode = 500;
        res.end();
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** fetch que carrega e absorve cookies, sem seguir redirect. */
  async function req(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const c = jar.header();
    if (c) headers.set('cookie', c);
    const res = await fetch(`${origin}${path}`, { ...init, headers, redirect: 'manual' });
    jar.absorb(res);
    return res;
  }

  const base = () => `/v1/oidc/${slug}`;

  it('autentica e entrega id_token verificável pelo JWKS', async () => {
    const { verifier, challenge } = pkce();

    // 1) o cliente inicia o fluxo
    const authUrl =
      `${base()}/auth?client_id=nextcloud&response_type=code&scope=${encodeURIComponent('openid email profile groups')}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT)}` +
      `&code_challenge=${challenge}&code_challenge_method=S256&state=xyz`;

    const inicio = await req(authUrl);
    expect(inicio.status).toBe(303);
    const paraInteraction = inicio.headers.get('location') ?? '';
    expect(paraInteraction).toContain(`/oidc/${slug}/interaction/`);

    const uid = paraInteraction.split('/interaction/')[1];

    // 2) a tela pergunta o que mostrar
    const det = await req(`${base()}/interaction/${uid}/details`);
    expect(det.status).toBe(200);
    const detalhes = await det.json();
    expect(detalhes.clientId).toBe('nextcloud');
    expect(detalhes.tenantName).toBe('Zux Internet');
    expect(detalhes.scopes).toEqual(expect.arrayContaining(['openid', 'email', 'profile']));

    // 3) senha errada não passa
    const ruim = await req(`${base()}/interaction/${uid}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'senha-errada' }),
    });
    expect(ruim.status).toBe(401);
    expect((await ruim.json()).reason).toBe('invalid_credentials');

    // 4) senha certa conclui a interaction
    const bom = await req(`${base()}/interaction/${uid}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: SENHA }),
    });
    expect(bom.status).toBe(200);
    const { returnTo } = await bom.json();
    expect(returnTo).toContain('/auth/');

    // 5) retomando, o provider emite o code e manda de volta ao cliente
    const retomada = await req(returnTo.replace(BASE + '/api', ''));
    expect(retomada.status).toBe(303);
    const destino = retomada.headers.get('location') ?? '';
    expect(destino.startsWith(REDIRECT)).toBe(true);

    const code = new URL(destino).searchParams.get('code');
    const state = new URL(destino).searchParams.get('state');
    expect(code).toBeTruthy();
    expect(state).toBe('xyz');

    // 6) troca do code por tokens, com o verifier do PKCE
    const cred = Buffer.from(`nextcloud:${'s'.repeat(48)}`).toString('base64');
    const tok = await req(`${base()}/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${cred}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
      }).toString(),
    });
    expect(tok.status).toBe(200);
    const tokens = await tok.json();
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.id_token).toBeTruthy();
    expect(tokens.access_token).toBeTruthy();

    // 7) a assinatura fecha com o JWKS público
    const { keys } = await (await req(`${base()}/jwks`)).json();
    const jwks = createLocalJWKSet({ keys });
    const { payload, protectedHeader } = await jwtVerify(tokens.id_token, jwks, {
      issuer: `${BASE}/api/v1/oidc/${slug}`,
      audience: 'nextcloud',
    });

    expect(protectedHeader.alg).toBe('RS256');
    // sub é o id imutável, NÃO o e-mail
    expect(payload.sub).toBe(userId);
    expect(payload.sub).not.toBe(email);
    expect(payload.email).toBe(email);
    expect(payload.name).toBe('Maria Souza');

    // 8) userinfo responde com o mesmo sub
    const me = await req(`${base()}/me`, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    expect(me.status).toBe(200);
    expect((await me.json()).sub).toBe(userId);
  });

  it('usuário inativo não autentica', async () => {
    await testPrisma().user.update({ where: { id: userId }, data: { status: 'DISABLED' } });

    const { challenge } = pkce();
    const inicio = await req(
      `${base()}/auth?client_id=nextcloud&response_type=code&scope=openid` +
        `&redirect_uri=${encodeURIComponent(REDIRECT)}` +
        `&code_challenge=${challenge}&code_challenge_method=S256&state=s`,
    );
    const uid = (inicio.headers.get('location') ?? '').split('/interaction/')[1];

    const r = await req(`${base()}/interaction/${uid}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: SENHA }),
    });

    expect(r.status).toBe(401);
    expect((await r.json()).reason).toBe('invalid_credentials');
  });

  it('usuário com MFA ligada não entra só com senha', async () => {
    await testPrisma().user.update({
      where: { id: userId },
      data: { mfaEnabled: true, mfaSecret: 'JBSWY3DPEHPK3PXP' },
    });

    const { challenge } = pkce();
    const inicio = await req(
      `${base()}/auth?client_id=nextcloud&response_type=code&scope=openid` +
        `&redirect_uri=${encodeURIComponent(REDIRECT)}` +
        `&code_challenge=${challenge}&code_challenge_method=S256&state=s`,
    );
    const uid = (inicio.headers.get('location') ?? '').split('/interaction/')[1];

    const r = await req(`${base()}/interaction/${uid}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: SENHA }),
    });

    // Se isto virar 200, o SSO passou a ser um desvio da MFA.
    expect(r.status).toBe(401);
    expect((await r.json()).reason).toBe('mfa_required');
  });
});

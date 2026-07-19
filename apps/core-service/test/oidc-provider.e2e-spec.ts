/**
 * OIDC Provider — testes de integração sobre HTTP real.
 *
 * Sobe um servidor http de verdade apontando para o serviço e faz requisições
 * com fetch. Não bootamos o AppModule inteiro (arrastaria RabbitMQ, licença,
 * CLS e o resto), mas o caminho exercitado é o mesmo: URL crua entra, o
 * oidc-provider escreve a resposta no `res`.
 *
 * O que importa provar aqui é o que um cliente OIDC de terceiro vai exigir:
 * discovery coerente, issuer correto por tenant, e JWKS com a chave certa e
 * SEM material privado.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { AuditService } from '../src/modules/audit/audit.service';
import { CryptoService } from '../src/modules/crypto/crypto.service';
import { OidcKeyService } from '../src/modules/oidc/oidc-key.service';
import { OidcProviderService } from '../src/modules/oidc/oidc-provider.service';
import type { PrismaService } from '../src/modules/prisma/prisma.service';

import { testPrisma } from './setup/db';
import { createTenant } from './setup/factories';

const BASE = 'https://netx.exemplo.test';

/** Config que o provider exige. Definida antes de instanciar o serviço. */
function setOidcEnv(): void {
  process.env.OIDC_PUBLIC_BASE_URL = BASE;
  process.env.OIDC_COOKIE_SECRET = 'c'.repeat(48);
  process.env.OIDC_NEXTCLOUD_CLIENT_ID = 'nextcloud';
  process.env.OIDC_NEXTCLOUD_CLIENT_SECRET = 's'.repeat(48);
  process.env.OIDC_NEXTCLOUD_REDIRECT_URIS =
    'https://cloud.zux.net.br/apps/user_oidc/code,https://cloud.zux.net.br/index.php/apps/user_oidc/code';
  process.env.OIDC_NEXTCLOUD_POST_LOGOUT_REDIRECT_URIS = 'https://cloud.zux.net.br/';
}

function buildService(): OidcProviderService {
  const prisma = testPrisma() as unknown as PrismaService;
  const crypto = new CryptoService();
  crypto.onModuleInit();
  const keys = new OidcKeyService(prisma, crypto, new AuditService(prisma));
  return new OidcProviderService(prisma, keys);
}

describe('OidcProviderService (HTTP)', () => {
  let service: OidcProviderService;
  let server: Server;
  let origin: string;
  let slug: string;

  beforeEach(async () => {
    setOidcEnv();
    service = buildService();

    const tenant = await createTenant({ slug: `zux-${Date.now()}` });
    slug = tenant.slug;

    // Servidor cru: repassa tudo para o serviço, como o controller faz.
    server = createServer((req, res) => {
      const s = (req.url ?? '').split('/')[3] ?? '';
      void service.handle(s, req, res).catch(() => {
        res.statusCode = 500;
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const get = (path: string) =>
    fetch(`${origin}/v1/oidc/${slug}${path}`, { redirect: 'manual' });

  describe('discovery', () => {
    it('serve o openid-configuration', async () => {
      const res = await get('/.well-known/openid-configuration');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
    });

    it('o issuer é o do tenant, derivado da base pública', async () => {
      const doc = await (await get('/.well-known/openid-configuration')).json();
      expect(doc.issuer).toBe(`${BASE}/api/v1/oidc/${slug}`);
    });

    it('anuncia os endpoints que o Nextcloud precisa', async () => {
      const doc = await (await get('/.well-known/openid-configuration')).json();
      const issuer = `${BASE}/api/v1/oidc/${slug}`;

      expect(doc.authorization_endpoint).toBe(`${issuer}/auth`);
      expect(doc.token_endpoint).toBe(`${issuer}/token`);
      expect(doc.jwks_uri).toBe(`${issuer}/jwks`);
      expect(doc.userinfo_endpoint).toBe(`${issuer}/me`);
      expect(doc.end_session_endpoint).toBe(`${issuer}/session/end`);
    });

    it('exige PKCE com S256', async () => {
      const doc = await (await get('/.well-known/openid-configuration')).json();
      expect(doc.code_challenge_methods_supported).toContain('S256');
    });

    it('anuncia authorization_code e refresh_token', async () => {
      const doc = await (await get('/.well-known/openid-configuration')).json();
      expect(doc.grant_types_supported).toEqual(
        expect.arrayContaining(['authorization_code', 'refresh_token']),
      );
      expect(doc.response_types_supported).toContain('code');
    });

    it('assina em RS256', async () => {
      const doc = await (await get('/.well-known/openid-configuration')).json();
      expect(doc.id_token_signing_alg_values_supported).toContain('RS256');
    });

    it('anuncia os scopes de identidade', async () => {
      const doc = await (await get('/.well-known/openid-configuration')).json();
      expect(doc.scopes_supported).toEqual(
        expect.arrayContaining(['openid', 'email', 'profile', 'groups']),
      );
    });
  });

  describe('jwks', () => {
    it('publica a chave do tenant', async () => {
      const res = await get('/jwks');
      expect(res.status).toBe(200);

      const { keys } = await res.json();
      expect(keys).toHaveLength(1);
      expect(keys[0].kty).toBe('RSA');
      expect(keys[0].alg).toBe('RS256');
      expect(keys[0].use).toBe('sig');
    });

    it('o kid publicado é o da chave ACTIVE no banco', async () => {
      const { keys } = await (await get('/jwks')).json();
      const row = await testPrisma().oidcSigningKey.findFirstOrThrow({
        where: { status: 'ACTIVE' },
      });
      expect(keys[0].kid).toBe(row.kid);
    });

    it('NÃO vaza componente privado', async () => {
      const { keys } = await (await get('/jwks')).json();
      for (const priv of ['d', 'p', 'q', 'dp', 'dq', 'qi']) {
        expect(keys[0][priv]).toBeUndefined();
      }
    });
  });

  describe('isolamento por tenant', () => {
    it('tenants diferentes têm issuer e chave diferentes', async () => {
      const outro = await createTenant({ slug: `py-${Date.now()}` });

      const docA = await (await get('/.well-known/openid-configuration')).json();
      const resB = await fetch(
        `${origin}/v1/oidc/${outro.slug}/.well-known/openid-configuration`,
      );
      const docB = await resB.json();

      expect(docA.issuer).not.toBe(docB.issuer);
      expect(docB.issuer).toBe(`${BASE}/api/v1/oidc/${outro.slug}`);

      const jwksA = await (await get('/jwks')).json();
      const jwksB = await (await fetch(`${origin}/v1/oidc/${outro.slug}/jwks`)).json();
      expect(jwksA.keys[0].kid).not.toBe(jwksB.keys[0].kid);
    });

    it('tenant inexistente não vira issuer', async () => {
      const res = await fetch(`${origin}/v1/oidc/nao-existe/.well-known/openid-configuration`);
      expect(res.status).toBe(500); // o handler do teste converte a exceção
    });
  });

  describe('authorize', () => {
    it('recusa client_id desconhecido', async () => {
      const res = await get(
        '/auth?client_id=intruso&response_type=code&scope=openid&redirect_uri=https://mau.test/cb',
      );
      // erro do protocolo, não redirect para o cliente não confiável
      expect([400, 401]).toContain(res.status);
    });

    it('recusa redirect_uri não registrada para o client válido', async () => {
      const res = await get(
        '/auth?client_id=nextcloud&response_type=code&scope=openid&redirect_uri=https://atacante.test/cb',
      );
      expect([400, 401]).toContain(res.status);
    });

    it('com parâmetros válidos, redireciona para a tela de autenticação', async () => {
      const res = await get(
        '/auth?client_id=nextcloud&response_type=code&scope=openid' +
          '&redirect_uri=https%3A%2F%2Fcloud.zux.net.br%2Fapps%2Fuser_oidc%2Fcode' +
          '&code_challenge=' +
          'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' +
          '&code_challenge_method=S256&state=abc123',
      );
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toContain(`/oidc/${slug}/interaction/`);
    });

    it('recusa quando falta PKCE', async () => {
      const res = await get(
        '/auth?client_id=nextcloud&response_type=code&scope=openid' +
          '&redirect_uri=https%3A%2F%2Fcloud.zux.net.br%2Fapps%2Fuser_oidc%2Fcode&state=abc',
      );
      // sem code_challenge o provider rejeita redirecionando com erro
      const location = res.headers.get('location') ?? '';
      expect(location).toContain('error=invalid_request');
    });
  });

  describe('cache de instância', () => {
    it('forget() força reconstrução (usado após rotação de chave)', async () => {
      const p1 = await service.forTenant(slug);
      const p2 = await service.forTenant(slug);
      expect(p2).toBe(p1);

      service.forget((await testPrisma().tenant.findFirstOrThrow({ where: { slug } })).id);
      const p3 = await service.forTenant(slug);
      expect(p3).not.toBe(p1);
    });
  });
});

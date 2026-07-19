/**
 * Chaves de assinatura do OIDC — testes de integração.
 *
 * Roda contra banco real e cripto real (AES-256-GCM com KMS_MASTER_KEY). O que
 * está sendo verificado aqui é o que sustenta a confiança de terceiros nos
 * nossos tokens: a privada nunca em claro, um kid derivado do conteúdo, uma só
 * chave assinando por vez, e a antiga sobrevivendo no JWKS depois da rotação.
 */
import { createPrivateKey, createPublicKey, createSign, createVerify } from 'node:crypto';

import { AuditService } from '../src/modules/audit/audit.service';
import { CryptoService } from '../src/modules/crypto/crypto.service';
import type { PrismaService } from '../src/modules/prisma/prisma.service';
import { jwkThumbprint, OidcKeyService } from '../src/modules/oidc/oidc-key.service';

import { testPrisma } from './setup/db';
import { createTenant } from './setup/factories';

/**
 * Monta o serviço com dependências REAIS apontando para o banco de teste.
 *
 * Não usamos Test.createTestingModule porque o PrismaService do app injeta
 * ClsService (contexto de tenant por request), que não existe fora de uma
 * requisição HTTP. O PrismaService estende PrismaClient, então o client de
 * teste satisfaz a superfície que este serviço usa.
 */
function buildService(): OidcKeyService {
  const prisma = testPrisma() as unknown as PrismaService;

  const crypto = new CryptoService();
  crypto.onModuleInit(); // carrega KMS_MASTER_KEY do ambiente

  const audit = new AuditService(prisma);
  return new OidcKeyService(prisma, crypto, audit);
}

describe('OidcKeyService', () => {
  let service: OidcKeyService;

  beforeEach(() => {
    service = buildService();
  });

  describe('ensureActiveKey', () => {
    it('cria a primeira chave do tenant', async () => {
      const tenant = await createTenant();
      const key = await service.ensureActiveKey(tenant.id);

      expect(key.alg).toBe('RS256');
      expect(key.kid).toHaveLength(43); // SHA-256 em base64url
      expect(key.privateKeyPem).toContain('BEGIN PRIVATE KEY');

      await expect(
        testPrisma().oidcSigningKey.count({ where: { tenantId: tenant.id } }),
      ).resolves.toBe(1);
    });

    it('é idempotente — segunda chamada devolve a mesma chave', async () => {
      const tenant = await createTenant();
      const first = await service.ensureActiveKey(tenant.id);
      const second = await service.ensureActiveKey(tenant.id);

      expect(second.kid).toBe(first.kid);
      await expect(
        testPrisma().oidcSigningKey.count({ where: { tenantId: tenant.id } }),
      ).resolves.toBe(1);
    });

    it('dá chaves DIFERENTES para tenants diferentes', async () => {
      const [a, b] = [await createTenant(), await createTenant()];
      const ka = await service.ensureActiveKey(a.id);
      const kb = await service.ensureActiveKey(b.id);

      expect(ka.kid).not.toBe(kb.kid);
      expect(ka.privateKeyPem).not.toBe(kb.privateKeyPem);
    });

    it('sobrevive a duas criações concorrentes (o índice parcial resolve)', async () => {
      const tenant = await createTenant();

      const results = await Promise.all([
        service.ensureActiveKey(tenant.id),
        service.ensureActiveKey(tenant.id),
        service.ensureActiveKey(tenant.id),
      ]);

      // Todas enxergam a MESMA chave e sobra exatamente uma no banco.
      const kids = new Set(results.map((r) => r.kid));
      expect(kids.size).toBe(1);
      await expect(
        testPrisma().oidcSigningKey.count({ where: { tenantId: tenant.id, status: 'ACTIVE' } }),
      ).resolves.toBe(1);
    });
  });

  describe('a privada não fica em claro', () => {
    it('a coluna guarda ciphertext, não o PEM', async () => {
      const tenant = await createTenant();
      const key = await service.ensureActiveKey(tenant.id);

      const row = await testPrisma().oidcSigningKey.findUniqueOrThrow({
        where: { kid: key.kid },
      });

      expect(row.privateKeyEnc).not.toContain('BEGIN PRIVATE KEY');
      expect(row.privateKeyEnc).toMatch(/^v1:/); // formato do CryptoService
      // e decifra de volta no mesmo PEM
      expect(key.privateKeyPem).toContain('BEGIN PRIVATE KEY');
    });

    it('o JWK público não carrega componente privado', async () => {
      const tenant = await createTenant();
      await service.ensureActiveKey(tenant.id);
      const { keys } = await service.getJwks(tenant.id);

      const jwk = keys[0] as unknown as Record<string, unknown>;
      expect(jwk.kty).toBe('RSA');
      expect(jwk.n).toBeDefined();
      expect(jwk.e).toBeDefined();
      // d, p, q, dp, dq, qi seriam a privada vazando pelo endpoint público
      for (const priv of ['d', 'p', 'q', 'dp', 'dq', 'qi']) {
        expect(jwk[priv]).toBeUndefined();
      }
    });
  });

  describe('o par realmente casa', () => {
    it('assinatura feita com a privada verifica com o JWK público', async () => {
      const tenant = await createTenant();
      const key = await service.ensureActiveKey(tenant.id);
      const { keys } = await service.getJwks(tenant.id);

      const payload = Buffer.from('token de exemplo do netx');

      const signature = createSign('RSA-SHA256')
        .update(payload)
        .sign(createPrivateKey(key.privateKeyPem));

      const publicKey = createPublicKey({
        key: keys[0] as unknown as import('node:crypto').JsonWebKey,
        format: 'jwk',
      });

      const ok = createVerify('RSA-SHA256').update(payload).verify(publicKey, signature);
      expect(ok).toBe(true);
    });

    it('o kid é o thumbprint RFC 7638 da própria chave pública', async () => {
      const tenant = await createTenant();
      const key = await service.ensureActiveKey(tenant.id);
      const { keys } = await service.getJwks(tenant.id);

      const jwk = keys[0] as unknown as { kty: string; n: string; e: string };
      expect(jwkThumbprint(jwk)).toBe(key.kid);
    });
  });

  describe('rotação', () => {
    it('troca a chave que assina e aposenta a anterior', async () => {
      const tenant = await createTenant();
      const antiga = await service.ensureActiveKey(tenant.id);
      const nova = await service.rotate(tenant.id);

      expect(nova.kid).not.toBe(antiga.kid);

      const rows = await testPrisma().oidcSigningKey.findMany({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows).toHaveLength(2);

      const anterior = rows.find((r) => r.kid === antiga.kid);
      expect(anterior?.status).toBe('RETIRED');
      expect(anterior?.retiredAt).toBeInstanceOf(Date);
      expect(anterior?.expiresAt).toBeInstanceOf(Date);
    });

    it('mantém a aposentada no JWKS — token antigo continua verificável', async () => {
      const tenant = await createTenant();
      const antiga = await service.ensureActiveKey(tenant.id);

      // token assinado ANTES da rotação
      const payload = Buffer.from('emitido antes da rotacao');
      const assinatura = createSign('RSA-SHA256')
        .update(payload)
        .sign(createPrivateKey(antiga.privateKeyPem));

      const nova = await service.rotate(tenant.id);
      const { keys } = await service.getJwks(tenant.id);

      // as duas continuam publicadas
      expect(keys.map((k) => k.kid).sort()).toEqual([antiga.kid, nova.kid].sort());

      // e o token velho ainda verifica com a chave velha do JWKS
      const jwkAntiga = keys.find((k) => k.kid === antiga.kid);
      const ok = createVerify('RSA-SHA256')
        .update(payload)
        .verify(
          createPublicKey({
            key: jwkAntiga as unknown as import('node:crypto').JsonWebKey,
            format: 'jwk',
          }),
          assinatura,
        );
      expect(ok).toBe(true);
    });

    it('nunca deixa duas chaves ACTIVE no mesmo tenant', async () => {
      const tenant = await createTenant();
      await service.ensureActiveKey(tenant.id);
      await service.rotate(tenant.id);
      await service.rotate(tenant.id);

      await expect(
        testPrisma().oidcSigningKey.count({ where: { tenantId: tenant.id, status: 'ACTIVE' } }),
      ).resolves.toBe(1);
    });

    it('registra a rotação no audit log', async () => {
      const tenant = await createTenant();
      await service.ensureActiveKey(tenant.id);
      await service.rotate(tenant.id);

      const logs = await testPrisma().auditLog.findMany({
        where: { tenantId: tenant.id, action: 'oidc.signing_key.rotated' },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('WARNING');
    });
  });

  describe('pruneExpired', () => {
    it('remove aposentada vencida e preserva a que ainda está no prazo', async () => {
      const tenant = await createTenant();
      await service.ensureActiveKey(tenant.id);
      await service.rotate(tenant.id);

      // força o vencimento da aposentada
      await testPrisma().oidcSigningKey.updateMany({
        where: { tenantId: tenant.id, status: 'RETIRED' },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await expect(service.pruneExpired(tenant.id)).resolves.toBe(1);

      const restantes = await testPrisma().oidcSigningKey.findMany({
        where: { tenantId: tenant.id },
      });
      expect(restantes).toHaveLength(1);
      expect(restantes[0].status).toBe('ACTIVE');
    });

    it('não remove nada quando não há vencidas (idempotente)', async () => {
      const tenant = await createTenant();
      await service.ensureActiveKey(tenant.id);
      await service.rotate(tenant.id);

      await expect(service.pruneExpired(tenant.id)).resolves.toBe(0);
      await expect(service.pruneExpired(tenant.id)).resolves.toBe(0);
    });
  });

  describe('getByKid', () => {
    it('encontra pela kid', async () => {
      const tenant = await createTenant();
      const key = await service.ensureActiveKey(tenant.id);

      const found = await service.getByKid(key.kid);
      expect(found?.privateKeyPem).toBe(key.privateKeyPem);
    });

    it('devolve null para kid desconhecida', async () => {
      await expect(service.getByKid('kid-que-nao-existe')).resolves.toBeNull();
    });
  });
});

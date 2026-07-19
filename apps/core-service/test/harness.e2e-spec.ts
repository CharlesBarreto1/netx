/**
 * Testa a própria harness.
 *
 * Existe porque tudo que vem depois (OIDC, revogação, ciclo de vida de
 * identidade) confia em duas garantias daqui: isolamento entre testes e a trava
 * que impede rodar contra banco de produção. Se isto quebrar, os outros testes
 * passam a mentir.
 */
import { assertIsTestDatabase, testPrisma, truncateAll } from './setup/db';
import { createTenant, createTenantWithUser, createUser } from './setup/factories';

describe('harness de integração', () => {
  describe('trava de segurança do banco', () => {
    it('aceita banco terminado em _test', () => {
      const url = 'postgresql://u:p@localhost:5432/netx_test?schema=public';
      expect(assertIsTestDatabase(url)).toBe(url);
    });

    it('RECUSA banco de produção', () => {
      expect(() => assertIsTestDatabase('postgresql://u:p@localhost:5432/netx')).toThrow(
        /não termina em "_test"/,
      );
    });

    it('recusa nome que apenas contém _test sem terminar nele', () => {
      expect(() =>
        assertIsTestDatabase('postgresql://u:p@localhost:5432/netx_test_producao'),
      ).toThrow(/não termina em "_test"/);
    });

    it('recusa URL malformada', () => {
      expect(() => assertIsTestDatabase('nao-e-uma-url')).toThrow(/inválida/);
    });
  });

  describe('conexão e schema', () => {
    it('conecta no banco de teste', async () => {
      const [row] = await testPrisma().$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
      expect(row.ok).toBe(1);
    });

    it('aplicou as migrations (tabelas centrais existem)', async () => {
      const rows = await testPrisma().$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename IN ('tenants', 'users', 'sessions', 'roles')
        ORDER BY tablename
      `;
      expect(rows.map((r) => r.tablename)).toEqual(['roles', 'sessions', 'tenants', 'users']);
    });
  });

  describe('isolamento entre testes', () => {
    it('cria um tenant com usuário', async () => {
      const { tenant, user } = await createTenantWithUser();
      expect(tenant.id).toHaveLength(36);
      expect(user.tenantId).toBe(tenant.id);
      expect(user.status).toBe('ACTIVE');
      await expect(testPrisma().tenant.count()).resolves.toBe(1);
    });

    it('não enxerga o tenant criado no teste anterior', async () => {
      // Se este teste falhar, o beforeEach de truncate parou de funcionar e
      // todos os testes seguintes viram loteria.
      await expect(testPrisma().tenant.count()).resolves.toBe(0);
      await expect(testPrisma().user.count()).resolves.toBe(0);
    });

    it('truncateAll limpa respeitando as foreign keys', async () => {
      const { tenant } = await createTenantWithUser();
      await createUser(tenant.id);
      await expect(testPrisma().user.count()).resolves.toBe(2);

      await truncateAll();

      await expect(testPrisma().user.count()).resolves.toBe(0);
      await expect(testPrisma().tenant.count()).resolves.toBe(0);
    });
  });

  describe('factories', () => {
    it('gera slug e e-mail únicos dentro do mesmo teste', async () => {
      const a = await createTenant();
      const b = await createTenant();
      expect(a.slug).not.toBe(b.slug);

      const u1 = await createUser(a.id);
      const u2 = await createUser(a.id);
      expect(u1.email).not.toBe(u2.email);
    });

    it('aceita override dos campos que o teste declara', async () => {
      const tenant = await createTenant({ slug: 'zux', name: 'Zux', country: 'PY' });
      expect(tenant.slug).toBe('zux');
      expect(tenant.country).toBe('PY');
      // e mantém os defaults do schema no resto
      expect(tenant.locale).toBe('pt-BR');
      expect(tenant.currency).toBe('BRL');
    });

    it('cria usuário SSO-only sem passwordHash', async () => {
      const { user } = await createTenantWithUser({}, { passwordHash: null });
      expect(user.passwordHash).toBeNull();
    });
  });
});

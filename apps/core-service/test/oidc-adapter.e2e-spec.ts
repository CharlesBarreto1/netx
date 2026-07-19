/**
 * Adapter de persistência do oidc-provider — testes de integração.
 *
 * Verifica o contrato que a lib espera, contra banco real. Se o adapter mentir
 * (devolver artefato vencido, perder o consumed, não revogar por grant), o
 * provider em cima dele fica inseguro de um jeito que não aparece em teste de
 * unidade com mock.
 */
import type { Adapter, AdapterPayload } from 'oidc-provider';

import { createOidcAdapter, pruneExpiredPayloads } from '../src/modules/oidc/prisma-oidc.adapter';
import type { PrismaService } from '../src/modules/prisma/prisma.service';

import { testPrisma } from './setup/db';
import { createTenant } from './setup/factories';

const HORA = 3600;

describe('PrismaOidcAdapter', () => {
  let tenantId: string;
  let AdapterClass: new (name: string) => Adapter;
  let sessions: Adapter;

  beforeEach(async () => {
    const tenant = await createTenant();
    tenantId = tenant.id;
    AdapterClass = createOidcAdapter({
      prisma: testPrisma() as unknown as PrismaService,
      tenantId,
    });
    sessions = new AdapterClass('Session');
  });

  describe('upsert e find', () => {
    it('grava e devolve o payload', async () => {
      const payload: AdapterPayload = { accountId: 'user-1', foo: 'bar' } as AdapterPayload;
      await sessions.upsert('s1', payload, HORA);

      const found = await sessions.find('s1');
      expect(found).toMatchObject({ accountId: 'user-1', foo: 'bar' });
    });

    it('devolve undefined para id inexistente', async () => {
      await expect(sessions.find('nao-existe')).resolves.toBeUndefined();
    });

    it('upsert no mesmo id sobrescreve', async () => {
      await sessions.upsert('s1', { v: 1 } as unknown as AdapterPayload, HORA);
      await sessions.upsert('s1', { v: 2 } as unknown as AdapterPayload, HORA);

      const found = await sessions.find('s1');
      expect(found).toMatchObject({ v: 2 });
      await expect(testPrisma().oidcPayload.count()).resolves.toBe(1);
    });

    it('isola tipos com o mesmo id — a PK é composta', async () => {
      const grants = new AdapterClass('Grant');
      await sessions.upsert('mesmo-id', { qual: 'session' } as unknown as AdapterPayload, HORA);
      await grants.upsert('mesmo-id', { qual: 'grant' } as unknown as AdapterPayload, HORA);

      await expect(sessions.find('mesmo-id')).resolves.toMatchObject({ qual: 'session' });
      await expect(grants.find('mesmo-id')).resolves.toMatchObject({ qual: 'grant' });
    });
  });

  describe('vencimento', () => {
    it('não devolve artefato vencido, mesmo antes da coleta', async () => {
      await sessions.upsert('s1', { a: 1 } as unknown as AdapterPayload, HORA);
      // força o vencimento no passado
      await testPrisma().oidcPayload.update({
        where: { type_id: { type: 'Session', id: 's1' } },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await expect(sessions.find('s1')).resolves.toBeUndefined();
      // e a linha AINDA está lá — o find é que a esconde
      await expect(testPrisma().oidcPayload.count()).resolves.toBe(1);
    });

    it('expiresIn 0 grava sem vencimento', async () => {
      await sessions.upsert('perene', { a: 1 } as unknown as AdapterPayload, 0);
      const row = await testPrisma().oidcPayload.findUniqueOrThrow({
        where: { type_id: { type: 'Session', id: 'perene' } },
      });
      expect(row.expiresAt).toBeNull();
      await expect(sessions.find('perene')).resolves.toMatchObject({ a: 1 });
    });
  });

  describe('consume', () => {
    it('marca como consumido sem apagar', async () => {
      const codes = new AdapterClass('AuthorizationCode');
      await codes.upsert('c1', { accountId: 'user-1' } as AdapterPayload, HORA);
      await codes.consume('c1');

      const found = await codes.find('c1');
      // continua encontrável — é assim que a lib detecta REUSO de code
      expect(found).toBeDefined();
      expect(typeof found?.consumed).toBe('number');
    });

    it('consumed vem em epoch seconds, não milissegundos', async () => {
      await sessions.upsert('s1', {} as AdapterPayload, HORA);
      await sessions.consume('s1');

      const found = await sessions.find('s1');
      const agoraSegundos = Math.floor(Date.now() / 1000);
      expect(found?.consumed).toBeGreaterThan(agoraSegundos - 60);
      expect(found?.consumed).toBeLessThanOrEqual(agoraSegundos + 1);
    });
  });

  describe('destroy', () => {
    it('apaga o artefato', async () => {
      await sessions.upsert('s1', {} as AdapterPayload, HORA);
      await sessions.destroy('s1');

      await expect(sessions.find('s1')).resolves.toBeUndefined();
      await expect(testPrisma().oidcPayload.count()).resolves.toBe(0);
    });

    it('destroy de id inexistente não explode', async () => {
      await expect(sessions.destroy('fantasma')).resolves.toBeUndefined();
    });
  });

  describe('findByUid e findByUserCode', () => {
    it('acha pela uid', async () => {
      await sessions.upsert('s1', { uid: 'uid-abc', a: 1 } as unknown as AdapterPayload, HORA);
      await expect(sessions.findByUid('uid-abc')).resolves.toMatchObject({ a: 1 });
    });

    it('acha pelo userCode', async () => {
      const device = new AdapterClass('DeviceCode');
      await device.upsert('d1', { userCode: 'WDJB-MJHT' } as AdapterPayload, HORA);
      await expect(device.findByUserCode('WDJB-MJHT')).resolves.toMatchObject({
        userCode: 'WDJB-MJHT',
      });
    });

    it('devolve undefined quando não acha', async () => {
      await expect(sessions.findByUid('nao-existe')).resolves.toBeUndefined();
      await expect(sessions.findByUserCode('NAO-EXISTE')).resolves.toBeUndefined();
    });
  });

  describe('revokeByGrantId', () => {
    it('derruba TODOS os artefatos do grant, de tipos diferentes', async () => {
      const grants = new AdapterClass('Grant');
      const refresh = new AdapterClass('RefreshToken');
      const access = new AdapterClass('AccessToken');

      await grants.upsert('g1', { grantId: 'g1' } as AdapterPayload, HORA);
      await refresh.upsert('r1', { grantId: 'g1' } as AdapterPayload, HORA);
      await access.upsert('a1', { grantId: 'g1' } as AdapterPayload, HORA);
      // de outro grant — tem que sobreviver
      await access.upsert('a2', { grantId: 'g2' } as AdapterPayload, HORA);

      await sessions.revokeByGrantId('g1');

      await expect(grants.find('g1')).resolves.toBeUndefined();
      await expect(refresh.find('r1')).resolves.toBeUndefined();
      await expect(access.find('a1')).resolves.toBeUndefined();
      await expect(access.find('a2')).resolves.toBeDefined();
    });
  });

  describe('isolamento entre tenants', () => {
    it('um tenant não enxerga artefato do outro por uid', async () => {
      const outro = await createTenant();
      const OutroAdapter = createOidcAdapter({
        prisma: testPrisma() as unknown as PrismaService,
        tenantId: outro.id,
      });

      await sessions.upsert('s1', { uid: 'uid-compartilhada' } as AdapterPayload, HORA);

      const sessoesDoOutro = new OutroAdapter('Session');
      await expect(sessoesDoOutro.findByUid('uid-compartilhada')).resolves.toBeUndefined();
    });

    it('revokeByGrantId não atravessa tenant', async () => {
      const outro = await createTenant();
      const OutroAdapter = createOidcAdapter({
        prisma: testPrisma() as unknown as PrismaService,
        tenantId: outro.id,
      });

      await new AdapterClass('AccessToken').upsert('a1', { grantId: 'g' } as AdapterPayload, HORA);
      await new OutroAdapter('AccessToken').upsert('a2', { grantId: 'g' } as AdapterPayload, HORA);

      await sessions.revokeByGrantId('g');

      // só o do tenant que revogou sumiu
      const restantes = await testPrisma().oidcPayload.findMany();
      expect(restantes).toHaveLength(1);
      expect(restantes[0].tenantId).toBe(outro.id);
    });
  });

  describe('sub desnormalizado (base da revogação no desligamento)', () => {
    it('grava accountId na coluna sub', async () => {
      await sessions.upsert('s1', { accountId: 'user-42' } as AdapterPayload, HORA);
      const row = await testPrisma().oidcPayload.findUniqueOrThrow({
        where: { type_id: { type: 'Session', id: 's1' } },
      });
      expect(row.sub).toBe('user-42');
    });

    it('permite apagar tudo de um usuário sem varrer JSON', async () => {
      await sessions.upsert('s1', { accountId: 'user-42' } as AdapterPayload, HORA);
      await new AdapterClass('RefreshToken').upsert(
        'r1',
        { accountId: 'user-42' } as AdapterPayload,
        HORA,
      );
      await sessions.upsert('s2', { accountId: 'outro-user' } as AdapterPayload, HORA);

      const { count } = await testPrisma().oidcPayload.deleteMany({
        where: { tenantId, sub: 'user-42' },
      });
      expect(count).toBe(2);
      await expect(testPrisma().oidcPayload.count()).resolves.toBe(1);
    });
  });

  describe('pruneExpiredPayloads', () => {
    it('remove vencidos e preserva vigentes', async () => {
      await sessions.upsert('vigente', {} as AdapterPayload, HORA);
      await sessions.upsert('vencido', {} as AdapterPayload, HORA);
      await testPrisma().oidcPayload.update({
        where: { type_id: { type: 'Session', id: 'vencido' } },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const prisma = testPrisma() as unknown as PrismaService;
      await expect(pruneExpiredPayloads(prisma, tenantId)).resolves.toBe(1);
      await expect(sessions.find('vigente')).resolves.toBeDefined();
      await expect(testPrisma().oidcPayload.count()).resolves.toBe(1);
    });

    it('é idempotente', async () => {
      const prisma = testPrisma() as unknown as PrismaService;
      await expect(pruneExpiredPayloads(prisma, tenantId)).resolves.toBe(0);
      await expect(pruneExpiredPayloads(prisma, tenantId)).resolves.toBe(0);
    });
  });
});

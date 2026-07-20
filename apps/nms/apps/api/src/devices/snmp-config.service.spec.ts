import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SnmpConfigService } from './snmp-config.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { DeviceJobsService } from '../queue/device-jobs.service.js';

const DEVICE_ID = '11111111-1111-1111-1111-111111111111';
const MGMT_IP = '10.33.33.104';

function jobResult(data: unknown) {
  return {
    jobId: '22222222-2222-2222-2222-222222222222',
    deviceId: DEVICE_ID,
    ok: true,
    finishedAt: '2026-07-19T00:00:00.000Z',
    durationMs: 12,
    data,
  };
}

function makeService() {
  const prisma = {
    device: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([{ id: DEVICE_ID }]) },
    deviceCredential: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const jobs = {
    enqueueAndWait: vi
      .fn()
      .mockResolvedValue(jobResult({ kind: 'sync-snmp-config', action: 'removed', file: null })),
  };
  const service = new SnmpConfigService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    jobs as unknown as DeviceJobsService,
  );
  return { service, prisma, audit, jobs };
}

describe('SnmpConfigService.removeDevice', () => {
  let ctx: ReturnType<typeof makeService>;

  beforeEach(() => {
    ctx = makeService();
  });

  it('enfileira o sync SEM community — é assim que o gateway apaga o arquivo', async () => {
    const { action } = await ctx.service.removeDevice(DEVICE_ID, MGMT_IP, 'charles');

    const job = ctx.jobs.enqueueAndWait.mock.calls[0][0];
    expect(job.kind).toBe('sync-snmp-config');
    expect(job.deviceId).toBe(DEVICE_ID);
    expect(job.params.mgmtIp).toBe(MGMT_IP);
    expect(job.params.snmpCommunityEnc).toBeUndefined();
    expect(action).toBe('removed');
  });

  it('não consulta o banco: a linha do device já não existe', async () => {
    await ctx.service.removeDevice(DEVICE_ID, MGMT_IP, 'charles');

    expect(ctx.prisma.device.findUnique).not.toHaveBeenCalled();
  });

  it('audita sem deviceId (a FK de AuditLog quebraria) e guarda o id no diff', async () => {
    await ctx.service.removeDevice(DEVICE_ID, MGMT_IP, 'charles');

    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'charles',
        action: 'device.snmp-config.sync',
        deviceId: undefined,
        diff: JSON.stringify({ deviceId: DEVICE_ID }),
      }),
    );
  });

  it('removeDeviceQuietly engole falha do gateway (o delete não pode travar)', async () => {
    ctx.jobs.enqueueAndWait.mockRejectedValue(new Error('gateway fora do ar'));

    await expect(
      ctx.service.removeDeviceQuietly(DEVICE_ID, MGMT_IP, 'charles'),
    ).resolves.toBeUndefined();
  });
});

describe('SnmpConfigService.syncDevice', () => {
  it('amarra a auditoria ao device quando ele ainda existe', async () => {
    const ctx = makeService();
    ctx.prisma.device.findUnique.mockResolvedValue({
      id: DEVICE_ID,
      mgmtIp: MGMT_IP,
      vendor: 'mikrotik',
    });
    ctx.prisma.deviceCredential.findUnique.mockResolvedValue({ snmpCommunityEnc: 'v1:iv:tag:ct' });
    ctx.jobs.enqueueAndWait.mockResolvedValue(
      jobResult({ kind: 'sync-snmp-config', action: 'written', file: '/etc/telegraf/x.conf' }),
    );

    await ctx.service.syncDevice(DEVICE_ID, 'charles');

    expect(ctx.jobs.enqueueAndWait.mock.calls[0][0].params).toMatchObject({
      mgmtIp: MGMT_IP,
      snmpCommunityEnc: 'v1:iv:tag:ct',
      vendor: 'mikrotik',
    });
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: DEVICE_ID, diff: undefined, result: 'written' }),
    );
  });

  it('404 quando o device não existe', async () => {
    const ctx = makeService();
    ctx.prisma.device.findUnique.mockResolvedValue(null);

    await expect(ctx.service.syncDevice(DEVICE_ID, 'charles')).rejects.toThrow(/não encontrado/);
    expect(ctx.jobs.enqueueAndWait).not.toHaveBeenCalled();
  });
});

describe('SnmpConfigService.reconcile', () => {
  it('manda ao gateway os devices que existem no banco', async () => {
    const ctx = makeService();
    ctx.jobs.enqueueAndWait.mockResolvedValue(
      jobResult({ kind: 'reconcile-snmp-configs', removed: ['orfao-1'], kept: 1 }),
    );

    const out = await ctx.service.reconcile('system');

    const job = ctx.jobs.enqueueAndWait.mock.calls[0][0];
    expect(job.kind).toBe('reconcile-snmp-configs');
    expect(job.params.knownDeviceIds).toEqual([DEVICE_ID]);
    expect(out).toEqual({ removed: ['orfao-1'], kept: 1 });
  });

  it('não varre com o banco vazio — apagaria a coleta do parque inteiro', async () => {
    const ctx = makeService();
    ctx.prisma.device.findMany.mockResolvedValue([]);

    expect(await ctx.service.reconcile('system')).toBeNull();
    expect(ctx.jobs.enqueueAndWait).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { DevicesService } from './devices.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { EventPublisherService } from '../events/event-publisher.service.js';
import type { SnmpConfigService } from './snmp-config.service.js';

const DEVICE = {
  id: '11111111-1111-1111-1111-111111111111',
  hostname: 'br-sp-01',
  mgmtIp: '10.33.33.104',
  vendor: 'mikrotik',
};

function makeService() {
  const prisma = {
    device: {
      findUnique: vi.fn().mockResolvedValue(DEVICE),
      delete: vi.fn().mockResolvedValue(DEVICE),
    },
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const events = { publish: vi.fn().mockResolvedValue(undefined) };
  const snmpConfig = { removeDeviceQuietly: vi.fn().mockResolvedValue(undefined) };
  const service = new DevicesService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    events as unknown as EventPublisherService,
    snmpConfig as unknown as SnmpConfigService,
  );
  return { service, prisma, audit, snmpConfig };
}

describe('DevicesService.remove', () => {
  let ctx: ReturnType<typeof makeService>;

  beforeEach(() => {
    ctx = makeService();
  });

  it('remove o perfil SNMP do Telegraf junto com o device', async () => {
    await ctx.service.remove(DEVICE.id, 'charles');

    // Sem isto o Telegraf segue pollando o IP do device apagado, para sempre.
    expect(ctx.snmpConfig.removeDeviceQuietly).toHaveBeenCalledWith(
      DEVICE.id,
      DEVICE.mgmtIp,
      'charles',
    );
  });

  it('só limpa o perfil depois que a linha some do banco', async () => {
    const order: string[] = [];
    ctx.prisma.device.delete.mockImplementation(async () => {
      order.push('delete');
      return DEVICE;
    });
    ctx.snmpConfig.removeDeviceQuietly.mockImplementation(async () => {
      order.push('snmp');
    });

    await ctx.service.remove(DEVICE.id, 'charles');

    expect(order).toEqual(['delete', 'snmp']);
  });

  it('não tenta limpar o perfil de um device que não existe', async () => {
    ctx.prisma.device.findUnique.mockResolvedValue(null);

    await expect(ctx.service.remove(DEVICE.id, 'charles')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(ctx.prisma.device.delete).not.toHaveBeenCalled();
    expect(ctx.snmpConfig.removeDeviceQuietly).not.toHaveBeenCalled();
  });

  it('audita o delete antes de apagar a linha (FK de AuditLog.deviceId)', async () => {
    await ctx.service.remove(DEVICE.id, 'charles');

    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'device.delete', deviceId: DEVICE.id, actor: 'charles' }),
    );
    expect(ctx.audit.record.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.prisma.device.delete.mock.invocationCallOrder[0],
    );
  });
});

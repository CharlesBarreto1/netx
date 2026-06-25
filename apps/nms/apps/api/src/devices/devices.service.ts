import { Injectable, NotFoundException } from '@nestjs/common';
import type { Device } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { EventPublisherService } from '../events/event-publisher.service.js';
import type { CreateDeviceDto, UpdateDeviceDto } from './device.dto.js';

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventPublisherService,
  ) {}

  findAll(): Promise<Device[]> {
    return this.prisma.device.findMany({ orderBy: { hostname: 'asc' } });
  }

  async findOne(id: string): Promise<Device> {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) throw new NotFoundException(`Device ${id} não encontrado`);
    return device;
  }

  /** Interfaces do device (speedBps convertido de BigInt para number, JSON-safe). */
  async listInterfaces(id: string) {
    await this.findOne(id);
    const ifaces = await this.prisma.interface.findMany({
      where: { deviceId: id },
      orderBy: { name: 'asc' },
    });
    return ifaces.map((i) => ({ ...i, speedBps: i.speedBps != null ? Number(i.speedBps) : null }));
  }

  async create(dto: CreateDeviceDto, actor: string): Promise<Device> {
    const device = await this.prisma.device.create({
      // vendor vem do DTO (default juniper aplicado pelo Zod). NMS multi-vendor.
      data: { ...dto },
    });
    await this.audit.record({
      actor,
      deviceId: device.id,
      action: 'device.create',
      result: 'ok',
    });
    // Canal 3 (produtor): anuncia o novo device no bus. Best-effort, fora do
    // caminho crítico — o NetX pode reagir (ex.: registrar no inventário/alarmes).
    void this.events.publish('netx-nms.device.registered', {
      deviceId: device.id,
      hostname: device.hostname,
      mgmtIp: device.mgmtIp,
      vendor: device.vendor,
      site: device.site ?? null,
    });
    return device;
  }

  async update(id: string, dto: UpdateDeviceDto, actor: string): Promise<Device> {
    await this.findOne(id);
    const device = await this.prisma.device.update({ where: { id }, data: dto });
    await this.audit.record({
      actor,
      deviceId: id,
      action: 'device.update',
      diff: JSON.stringify(dto),
      result: 'ok',
    });
    return device;
  }

  async remove(id: string, actor: string): Promise<void> {
    await this.findOne(id);
    // Audita ANTES de deletar: o FK de AuditLog.deviceId vira null no delete (onDelete:SetNull),
    // por isso guardamos o id também no diff para não perder o rastro.
    await this.audit.record({
      actor,
      deviceId: id,
      action: 'device.delete',
      diff: JSON.stringify({ id }),
      result: 'ok',
    });
    await this.prisma.device.delete({ where: { id } });
  }
}

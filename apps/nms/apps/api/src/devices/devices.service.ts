import { Injectable, NotFoundException } from '@nestjs/common';
import type { Device } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { EventPublisherService } from '../events/event-publisher.service.js';
import { SnmpConfigService } from './snmp-config.service.js';
import type { CreateDeviceDto, UpdateDeviceDto, UpsertFromCoreDto } from './device.dto.js';

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventPublisherService,
    private readonly snmpConfig: SnmpConfigService,
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

  /**
   * Upsert vindo do NetX Core. Idempotente por `coreEquipmentId`.
   *
   * Ordem de resolução, e o porquê de cada passo:
   *   1. já existe device com este coreEquipmentId → atualiza (caminho normal)
   *   2. existe device com o mesmo mgmtIp mas sem dono → ADOTA, gravando o
   *      coreEquipmentId. É o que evita conflito no parque atual, cadastrado à
   *      mão antes deste sync existir: sem isso o upsert bateria no
   *      `@@unique([mgmtIp])` e falharia pra sempre.
   *   3. nada casa → cria.
   *
   * Se o IP conflitar com device de OUTRO equipamento, deixamos o erro subir —
   * é dado inconsistente que o operador precisa resolver, não algo pra
   * sobrescrever silenciosamente.
   */
  async upsertFromCore(dto: UpsertFromCoreDto, actor: string): Promise<Device> {
    const byCore = await this.prisma.device.findUnique({
      where: { coreEquipmentId: dto.coreEquipmentId },
    });
    if (byCore) {
      const device = await this.prisma.device.update({
        where: { id: byCore.id },
        data: dto,
      });
      await this.audit.record({
        actor,
        deviceId: device.id,
        action: 'device.sync_from_core',
        diff: JSON.stringify(dto),
        result: 'ok',
      });
      return device;
    }

    const byIp = await this.prisma.device.findUnique({ where: { mgmtIp: dto.mgmtIp } });
    if (byIp && !byIp.coreEquipmentId) {
      const device = await this.prisma.device.update({
        where: { id: byIp.id },
        data: dto,
      });
      await this.audit.record({
        actor,
        deviceId: device.id,
        action: 'device.adopted_by_core',
        diff: JSON.stringify({ coreEquipmentId: dto.coreEquipmentId, mgmtIp: dto.mgmtIp }),
        result: 'ok',
      });
      return device;
    }

    return this.create(dto, actor);
  }

  /** Desvincula o device do equipamento do Core (não apaga: histórico e
   *  séries temporais continuam valendo). */
  async detachFromCore(coreEquipmentId: string, actor: string): Promise<void> {
    const device = await this.prisma.device.findUnique({ where: { coreEquipmentId } });
    if (!device) return; // idempotente
    await this.prisma.device.update({
      where: { id: device.id },
      data: { coreEquipmentId: null },
    });
    await this.audit.record({
      actor,
      deviceId: device.id,
      action: 'device.detached_from_core',
      result: 'ok',
    });
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
    const device = await this.findOne(id);
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
    // Sem isto o perfil sobrevive em telegraf.d e o Telegraf segue pollando o IP para
    // sempre — com a community antiga em claro. Depois do delete (só limpa o que de fato
    // sumiu) e tolerante a falha (gateway fora do ar não pode travar a remoção); o que
    // escapar é varrido pelo SnmpConfigReconciler no próximo boot.
    await this.snmpConfig.removeDeviceQuietly(id, device.mgmtIp, actor);
  }
}

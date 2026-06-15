/**
 * Tr069ProfilesService — CRUD de profiles homologados + leitura de conformidade
 * (drifts) pro portal TR-069 (Fase 4). Multi-tenant estrito.
 *
 * Editar um profile faz BUMP de versão → o reconciliador re-avalia os devices
 * casados no próximo ciclo (o `reconciledProfileVersion` fica defasado).
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateTr069Profile,
  Tr069DeviceComplianceDto,
  Tr069DriftDto,
  Tr069ProfileDto,
  Tr069ProfileRuleDto,
  Tr069ProfileSummaryDto,
  Tr069ReconcileResponse,
  UpdateTr069Profile,
} from '@netx/shared';
import type { Prisma, Tr069Drift, Tr069ProfileRule } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { Tr069ReconcileService } from './tr069-reconcile.service';

@Injectable()
export class Tr069ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reconcile: Tr069ReconcileService,
  ) {}

  // ── Profiles CRUD ──────────────────────────────────────────────────────────

  async list(tenantId: string): Promise<Tr069ProfileSummaryDto[]> {
    const profiles = await this.prisma.tr069Profile.findMany({
      where: { tenantId },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { rules: true, devices: true } } },
    });
    return profiles.map((p) => ({
      id: p.id,
      name: p.name,
      manufacturer: p.manufacturer,
      productClass: p.productClass,
      version: p.version,
      active: p.active,
      ruleCount: p._count.rules,
      deviceCount: p._count.devices,
      updatedAt: p.updatedAt.toISOString(),
    }));
  }

  async get(tenantId: string, id: string): Promise<Tr069ProfileDto> {
    const p = await this.prisma.tr069Profile.findFirst({
      where: { id, tenantId },
      include: { rules: true, _count: { select: { devices: true } } },
    });
    if (!p) throw new NotFoundException('Profile não encontrado');
    return this.toProfileDto(p, p._count.devices);
  }

  async create(
    tenantId: string,
    userId: string | null,
    input: CreateTr069Profile,
  ): Promise<Tr069ProfileDto> {
    const created = await this.prisma.tr069Profile.create({
      data: {
        tenantId,
        name: input.name,
        manufacturer: input.manufacturer,
        productClass: input.productClass ?? null,
        firmwarePattern: input.firmwarePattern ?? null,
        active: input.active ?? true,
        createdById: userId,
        rules: { create: (input.rules ?? []).map((r) => this.toRuleCreate(r)) },
      },
      include: { rules: true, _count: { select: { devices: true } } },
    });
    return this.toProfileDto(created, created._count.devices);
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateTr069Profile,
  ): Promise<Tr069ProfileDto> {
    const existing = await this.prisma.tr069Profile.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Profile não encontrado');

    // Bump de versão a cada edição → reconciliador re-avalia os devices casados.
    const data: Prisma.Tr069ProfileUpdateInput = { version: { increment: 1 } };
    if (input.name !== undefined) data.name = input.name;
    if (input.manufacturer !== undefined) data.manufacturer = input.manufacturer;
    if (input.productClass !== undefined) data.productClass = input.productClass ?? null;
    if (input.firmwarePattern !== undefined) data.firmwarePattern = input.firmwarePattern ?? null;
    if (input.active !== undefined) data.active = input.active;

    // Se vieram regras, substitui o conjunto inteiro (replace total).
    if (input.rules !== undefined) {
      await this.prisma.tr069ProfileRule.deleteMany({ where: { profileId: id } });
      data.rules = { create: input.rules.map((r) => this.toRuleCreate(r)) };
    }

    const updated = await this.prisma.tr069Profile.update({
      where: { id },
      data,
      include: { rules: true, _count: { select: { devices: true } } },
    });
    return this.toProfileDto(updated, updated._count.devices);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const existing = await this.prisma.tr069Profile.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Profile não encontrado');
    // Devices casados têm profile_id setado NULL (FK onDelete: SetNull).
    await this.prisma.tr069Profile.delete({ where: { id } });
  }

  // ── Conformidade (device) ───────────────────────────────────────────────────

  async deviceCompliance(tenantId: string, deviceId: string): Promise<Tr069DeviceComplianceDto> {
    const device = await this.prisma.tr069Device.findFirst({
      where: { id: deviceId, tenantId },
      select: {
        complianceStatus: true,
        profileId: true,
        lastReconciledAt: true,
        pendingRebootSince: true,
        profile: { select: { name: true } },
      },
    });
    if (!device) throw new NotFoundException('Device TR-069 não encontrado');
    const drifts = await this.prisma.tr069Drift.findMany({
      where: { tenantId, deviceId },
      orderBy: [{ resolvedAt: { sort: 'asc', nulls: 'first' } }, { lastSeenAt: 'desc' }],
      take: 100,
    });
    return {
      complianceStatus: device.complianceStatus,
      profileId: device.profileId,
      profileName: device.profile?.name ?? null,
      lastReconciledAt: device.lastReconciledAt?.toISOString() ?? null,
      pendingRebootSince: device.pendingRebootSince?.toISOString() ?? null,
      drifts: drifts.map((d) => this.toDriftDto(d)),
    };
  }

  async reconcileNow(tenantId: string, deviceId: string): Promise<Tr069ReconcileResponse> {
    const device = await this.prisma.tr069Device.findFirst({
      where: { id: deviceId, tenantId },
      select: { id: true },
    });
    if (!device) throw new NotFoundException('Device TR-069 não encontrado');
    await this.reconcile.reconcileDevice(deviceId);
    const after = await this.prisma.tr069Device.findUnique({
      where: { id: deviceId },
      select: { complianceStatus: true },
    });
    return {
      ok: true,
      complianceStatus: after?.complianceStatus ?? 'UNKNOWN',
      message: 'Reconciliação executada — drifts/SET aplicados conforme o profile.',
    };
  }

  // ── mappers ─────────────────────────────────────────────────────────────────

  private toRuleCreate(r: {
    param: string;
    valueType: string;
    source: Tr069ProfileRuleDto['source'];
    staticValue?: string | null;
    mode: Tr069ProfileRuleDto['mode'];
    requiresReboot: boolean;
    enabled: boolean;
    sortOrder: number;
  }): Prisma.Tr069ProfileRuleCreateWithoutProfileInput {
    return {
      param: r.param,
      valueType: r.valueType,
      source: r.source,
      staticValue: r.staticValue ?? null,
      mode: r.mode,
      requiresReboot: r.requiresReboot,
      enabled: r.enabled,
      sortOrder: r.sortOrder,
    };
  }

  private toRuleDto(r: Tr069ProfileRule): Tr069ProfileRuleDto {
    return {
      id: r.id,
      param: r.param,
      valueType: r.valueType,
      source: r.source,
      staticValue: r.staticValue,
      mode: r.mode,
      requiresReboot: r.requiresReboot,
      enabled: r.enabled,
      sortOrder: r.sortOrder,
    };
  }

  private toProfileDto(
    p: {
      id: string;
      name: string;
      manufacturer: string;
      productClass: string | null;
      firmwarePattern: string | null;
      version: number;
      active: boolean;
      createdAt: Date;
      updatedAt: Date;
      rules: Tr069ProfileRule[];
    },
    deviceCount: number,
  ): Tr069ProfileDto {
    return {
      id: p.id,
      name: p.name,
      manufacturer: p.manufacturer,
      productClass: p.productClass,
      firmwarePattern: p.firmwarePattern,
      version: p.version,
      active: p.active,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      rules: [...p.rules].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => this.toRuleDto(r)),
      deviceCount,
    };
  }

  private toDriftDto(d: Tr069Drift): Tr069DriftDto {
    return {
      id: d.id,
      param: d.param,
      expected: d.expected,
      actual: d.actual,
      status: d.status,
      requiresReboot: d.requiresReboot,
      attempts: d.attempts,
      detectedAt: d.detectedAt.toISOString(),
      lastSeenAt: d.lastSeenAt.toISOString(),
      resolvedAt: d.resolvedAt?.toISOString() ?? null,
    };
  }
}

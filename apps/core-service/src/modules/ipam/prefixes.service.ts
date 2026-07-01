import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IpamPrefixRole, Prisma } from '@prisma/client';
import type {
  CreateIpamPrefixRequest,
  UpdateIpamPrefixRequest,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseCidr, usableHostCount, normalizeIp } from './ip.util';
import { toBig, toDec, numToVer } from './ipam.util';

/**
 * Prefixos IPAM (supernets/subnets, v4 e v6). Hierarquia automática: ao criar,
 * o parent é o prefixo EXISTENTE mais justo que contém o novo. Como blocos CIDR
 * nunca se sobrepõem parcialmente (só disjuntos ou aninhados), a única colisão
 * possível é duplicata exata — barrada aqui e pelo índice único.
 */
@Injectable()
export class IpamPrefixesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private readonly popSel = { select: { id: true, name: true, code: true } };
  private readonly custSel = { select: { id: true, displayName: true, code: true } };
  private readonly equipSel = { select: { id: true, name: true, ipAddress: true } };

  /** Serializa Decimal→string e agrega contagem de uso pra resposta. */
  private async present(p: PrefixRow): Promise<unknown> {
    const usedCount = await this.prisma.ipamAddress.count({
      where: { prefixId: p.id, status: { not: 'FREE' } },
    });
    const version = p.version === 'V4' ? 4 : 6;
    const usable = usableHostCount(version, p.prefixLen);
    return {
      ...p,
      firstAddr: toDec(toBig(p.firstAddr)),
      lastAddr: toDec(toBig(p.lastAddr)),
      usableHosts: usable.toString(),
      usedCount,
      // % só faz sentido pra faixas pequenas; enorme em v6 → null
      utilization:
        usable > 0n && usable <= 1_000_000n
          ? Math.round((usedCount / Number(usable)) * 1000) / 10
          : null,
    };
  }

  async list(
    tenantId: string,
    filter?: { vrfId?: string | null; role?: string; q?: string },
  ) {
    const rows = await this.prisma.ipamPrefix.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(filter?.vrfId !== undefined ? { vrfId: filter.vrfId } : {}),
        ...(filter?.role ? { role: filter.role as IpamPrefixRole } : {}),
        ...(filter?.q
          ? { OR: [{ cidr: { contains: filter.q } }, { description: { contains: filter.q, mode: 'insensitive' } }] }
          : {}),
      },
      include: { pop: this.popSel, customer: this.custSel, equipment: this.equipSel },
      orderBy: [{ version: 'asc' }, { firstAddr: 'asc' }, { prefixLen: 'asc' }],
    });
    return Promise.all(rows.map((r) => this.present(r)));
  }

  private async findRaw(tenantId: string, id: string) {
    const p = await this.prisma.ipamPrefix.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { pop: this.popSel, customer: this.custSel, equipment: this.equipSel },
    });
    if (!p) throw new NotFoundException('Prefixo não encontrado');
    return p;
  }

  async findById(tenantId: string, id: string) {
    return this.present(await this.findRaw(tenantId, id));
  }

  /** Prefixo existente mais justo que contém [first,last] (pra parent). */
  private async tightestContainer(
    tenantId: string,
    vrfId: string | null,
    version: 'V4' | 'V6',
    first: bigint,
    last: bigint,
    excludeId?: string,
  ) {
    const candidates = await this.prisma.ipamPrefix.findMany({
      where: {
        tenantId,
        deletedAt: null,
        vrfId,
        version,
        firstAddr: { lte: toDec(first) },
        lastAddr: { gte: toDec(last) },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    let best: (typeof candidates)[number] | null = null;
    let bestSize: bigint | null = null;
    for (const c of candidates) {
      const size = toBig(c.lastAddr) - toBig(c.firstAddr);
      if (bestSize === null || size < bestSize) {
        best = c;
        bestSize = size;
      }
    }
    return best;
  }

  async create(tenantId: string, actorId: string, input: CreateIpamPrefixRequest) {
    let parsed;
    try {
      parsed = parseCidr(input.cidr);
    } catch (e) {
      throw new BadRequestException(`CIDR inválido: ${(e as Error).message}`);
    }
    const vrfId = input.vrfId ?? null;
    const version = numToVer(parsed.version);

    // Duplicata exata (mesmo range, mesmo vrf)?
    const dup = await this.prisma.ipamPrefix.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        vrfId,
        firstAddr: toDec(parsed.first),
        lastAddr: toDec(parsed.last),
      },
    });
    if (dup) throw new ConflictException(`Prefixo ${parsed.cidr} já existe neste VRF`);

    if (vrfId) await this.assertVrf(tenantId, vrfId);

    const parent = await this.tightestContainer(tenantId, vrfId, version, parsed.first, parsed.last);

    const created = await this.prisma.ipamPrefix.create({
      data: {
        tenantId,
        vrfId,
        parentId: parent?.id ?? null,
        cidr: parsed.cidr,
        version,
        prefixLen: parsed.prefixLen,
        firstAddr: toDec(parsed.first),
        lastAddr: toDec(parsed.last),
        role: input.role ?? 'OTHER',
        status: input.status ?? 'ACTIVE',
        vlanId: input.vlanId ?? null,
        gateway: input.gateway ? normalizeIp(input.gateway) : null,
        description: input.description ?? null,
        popId: input.popId ?? null,
        equipmentId: input.equipmentId ?? null,
        customerId: input.customerId ?? null,
        createdById: actorId,
        updatedById: actorId,
      },
      include: { pop: this.popSel, customer: this.custSel, equipment: this.equipSel },
    });

    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'ipam.prefix.created',
      resource: 'ipam_prefix',
      resourceId: created.id,
      afterState: { cidr: created.cidr, role: created.role, vlanId: created.vlanId },
    });
    return this.present(created);
  }

  async update(tenantId: string, actorId: string, id: string, input: UpdateIpamPrefixRequest) {
    const existing = await this.findRaw(tenantId, id);
    const data: Prisma.IpamPrefixUpdateInput = { updatedById: actorId };

    if (input.cidr && input.cidr !== existing.cidr) {
      let parsed;
      try {
        parsed = parseCidr(input.cidr);
      } catch (e) {
        throw new BadRequestException(`CIDR inválido: ${(e as Error).message}`);
      }
      const vrfId = input.vrfId !== undefined ? input.vrfId ?? null : existing.vrfId;
      const dup = await this.prisma.ipamPrefix.findFirst({
        where: {
          tenantId,
          deletedAt: null,
          vrfId,
          firstAddr: toDec(parsed.first),
          lastAddr: toDec(parsed.last),
          id: { not: id },
        },
      });
      if (dup) throw new ConflictException(`Prefixo ${parsed.cidr} já existe neste VRF`);
      const parent = await this.tightestContainer(
        tenantId,
        vrfId,
        numToVer(parsed.version),
        parsed.first,
        parsed.last,
        id,
      );
      data.cidr = parsed.cidr;
      data.version = numToVer(parsed.version);
      data.prefixLen = parsed.prefixLen;
      data.firstAddr = toDec(parsed.first);
      data.lastAddr = toDec(parsed.last);
      data.parent = parent ? { connect: { id: parent.id } } : { disconnect: true };
    }

    if (input.role !== undefined) data.role = input.role;
    if (input.status !== undefined) data.status = input.status;
    if (input.vlanId !== undefined) data.vlanId = input.vlanId;
    if (input.description !== undefined) data.description = input.description;
    if (input.gateway !== undefined)
      data.gateway = input.gateway ? normalizeIp(input.gateway) : null;
    if (input.vrfId !== undefined)
      data.vrf = input.vrfId ? { connect: { id: input.vrfId } } : { disconnect: true };
    if (input.popId !== undefined)
      data.pop = input.popId ? { connect: { id: input.popId } } : { disconnect: true };
    if (input.equipmentId !== undefined)
      data.equipment = input.equipmentId ? { connect: { id: input.equipmentId } } : { disconnect: true };
    if (input.customerId !== undefined)
      data.customer = input.customerId ? { connect: { id: input.customerId } } : { disconnect: true };

    const updated = await this.prisma.ipamPrefix.update({
      where: { id },
      data,
      include: { pop: this.popSel, customer: this.custSel, equipment: this.equipSel },
    });
    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'ipam.prefix.updated',
      resource: 'ipam_prefix',
      resourceId: id,
      beforeState: { cidr: existing.cidr, role: existing.role },
      afterState: { cidr: updated.cidr, role: updated.role },
    });
    return this.present(updated);
  }

  async remove(tenantId: string, actorId: string, id: string) {
    const existing = await this.findRaw(tenantId, id);
    const inUse = await this.prisma.ipamAddress.count({
      where: { prefixId: id, status: { not: 'FREE' } },
    });
    if (inUse > 0) {
      throw new ConflictException(
        `Prefixo tem ${inUse} IP(s) em uso — libere-os antes de excluir`,
      );
    }
    // Restrict FK: plano CGNAT usando este prefixo bloqueia via banco; validamos antes.
    const cgnat = await this.prisma.ipamCgnatPlan.count({
      where: { OR: [{ publicPrefixId: id }, { cgnatPrefixId: id }], deletedAt: null },
    });
    if (cgnat > 0)
      throw new ConflictException('Prefixo está em uso por um plano CGNAT');

    await this.prisma.ipamPrefix.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: actorId },
    });
    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'ipam.prefix.deleted',
      resource: 'ipam_prefix',
      resourceId: id,
      beforeState: { cidr: existing.cidr },
    });
  }

  private async assertVrf(tenantId: string, vrfId: string) {
    const v = await this.prisma.ipamVrf.findFirst({ where: { id: vrfId, tenantId } });
    if (!v) throw new BadRequestException('VRF inválido');
  }
}

type PrefixRow = Prisma.IpamPrefixGetPayload<Record<string, never>>;

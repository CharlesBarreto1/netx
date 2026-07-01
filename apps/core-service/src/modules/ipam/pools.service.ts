import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CreateIpamPoolRequest, UpdateIpamPoolRequest } from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ipToBigInt, normalizeIp, detectVersion } from './ip.util';
import { toBig, toDec, numToVer } from './ipam.util';

/**
 * Pool de IPs do IPAM (uma faixa dentro de um prefixo) usada pra alocação
 * sequencial de IP fixo pro contrato. Não é radippool do FreeRADIUS — é só a
 * "gaveta" de onde o operador tira o próximo IP livre.
 */
@Injectable()
export class IpamPoolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private present(p: PoolRow): unknown {
    return { ...p, startNum: toDec(toBig(p.startNum)), endNum: toDec(toBig(p.endNum)) };
  }

  async list(tenantId: string, prefixId?: string) {
    const rows = await this.prisma.ipamPool.findMany({
      where: { tenantId, ...(prefixId ? { prefixId } : {}) },
      include: { prefix: { select: { id: true, cidr: true } } },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.present(r));
  }

  async findById(tenantId: string, id: string) {
    const p = await this.prisma.ipamPool.findFirst({
      where: { id, tenantId },
      include: { prefix: { select: { id: true, cidr: true } } },
    });
    if (!p) throw new NotFoundException('Pool não encontrado');
    return this.present(p);
  }

  private parseRange(prefix: PrefixRow, startIp: string, endIp: string) {
    let startNum: bigint;
    let endNum: bigint;
    try {
      startNum = ipToBigInt(startIp);
      endNum = ipToBigInt(endIp);
    } catch (e) {
      throw new BadRequestException(`IP inválido: ${(e as Error).message}`);
    }
    if (detectVersion(startIp) !== detectVersion(endIp))
      throw new BadRequestException('início e fim do pool devem ser da mesma versão');
    if (numToVer(detectVersion(startIp)) !== prefix.version)
      throw new BadRequestException('versão do pool difere do prefixo');
    if (endNum < startNum) throw new BadRequestException('fim do pool antes do início');
    if (startNum < toBig(prefix.firstAddr) || endNum > toBig(prefix.lastAddr))
      throw new BadRequestException('pool fora do prefixo');
    return { startNum, endNum };
  }

  async create(tenantId: string, actorId: string, input: CreateIpamPoolRequest) {
    const prefix = await this.prisma.ipamPrefix.findFirst({
      where: { id: input.prefixId, tenantId, deletedAt: null },
    });
    if (!prefix) throw new BadRequestException('Prefixo inválido');
    const { startNum, endNum } = this.parseRange(prefix, input.rangeStart, input.rangeEnd);

    try {
      const created = await this.prisma.ipamPool.create({
        data: {
          tenantId,
          prefixId: prefix.id,
          vrfId: prefix.vrfId,
          name: input.name.trim(),
          version: prefix.version,
          rangeStart: normalizeIp(input.rangeStart),
          rangeEnd: normalizeIp(input.rangeEnd),
          startNum: toDec(startNum),
          endNum: toDec(endNum),
          description: input.description ?? null,
          isActive: input.isActive ?? true,
          createdById: actorId,
          updatedById: actorId,
        },
      });
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'ipam.pool.created',
        resource: 'ipam_pool',
        resourceId: created.id,
        afterState: { name: created.name, range: `${created.rangeStart}-${created.rangeEnd}` },
      });
      return this.present(created);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new ConflictException('Já existe um pool com esse nome');
      throw e;
    }
  }

  async update(tenantId: string, actorId: string, id: string, input: UpdateIpamPoolRequest) {
    const existing = await this.prisma.ipamPool.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Pool não encontrado');
    const data: Prisma.IpamPoolUpdateInput = { updatedById: actorId };
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.description !== undefined) data.description = input.description;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    if (input.rangeStart !== undefined || input.rangeEnd !== undefined) {
      const prefix = await this.prisma.ipamPrefix.findFirst({
        where: { id: existing.prefixId, tenantId },
      });
      if (!prefix) throw new BadRequestException('Prefixo do pool não encontrado');
      const { startNum, endNum } = this.parseRange(
        prefix,
        input.rangeStart ?? existing.rangeStart,
        input.rangeEnd ?? existing.rangeEnd,
      );
      data.rangeStart = normalizeIp(input.rangeStart ?? existing.rangeStart);
      data.rangeEnd = normalizeIp(input.rangeEnd ?? existing.rangeEnd);
      data.startNum = toDec(startNum);
      data.endNum = toDec(endNum);
    }

    const updated = await this.prisma.ipamPool.update({ where: { id }, data });
    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'ipam.pool.updated',
      resource: 'ipam_pool',
      resourceId: id,
    });
    return this.present(updated);
  }

  async remove(tenantId: string, actorId: string, id: string) {
    const existing = await this.prisma.ipamPool.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Pool não encontrado');
    await this.prisma.ipamPool.delete({ where: { id } });
    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'ipam.pool.deleted',
      resource: 'ipam_pool',
      resourceId: id,
      beforeState: { name: existing.name },
    });
  }
}

type PoolRow = Prisma.IpamPoolGetPayload<Record<string, never>>;
type PrefixRow = Prisma.IpamPrefixGetPayload<Record<string, never>>;

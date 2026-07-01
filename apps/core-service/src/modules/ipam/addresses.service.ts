import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IpamAddressStatus, Prisma } from '@prisma/client';
import type {
  AllocateNextRequest,
  CreateIpamAddressRequest,
  UpdateIpamAddressRequest,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ipToBigInt, normalizeIp, detectVersion, bigIntToIp } from './ip.util';
import { toBig, toDec, numToVer } from './ipam.util';

/**
 * IPs individuais documentados. Um IP = no máximo 1 linha (índice único por
 * tenant+vrf+addrNum), então `create` é na prática um UPSERT por endereço: se o
 * IP já existe LIVRE, é ocupado; se já tem dono diferente, conflita.
 *
 * `allocateNext` implementa o "pega o próximo IP livre" do pool/prefixo que o
 * operador usa pra fixar um IP num contrato (o vínculo com Framed-IP é feito
 * pelo IpamSyncService).
 */
@Injectable()
export class IpamAddressesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private readonly custSel = { select: { id: true, displayName: true, code: true } };
  private readonly contractSel = { select: { id: true, code: true, pppoeUsername: true } };
  private readonly equipSel = { select: { id: true, name: true } };
  private readonly prefixSel = { select: { id: true, cidr: true, vrfId: true } };

  private present(a: AddressRow): unknown {
    return { ...a, addrNum: toDec(toBig(a.addrNum)) };
  }

  async list(
    tenantId: string,
    filter?: {
      prefixId?: string;
      status?: string;
      customerId?: string;
      contractId?: string;
      equipmentId?: string;
      q?: string;
    },
  ) {
    const rows = await this.prisma.ipamAddress.findMany({
      where: {
        tenantId,
        ...(filter?.prefixId ? { prefixId: filter.prefixId } : {}),
        ...(filter?.status ? { status: filter.status as IpamAddressStatus } : {}),
        ...(filter?.customerId ? { customerId: filter.customerId } : {}),
        ...(filter?.contractId ? { contractId: filter.contractId } : {}),
        ...(filter?.equipmentId ? { equipmentId: filter.equipmentId } : {}),
        ...(filter?.q
          ? {
              OR: [
                { address: { contains: filter.q } },
                { hostname: { contains: filter.q, mode: 'insensitive' } },
                { description: { contains: filter.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        customer: this.custSel,
        contract: this.contractSel,
        equipment: this.equipSel,
        prefix: this.prefixSel,
      },
      orderBy: { addrNum: 'asc' },
      take: 1000,
    });
    return rows.map((r) => this.present(r));
  }

  async findById(tenantId: string, id: string) {
    const a = await this.prisma.ipamAddress.findFirst({
      where: { id, tenantId },
      include: {
        customer: this.custSel,
        contract: this.contractSel,
        equipment: this.equipSel,
        prefix: this.prefixSel,
      },
    });
    if (!a) throw new NotFoundException('IP não encontrado');
    return this.present(a);
  }

  /** Acha o prefixo (mais justo) que contém um endereço. */
  private async containingPrefix(tenantId: string, num: bigint, version: 'V4' | 'V6') {
    const candidates = await this.prisma.ipamPrefix.findMany({
      where: {
        tenantId,
        deletedAt: null,
        version,
        firstAddr: { lte: toDec(num) },
        lastAddr: { gte: toDec(num) },
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

  /**
   * Cria/ocupa um IP. `source` distingue cadastro manual do sync automático
   * (evita laço) — 'MANUAL' por padrão.
   */
  async create(
    tenantId: string,
    actorId: string | null,
    input: CreateIpamAddressRequest,
    source = 'MANUAL',
  ) {
    let num: bigint;
    let version: 'V4' | 'V6';
    let canonical: string;
    try {
      canonical = normalizeIp(input.address);
      num = ipToBigInt(input.address);
      version = numToVer(detectVersion(input.address));
    } catch (e) {
      throw new BadRequestException(`IP inválido: ${(e as Error).message}`);
    }

    // Resolve prefixo (informado ou o que contém o IP).
    let prefix = input.prefixId
      ? await this.prisma.ipamPrefix.findFirst({
          where: { id: input.prefixId, tenantId, deletedAt: null },
        })
      : await this.containingPrefix(tenantId, num, version);
    if (!prefix) {
      throw new BadRequestException(
        'Nenhum prefixo contém este IP — cadastre o prefixo primeiro',
      );
    }
    if (num < toBig(prefix.firstAddr) || num > toBig(prefix.lastAddr)) {
      throw new BadRequestException('IP fora do prefixo informado');
    }

    const vrfId = prefix.vrfId;
    const existing = await this.prisma.ipamAddress.findFirst({
      where: { tenantId, vrfId, addrNum: toDec(num) },
    });

    const ownerData = {
      status: (input.status ?? 'USED') as IpamAddressStatus,
      kind: input.kind ?? null,
      customerId: input.customerId ?? null,
      contractId: input.contractId ?? null,
      equipmentId: input.equipmentId ?? null,
      macAddress: input.macAddress ?? null,
      hostname: input.hostname ?? null,
      description: input.description ?? null,
      isGateway: input.isGateway ?? false,
      source,
    };

    if (existing) {
      const hasOwner = existing.contractId || existing.equipmentId || existing.customerId;
      const sameOwner =
        existing.contractId === (input.contractId ?? null) &&
        existing.equipmentId === (input.equipmentId ?? null);
      if (existing.status !== 'FREE' && hasOwner && !sameOwner) {
        throw new ConflictException(`IP ${canonical} já está em uso`);
      }
      const updated = await this.prisma.ipamAddress.update({
        where: { id: existing.id },
        data: { ...ownerData, prefixId: prefix.id, updatedById: actorId },
      });
      return this.present(updated);
    }

    const created = await this.prisma.ipamAddress.create({
      data: {
        tenantId,
        prefixId: prefix.id,
        vrfId,
        address: canonical,
        addrNum: toDec(num),
        version,
        ...ownerData,
        createdById: actorId,
        updatedById: actorId,
      },
    });
    await this.audit.log({
      tenantId,
      userId: actorId ?? undefined,
      action: 'ipam.address.created',
      resource: 'ipam_address',
      resourceId: created.id,
      afterState: { address: canonical, status: created.status, source },
    });
    return this.present(created);
  }

  async update(tenantId: string, actorId: string, id: string, input: UpdateIpamAddressRequest) {
    const existing = await this.prisma.ipamAddress.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('IP não encontrado');
    const data: Prisma.IpamAddressUpdateInput = { updatedById: actorId };
    if (input.status !== undefined) data.status = input.status;
    if (input.kind !== undefined) data.kind = input.kind;
    if (input.macAddress !== undefined) data.macAddress = input.macAddress;
    if (input.hostname !== undefined) data.hostname = input.hostname;
    if (input.description !== undefined) data.description = input.description;
    if (input.isGateway !== undefined) data.isGateway = input.isGateway;
    if (input.customerId !== undefined)
      data.customer = input.customerId ? { connect: { id: input.customerId } } : { disconnect: true };
    if (input.contractId !== undefined)
      data.contract = input.contractId ? { connect: { id: input.contractId } } : { disconnect: true };
    if (input.equipmentId !== undefined)
      data.equipment = input.equipmentId ? { connect: { id: input.equipmentId } } : { disconnect: true };

    const updated = await this.prisma.ipamAddress.update({ where: { id }, data });
    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'ipam.address.updated',
      resource: 'ipam_address',
      resourceId: id,
    });
    return this.present(updated);
  }

  /** Libera o IP (status FREE, remove vínculos). Não apaga a linha. */
  async release(tenantId: string, actorId: string | null, id: string) {
    const existing = await this.prisma.ipamAddress.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('IP não encontrado');
    await this.prisma.ipamAddress.update({
      where: { id },
      data: {
        status: 'FREE',
        kind: null,
        customerId: null,
        contractId: null,
        equipmentId: null,
        macAddress: null,
        updatedById: actorId,
      },
    });
    await this.audit.log({
      tenantId,
      userId: actorId ?? undefined,
      action: 'ipam.address.released',
      resource: 'ipam_address',
      resourceId: id,
      beforeState: { address: existing.address },
    });
  }

  /**
   * Menor IP livre num range [first,last]. Considera "livre" o que NÃO tem linha
   * ocupada (status != FREE). Pula rede/broadcast em v4 quando `skipEdges`.
   * Limita a varredura pra não travar em ranges gigantes.
   */
  async nextFreeInRange(
    tenantId: string,
    vrfId: string | null,
    first: bigint,
    last: bigint,
    skipEdges: boolean,
    version: 'V4' | 'V6',
  ): Promise<bigint | null> {
    let start = first;
    let end = last;
    if (skipEdges && version === 'V4' && end - start >= 3n) {
      start = first + 1n; // pula network
      end = last - 1n; // pula broadcast
    }
    const taken = await this.prisma.ipamAddress.findMany({
      where: {
        tenantId,
        vrfId,
        status: { not: 'FREE' },
        addrNum: { gte: toDec(start), lte: toDec(end) },
      },
      select: { addrNum: true },
      orderBy: { addrNum: 'asc' },
      take: 200_000,
    });
    const takenSet = new Set(taken.map((t) => toBig(t.addrNum).toString()));
    const MAX_SCAN = 500_000n;
    let scanned = 0n;
    for (let n = start; n <= end && scanned < MAX_SCAN; n++, scanned++) {
      if (!takenSet.has(n.toString())) return n;
    }
    return null;
  }

  /** Aloca o próximo IP livre de um prefixo ou pool e ocupa com os vínculos. */
  async allocateNext(tenantId: string, actorId: string, input: AllocateNextRequest) {
    let first: bigint;
    let last: bigint;
    let vrfId: string | null;
    let version: 'V4' | 'V6';
    let skipEdges = false;

    if (input.poolId) {
      const pool = await this.prisma.ipamPool.findFirst({
        where: { id: input.poolId, tenantId, isActive: true },
      });
      if (!pool) throw new NotFoundException('Pool não encontrado');
      first = toBig(pool.startNum);
      last = toBig(pool.endNum);
      vrfId = pool.vrfId;
      version = pool.version;
    } else {
      const prefix = await this.prisma.ipamPrefix.findFirst({
        where: { id: input.prefixId!, tenantId, deletedAt: null },
      });
      if (!prefix) throw new NotFoundException('Prefixo não encontrado');
      first = toBig(prefix.firstAddr);
      last = toBig(prefix.lastAddr);
      vrfId = prefix.vrfId;
      version = prefix.version;
      skipEdges = true;
    }

    const freeNum = await this.nextFreeInRange(tenantId, vrfId, first, last, skipEdges, version);
    if (freeNum === null) throw new ConflictException('Sem IP livre no pool/prefixo');

    const address = bigIntToIp(freeNum, version === 'V4' ? 4 : 6);
    return this.create(
      tenantId,
      actorId,
      {
        address,
        prefixId: input.prefixId ?? null,
        status: 'USED',
        kind: input.contractId ? 'CONTRACT' : input.equipmentId ? 'EQUIPMENT' : input.customerId ? 'CUSTOMER' : 'OTHER',
        customerId: input.customerId ?? null,
        contractId: input.contractId ?? null,
        equipmentId: input.equipmentId ?? null,
        description: input.description ?? null,
        isGateway: false,
      } as CreateIpamAddressRequest,
      'POOL',
    );
  }
}

type AddressRow = Prisma.IpamAddressGetPayload<Record<string, never>>;

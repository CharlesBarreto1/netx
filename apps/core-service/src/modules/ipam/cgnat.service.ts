import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CgnatExportFormat,
  CreateIpamCgnatPlanRequest,
  UpdateIpamCgnatPlanRequest,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { bigIntToIp } from './ip.util';
import { toBig } from './ipam.util';
import {
  CgnatParams,
  capacity as calcCapacity,
  mapPrivate,
  iterate,
} from './cgnat.algo';

/** Teto de linhas materializadas — /10 tem 4M IPs; acima disso peça bloco menor. */
const MAX_MATERIALIZE = 200_000;

@Injectable()
export class IpamCgnatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private present<T>(p: T): T {
    return p;
  }

  async list(tenantId: string) {
    const rows = await this.prisma.ipamCgnatPlan.findMany({
      where: { tenantId, deletedAt: null },
      include: {
        publicPrefix: { select: { id: true, cidr: true } },
        cgnatPrefix: { select: { id: true, cidr: true } },
      },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.present(r));
  }

  private async findRaw(tenantId: string, id: string) {
    const p = await this.prisma.ipamCgnatPlan.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        publicPrefix: { select: { id: true, cidr: true, version: true, firstAddr: true, lastAddr: true } },
        cgnatPrefix: { select: { id: true, cidr: true, version: true, firstAddr: true, lastAddr: true } },
      },
    });
    if (!p) throw new NotFoundException('Plano CGNAT não encontrado');
    return p;
  }

  async findById(tenantId: string, id: string) {
    const p = await this.findRaw(tenantId, id);
    return { ...this.present(p as PlanRow), capacity: this.capacityOf(p) };
  }

  private paramsOf(p: Awaited<ReturnType<IpamCgnatService['findRaw']>>): CgnatParams {
    if (p.publicPrefix.version !== 'V4' || p.cgnatPrefix.version !== 'V4')
      throw new BadRequestException('CGNAT só é aplicável a IPv4');
    return {
      publicFirst: toBig(p.publicPrefix.firstAddr),
      publicLast: toBig(p.publicPrefix.lastAddr),
      cgnatFirst: toBig(p.cgnatPrefix.firstAddr),
      cgnatLast: toBig(p.cgnatPrefix.lastAddr),
      portsPerClient: p.portsPerClient,
      portBase: p.portBase,
      maxPort: p.maxPort,
    };
  }

  private capacityOf(p: Awaited<ReturnType<IpamCgnatService['findRaw']>>) {
    const c = calcCapacity(this.paramsOf(p));
    return {
      blocksPerPublicIp: c.blocksPerPublicIp,
      publicCount: c.publicCount.toString(),
      cgnatCount: c.cgnatCount.toString(),
      capacity: c.capacity.toString(),
      sufficient: c.sufficient,
      spare: c.spare.toString(),
    };
  }

  async create(tenantId: string, actorId: string, input: CreateIpamCgnatPlanRequest) {
    const [pub, priv] = await Promise.all([
      this.prisma.ipamPrefix.findFirst({ where: { id: input.publicPrefixId, tenantId, deletedAt: null } }),
      this.prisma.ipamPrefix.findFirst({ where: { id: input.cgnatPrefixId, tenantId, deletedAt: null } }),
    ]);
    if (!pub) throw new BadRequestException('Prefixo público inválido');
    if (!priv) throw new BadRequestException('Prefixo CGNAT (privado) inválido');
    if (pub.version !== 'V4' || priv.version !== 'V4')
      throw new BadRequestException('CGNAT só é aplicável a IPv4');
    if (input.maxPort < input.portBase)
      throw new BadRequestException('maxPort deve ser >= portBase');
    if (input.maxPort - input.portBase + 1 < input.portsPerClient)
      throw new BadRequestException('faixa de portas menor que portsPerClient');

    try {
      const created = await this.prisma.ipamCgnatPlan.create({
        data: {
          tenantId,
          name: input.name.trim(),
          publicPrefixId: pub.id,
          cgnatPrefixId: priv.id,
          portsPerClient: input.portsPerClient,
          portBase: input.portBase,
          maxPort: input.maxPort,
          description: input.description ?? null,
          createdById: actorId,
          updatedById: actorId,
        },
      });
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'ipam.cgnat.plan.created',
        resource: 'ipam_cgnat_plan',
        resourceId: created.id,
        afterState: { name: created.name },
      });
      return created;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new ConflictException('Já existe um plano CGNAT com esse nome');
      throw e;
    }
  }

  async update(tenantId: string, actorId: string, id: string, input: UpdateIpamCgnatPlanRequest) {
    await this.findRaw(tenantId, id);
    const data: Prisma.IpamCgnatPlanUpdateInput = { updatedById: actorId };
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.portsPerClient !== undefined) data.portsPerClient = input.portsPerClient;
    if (input.portBase !== undefined) data.portBase = input.portBase;
    if (input.maxPort !== undefined) data.maxPort = input.maxPort;
    if (input.description !== undefined) data.description = input.description;
    if (input.publicPrefixId !== undefined)
      data.publicPrefix = { connect: { id: input.publicPrefixId } };
    if (input.cgnatPrefixId !== undefined)
      data.cgnatPrefix = { connect: { id: input.cgnatPrefixId } };

    const updated = await this.prisma.ipamCgnatPlan.update({ where: { id }, data });
    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'ipam.cgnat.plan.updated',
      resource: 'ipam_cgnat_plan',
      resourceId: id,
    });
    return updated;
  }

  async remove(tenantId: string, actorId: string, id: string) {
    const existing = await this.findRaw(tenantId, id);
    await this.prisma.$transaction([
      this.prisma.ipamCgnatEntry.deleteMany({ where: { planId: id } }),
      this.prisma.ipamCgnatPlan.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: actorId },
      }),
    ]);
    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'ipam.cgnat.plan.deleted',
      resource: 'ipam_cgnat_plan',
      resourceId: id,
      beforeState: { name: existing.name },
    });
  }

  /** Prévia sob demanda (sem persistir) — página de mapeamentos via fórmula. */
  async preview(tenantId: string, id: string, limit = 100, offset = 0) {
    const p = await this.findRaw(tenantId, id);
    const params = this.paramsOf(p);
    const cap = calcCapacity(params);
    const total = cap.sufficient ? cap.cgnatCount : cap.capacity;
    const rows: PreviewRow[] = [];
    const start = BigInt(Math.max(0, offset));
    const take = BigInt(Math.min(Math.max(1, limit), 1000));
    for (let i = start; i < start + take && i < total; i++) {
      const m = mapPrivate(params.cgnatFirst + i, params);
      rows.push({
        privateIp: bigIntToIp(m.privateNum, 4),
        publicIp: bigIntToIp(m.publicNum, 4),
        portStart: m.portStart,
        portEnd: m.portEnd,
      });
    }
    return { capacity: this.capacityOf(p), total: total.toString(), offset, limit, rows };
  }

  /**
   * Materializa a tabela CGNAT no banco (pra consulta rápida e busca reversa),
   * vinculando cada IP privado ao contrato cujo Framed-IP bate. Regenera do zero.
   */
  async materialize(tenantId: string, actorId: string, id: string) {
    const p = await this.findRaw(tenantId, id);
    const params = this.paramsOf(p);
    const cap = calcCapacity(params);
    const total = cap.sufficient ? cap.cgnatCount : cap.capacity;
    if (total > BigInt(MAX_MATERIALIZE)) {
      throw new BadRequestException(
        `Bloco grande demais pra materializar (${total} entradas, máx ${MAX_MATERIALIZE}). ` +
          'Use um bloco CGNAT menor ou consulte via prévia/busca reversa (O(1), sem tabela).',
      );
    }

    // Mapa Framed-IP → contrato, pra vincular as entradas ao cliente.
    const contracts = await this.prisma.contract.findMany({
      where: { tenantId, deletedAt: null, framedIpAddress: { not: null } },
      select: { id: true, customerId: true, framedIpAddress: true },
    });
    const byFramed = new Map<string, { contractId: string; customerId: string }>();
    for (const c of contracts) {
      if (c.framedIpAddress) byFramed.set(c.framedIpAddress, { contractId: c.id, customerId: c.customerId });
    }

    const batch: Prisma.IpamCgnatEntryCreateManyInput[] = [];
    for (const m of iterate(params)) {
      const privateIp = bigIntToIp(m.privateNum, 4);
      const link = byFramed.get(privateIp);
      batch.push({
        tenantId,
        planId: id,
        privateIp,
        privateNum: m.privateNum.toString(),
        publicIp: bigIntToIp(m.publicNum, 4),
        publicNum: m.publicNum.toString(),
        portStart: m.portStart,
        portEnd: m.portEnd,
        contractId: link?.contractId ?? null,
        customerId: link?.customerId ?? null,
      });
    }

    await this.prisma.$transaction(
      async (tx) => {
        await tx.ipamCgnatEntry.deleteMany({ where: { planId: id } });
        // createMany em lotes de 5k pra não estourar parâmetros do driver.
        for (let i = 0; i < batch.length; i += 5000) {
          await tx.ipamCgnatEntry.createMany({ data: batch.slice(i, i + 5000) });
        }
        await tx.ipamCgnatPlan.update({
          where: { id },
          data: { generatedAt: new Date(), entryCount: batch.length, updatedById: actorId },
        });
      },
      { timeout: 120_000 },
    );

    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'ipam.cgnat.plan.materialized',
      resource: 'ipam_cgnat_plan',
      resourceId: id,
      afterState: { entryCount: batch.length },
    });
    return { entryCount: batch.length };
  }

  /** Exporta regras/tabela — CSV ou config Mikrotik (srcnat determinístico). */
  async export(tenantId: string, id: string, format: CgnatExportFormat): Promise<string> {
    const p = await this.findRaw(tenantId, id);
    const params = this.paramsOf(p);
    const cap = calcCapacity(params);
    const total = cap.sufficient ? cap.cgnatCount : cap.capacity;
    if (total > BigInt(MAX_MATERIALIZE)) {
      throw new BadRequestException(`Bloco grande demais pra exportar (${total} linhas).`);
    }
    const lines: string[] = [];
    if (format === 'csv') {
      lines.push('private_ip,public_ip,port_start,port_end');
      for (const m of iterate(params)) {
        lines.push(
          `${bigIntToIp(m.privateNum, 4)},${bigIntToIp(m.publicNum, 4)},${m.portStart},${m.portEnd}`,
        );
      }
    } else {
      // Mikrotik RouterOS: src-nat determinístico por cliente (TCP+UDP).
      lines.push(`# CGNAT determinístico — plano ${p.name}`);
      lines.push('/ip firewall nat');
      for (const m of iterate(params)) {
        const priv = bigIntToIp(m.privateNum, 4);
        const pub = bigIntToIp(m.publicNum, 4);
        for (const proto of ['tcp', 'udp']) {
          lines.push(
            `add chain=srcnat action=src-nat protocol=${proto} src-address=${priv} ` +
              `to-addresses=${pub} to-ports=${m.portStart}-${m.portEnd} ` +
              `comment="cgnat ${priv} -> ${pub}:${m.portStart}-${m.portEnd}"`,
          );
        }
      }
    }
    return lines.join('\n');
  }
}

type PlanRow = Prisma.IpamCgnatPlanGetPayload<Record<string, never>>;
interface PreviewRow {
  privateIp: string;
  publicIp: string;
  portStart: number;
  portEnd: number;
}

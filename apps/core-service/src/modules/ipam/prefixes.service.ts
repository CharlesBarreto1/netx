import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IpamPrefixRole, Prisma } from '@prisma/client';
import type {
  CreateIpamPrefixRequest,
  SplitIpamPrefixRequest,
  UpdateIpamPrefixRequest,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { addressCount, parseCidr, usableHostCount, normalizeIp } from './ip.util';
import { firstFreeSubnet, freeSpace, splitIntoSubnets, type NumRange } from './freespace';
import { toBig, toDec, numToVer, verToNum } from './ipam.util';

/**
 * Prefixos IPAM (supernets/subnets, v4 e v6). Hierarquia automática: ao criar,
 * o parent é o prefixo EXISTENTE mais justo que contém o novo. Como blocos CIDR
 * nunca se sobrepõem parcialmente (só disjuntos ou aninhados), a única colisão
 * possível é duplicata exata — barrada aqui e pelo índice único.
 *
 * A hierarquia é exposta por `tree()`, e o espaço NÃO alocado por `freeOf()` /
 * `nextAvailable()` — é o que responde "qual a próxima subrede livre?".
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

  /** Porcentagem com 2 casas, em bigint (v6 estoura `number`). */
  private pct(num: bigint, den: bigint): number | null {
    if (den <= 0n) return null;
    return Number((num * 10_000n) / den) / 100;
  }

  /**
   * Estatísticas de ocupação de cada prefixo do tenant, em 2 queries (antes era
   * um COUNT por prefixo — N+1 na listagem).
   *
   * Container e folha medem coisas diferentes e a distinção importa: um /16
   * inteiramente fatiado em /24s tem ZERO endereços documentados nele mesmo, e
   * reportar "0% usado" seria mentira. Então quem tem filho é medido pelo espaço
   * que os filhos consomem (`SUBNETS`); quem não tem, pelos IPs (`ADDRESSES`).
   */
  private async loadStats(tenantId: string) {
    const [all, usedByPrefix] = await Promise.all([
      this.prisma.ipamPrefix.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, parentId: true, firstAddr: true, lastAddr: true },
      }),
      this.prisma.ipamAddress.groupBy({
        by: ['prefixId'],
        where: { tenantId, status: { not: 'FREE' } },
        _count: { _all: true },
      }),
    ]);

    const used = new Map<string, number>();
    for (const row of usedByPrefix) used.set(row.prefixId, row._count._all);

    // Soma do espaço consumido pelos filhos DIRETOS (netos já estão dentro deles).
    const childCount = new Map<string, number>();
    const allocated = new Map<string, bigint>();
    for (const p of all) {
      if (!p.parentId) continue;
      const size = toBig(p.lastAddr) - toBig(p.firstAddr) + 1n;
      childCount.set(p.parentId, (childCount.get(p.parentId) ?? 0) + 1);
      allocated.set(p.parentId, (allocated.get(p.parentId) ?? 0n) + size);
    }

    return { used, childCount, allocated };
  }

  private present(p: PrefixRow, stats: PrefixStats): PresentedPrefix {
    const version = verToNum(p.version);
    const size = addressCount(version, p.prefixLen);
    const usable = usableHostCount(version, p.prefixLen);
    const usedCount = stats.used.get(p.id) ?? 0;
    const children = stats.childCount.get(p.id) ?? 0;
    const allocatedSize = stats.allocated.get(p.id) ?? 0n;

    // Container mede subredes; folha mede endereços. Em faixas gigantes (v6, ou
    // v4 acima de /12) a % por endereço não diz nada — devolvemos null e a UI
    // mostra a contagem crua.
    const bySubnets = children > 0;
    const utilization = bySubnets
      ? this.pct(allocatedSize, size)
      : usable > 0n && usable <= 1_000_000n
        ? this.pct(BigInt(usedCount), usable)
        : null;

    return {
      ...p,
      firstAddr: toDec(toBig(p.firstAddr)),
      lastAddr: toDec(toBig(p.lastAddr)),
      size: size.toString(),
      usableHosts: usable.toString(),
      usedCount,
      childCount: children,
      allocatedSize: allocatedSize.toString(),
      freeSize: (size - allocatedSize).toString(),
      utilization,
      utilizationBasis: bySubnets ? 'SUBNETS' : 'ADDRESSES',
    };
  }

  private whereFilter(
    tenantId: string,
    filter?: { vrfId?: string | null; role?: string; q?: string },
  ): Prisma.IpamPrefixWhereInput {
    return {
      tenantId,
      deletedAt: null,
      ...(filter?.vrfId !== undefined ? { vrfId: filter.vrfId } : {}),
      ...(filter?.role ? { role: filter.role as IpamPrefixRole } : {}),
      ...(filter?.q
        ? {
            OR: [
              { cidr: { contains: filter.q } },
              { description: { contains: filter.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
  }

  async list(
    tenantId: string,
    filter?: { vrfId?: string | null; role?: string; q?: string },
  ) {
    const [rows, stats] = await Promise.all([
      this.prisma.ipamPrefix.findMany({
        where: this.whereFilter(tenantId, filter),
        include: { pop: this.popSel, customer: this.custSel, equipment: this.equipSel },
        orderBy: [{ version: 'asc' }, { firstAddr: 'asc' }, { prefixLen: 'asc' }],
      }),
      this.loadStats(tenantId),
    ]);
    return rows.map((r) => this.present(r, stats));
  }

  /**
   * Mesma listagem, mas aninhada por `parentId` — a hierarquia que já existia no
   * banco e nunca chegava na tela.
   *
   * Com busca (`q`), um filho que casa arrasta os ancestrais junto: mostrar o
   * 10.0.5.0/24 solto, fora do 10.0.0.0/8 que o contém, perderia justamente o
   * contexto que torna a árvore útil.
   */
  async tree(
    tenantId: string,
    filter?: { vrfId?: string | null; role?: string; q?: string },
  ) {
    const [rows, stats] = await Promise.all([
      this.prisma.ipamPrefix.findMany({
        where: this.whereFilter(tenantId, { vrfId: filter?.vrfId }),
        include: { pop: this.popSel, customer: this.custSel, equipment: this.equipSel },
        orderBy: [{ version: 'asc' }, { firstAddr: 'asc' }, { prefixLen: 'asc' }],
      }),
      this.loadStats(tenantId),
    ]);

    const q = filter?.q?.trim().toLowerCase();
    const role = filter?.role;
    let keep: Set<string> | null = null;

    if (q || role) {
      const byId = new Map(rows.map((r) => [r.id, r]));
      keep = new Set<string>();
      for (const r of rows) {
        const matches =
          (!q || r.cidr.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q)) &&
          (!role || r.role === role);
        if (!matches) continue;
        // Sobe até a raiz marcando os ancestrais pra não quebrar a árvore.
        let cur: (typeof rows)[number] | undefined = r;
        while (cur && !keep.has(cur.id)) {
          keep.add(cur.id);
          cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
      }
    }

    // Ranges dos filhos vindos do conjunto COMPLETO, não do filtrado: durante uma
    // busca, esconder um filho não libera o espaço que ele ocupa.
    const kidsOf = new Map<string, NumRange[]>();
    for (const r of rows) {
      if (!r.parentId) continue;
      const arr = kidsOf.get(r.parentId) ?? [];
      arr.push({ first: toBig(r.firstAddr), last: toBig(r.lastAddr) });
      kidsOf.set(r.parentId, arr);
    }

    const visible = keep ? rows.filter((r) => keep!.has(r.id)) : rows;
    const nodes = new Map<string, TreeNode>();
    for (const r of visible) {
      const version = verToNum(r.version);
      // Poucos blocos por nó: a árvore mostra as maiores aberturas, e o painel
      // lateral (`freeOf`) abre a lista completa quando o operador quer detalhe.
      const fs = freeSpace(
        { first: toBig(r.firstAddr), last: toBig(r.lastAddr) },
        kidsOf.get(r.id) ?? [],
        version,
        TREE_FREE_BLOCKS,
      );
      nodes.set(r.id, {
        ...this.present(r, stats),
        children: [],
        freeBlocks: fs.blocks.map((b) => ({
          cidr: b.cidr,
          prefixLen: b.prefixLen,
          first: b.first.toString(),
          last: b.last.toString(),
          size: b.size.toString(),
        })),
        freeTruncated: fs.truncated,
      });
    }

    const roots: TreeNode[] = [];
    for (const r of visible) {
      const node = nodes.get(r.id)!;
      const parent = r.parentId ? nodes.get(r.parentId) : undefined;
      // Sem pai visível (raiz de verdade, ou pai filtrado fora) → sobe pra raiz.
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
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
    const [row, stats] = await Promise.all([
      this.findRaw(tenantId, id),
      this.loadStats(tenantId),
    ]);
    return this.present(row, stats);
  }

  /** Ranges dos filhos diretos — o que "ocupa" espaço dentro do prefixo. */
  private async childRanges(tenantId: string, parentId: string): Promise<NumRange[]> {
    const kids = await this.prisma.ipamPrefix.findMany({
      where: { tenantId, parentId, deletedAt: null },
      select: { firstAddr: true, lastAddr: true },
    });
    return kids.map((k) => ({ first: toBig(k.firstAddr), last: toBig(k.lastAddr) }));
  }

  /** Blocos CIDR livres dentro do prefixo (o que ainda dá pra alocar). */
  async freeOf(tenantId: string, id: string, limit = 256) {
    const p = await this.findRaw(tenantId, id);
    const version = verToNum(p.version);
    const parent: NumRange = { first: toBig(p.firstAddr), last: toBig(p.lastAddr) };
    const fs = freeSpace(parent, await this.childRanges(tenantId, id), version, limit);

    return {
      prefixId: p.id,
      cidr: p.cidr,
      version: p.version,
      totalFree: fs.totalFree.toString(),
      truncated: fs.truncated,
      blocks: fs.blocks.map((b) => ({
        cidr: b.cidr,
        prefixLen: b.prefixLen,
        first: b.first.toString(),
        last: b.last.toString(),
        size: b.size.toString(),
      })),
    };
  }

  /** Primeira subrede `/prefixLen` livre dentro do prefixo (first-fit). */
  async nextAvailable(tenantId: string, id: string, prefixLen: number) {
    const p = await this.findRaw(tenantId, id);
    const version = verToNum(p.version);
    const totalBits = version === 4 ? 32 : 128;

    if (!Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > totalBits)
      throw new BadRequestException(`prefixo deve estar entre 0 e ${totalBits} para IPv${version}`);
    if (prefixLen < p.prefixLen)
      throw new BadRequestException(
        `/${prefixLen} é maior que o próprio ${p.cidr} — escolha um prefixo mais específico`,
      );

    const parent: NumRange = { first: toBig(p.firstAddr), last: toBig(p.lastAddr) };
    const block = firstFreeSubnet(parent, await this.childRanges(tenantId, id), version, prefixLen);

    return {
      prefixId: p.id,
      prefixLen,
      available: block !== null,
      cidr: block?.cidr ?? null,
      first: block ? block.first.toString() : null,
      last: block ? block.last.toString() : null,
      size: block ? block.size.toString() : null,
    };
  }

  /**
   * Fatia o prefixo em subredes `/prefixLen`, criando as que ainda não existem.
   * Pula o que já está alocado, então rodar duas vezes é idempotente.
   */
  async split(
    tenantId: string,
    actorId: string,
    id: string,
    input: SplitIpamPrefixRequest,
  ) {
    const p = await this.findRaw(tenantId, id);
    const version = verToNum(p.version);
    const totalBits = version === 4 ? 32 : 128;
    const { prefixLen } = input;

    if (prefixLen <= p.prefixLen)
      throw new BadRequestException(
        `/${prefixLen} não é menor que ${p.cidr} — nada a dividir`,
      );
    if (prefixLen > totalBits)
      throw new BadRequestException(`prefixo máximo para IPv${version} é /${totalBits}`);

    const maxCount = input.maxCount ?? 256;
    const parent: NumRange = { first: toBig(p.firstAddr), last: toBig(p.lastAddr) };
    const { blocks, truncated } = splitIntoSubnets(
      parent,
      await this.childRanges(tenantId, id),
      version,
      prefixLen,
      maxCount,
    );

    if (!blocks.length)
      throw new ConflictException(`Não há espaço livre para /${prefixLen} em ${p.cidr}`);

    await this.prisma.ipamPrefix.createMany({
      data: blocks.map((b) => ({
        tenantId,
        vrfId: p.vrfId,
        parentId: p.id,
        cidr: b.cidr,
        version: p.version,
        prefixLen: b.prefixLen,
        firstAddr: toDec(b.first),
        lastAddr: toDec(b.last),
        role: input.role ?? 'OTHER',
        status: input.status ?? 'ACTIVE',
        popId: p.popId,
        description: input.description ?? null,
        createdById: actorId,
        updatedById: actorId,
      })),
      skipDuplicates: true,
    });

    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'ipam.prefix.split',
      resource: 'ipam_prefix',
      resourceId: p.id,
      afterState: { cidr: p.cidr, into: `/${prefixLen}`, created: blocks.length },
    });

    return { created: blocks.length, truncated, cidrs: blocks.map((b) => b.cidr) };
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

  /**
   * Filhos diretos que passam a pertencer ao novo prefixo. Ao inserir um /24
   * dentro de um /16 que já tinha /28s soltos, os /28s contidos no /24 precisam
   * migrar de pai — senão a árvore fica achatada e o espaço livre, errado.
   */
  private async reparentInto(
    tenantId: string,
    newId: string,
    vrfId: string | null,
    version: 'V4' | 'V6',
    first: bigint,
    last: bigint,
    parentId: string | null,
  ) {
    await this.prisma.ipamPrefix.updateMany({
      where: {
        tenantId,
        deletedAt: null,
        vrfId,
        version,
        parentId,
        id: { not: newId },
        firstAddr: { gte: toDec(first) },
        lastAddr: { lte: toDec(last) },
      },
      data: { parentId: newId },
    });
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

    await this.reparentInto(
      tenantId,
      created.id,
      vrfId,
      version,
      parsed.first,
      parsed.last,
      parent?.id ?? null,
    );

    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'ipam.prefix.created',
      resource: 'ipam_prefix',
      resourceId: created.id,
      afterState: { cidr: created.cidr, role: created.role, vlanId: created.vlanId },
    });
    return this.present(created, await this.loadStats(tenantId));
  }

  async update(tenantId: string, actorId: string, id: string, input: UpdateIpamPrefixRequest) {
    const existing = await this.findRaw(tenantId, id);
    const data: Prisma.IpamPrefixUpdateInput = { updatedById: actorId };
    let reparent: { first: bigint; last: bigint; version: 'V4' | 'V6'; vrfId: string | null; parentId: string | null } | null =
      null;

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
      reparent = {
        first: parsed.first,
        last: parsed.last,
        version: numToVer(parsed.version),
        vrfId,
        parentId: parent?.id ?? null,
      };
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

    if (reparent)
      await this.reparentInto(
        tenantId,
        id,
        reparent.vrfId,
        reparent.version,
        reparent.first,
        reparent.last,
        reparent.parentId,
      );

    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'ipam.prefix.updated',
      resource: 'ipam_prefix',
      resourceId: id,
      beforeState: { cidr: existing.cidr, role: existing.role },
      afterState: { cidr: updated.cidr, role: updated.role },
    });
    return this.present(updated, await this.loadStats(tenantId));
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

    // Filhos sobem um nível — o `onDelete: SetNull` do FK deixaria a subárvore
    // órfã na raiz, perdendo a hierarquia que ainda é válida.
    await this.prisma.ipamPrefix.updateMany({
      where: { tenantId, parentId: id, deletedAt: null },
      data: { parentId: existing.parentId },
    });

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

/** Blocos livres exibidos por nó da árvore (o resto fica no painel de detalhe). */
const TREE_FREE_BLOCKS = 8;

type PrefixRow = Prisma.IpamPrefixGetPayload<Record<string, never>>;
type FreeBlockDto = {
  cidr: string;
  prefixLen: number;
  first: string;
  last: string;
  size: string;
};
type TreeNode = PresentedPrefix & {
  children: TreeNode[];
  freeBlocks: FreeBlockDto[];
  freeTruncated: boolean;
};
type PrefixStats = {
  used: Map<string, number>;
  childCount: Map<string, number>;
  allocated: Map<string, bigint>;
};
type PresentedPrefix = Omit<PrefixRow, 'firstAddr' | 'lastAddr'> & {
  firstAddr: string;
  lastAddr: string;
  size: string;
  usableHosts: string;
  usedCount: number;
  childCount: number;
  allocatedSize: string;
  freeSize: string;
  utilization: number | null;
  utilizationBasis: 'SUBNETS' | 'ADDRESSES';
};

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { FibermapElementsService } from '../fibermap/elements.service';
import { PrismaService } from '../prisma/prisma.service';

export interface CreatePopInput {
  name: string;
  code?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  /** Coordenadas pro mapa de Rede. Aceita number | null | undefined. */
  latitude?: number | null;
  longitude?: number | null;
  notes?: string | null;
  isActive?: boolean;
}

export type UpdatePopInput = Partial<CreatePopInput>;

/**
 * Converte Decimal (Prisma) em number puro pro JSON. Pra os outros campos
 * o spread vale, mas Decimal precisa de unwrap pra bater com DTO Response.
 */
function toResponse<T extends { latitude?: unknown; longitude?: unknown }>(
  pop: T,
): T & { latitude: number | null; longitude: number | null } {
  return {
    ...pop,
    latitude: pop.latitude != null ? Number(pop.latitude) : null,
    longitude: pop.longitude != null ? Number(pop.longitude) : null,
  } as T & { latitude: number | null; longitude: number | null };
}

@Injectable()
export class NetworkPopsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    // Costura planta → FiberMap: o POP nasce já presente no mapa.
    private readonly fibermapElements: FibermapElementsService,
  ) {}

  async list(tenantId: string) {
    const rows = await this.prisma.networkPop.findMany({
      where: { tenantId, deletedAt: null },
      include: { _count: { select: { equipment: true } } },
      orderBy: { name: 'asc' },
    });
    return rows.map(toResponse);
  }

  async findById(tenantId: string, id: string) {
    const pop = await this.prisma.networkPop.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { equipment: { where: { deletedAt: null } } },
    });
    if (!pop) throw new NotFoundException('POP não encontrado');
    return toResponse(pop);
  }

  async create(tenantId: string, actorUserId: string, input: CreatePopInput) {
    try {
      const pop = await this.prisma.$transaction(async (tx) => {
      const created = await tx.networkPop.create({
        data: {
          tenantId,
          name: input.name.trim(),
          code: input.code?.trim() || null,
          city: input.city?.trim() || null,
          state: input.state?.trim() || null,
          address: input.address?.trim() || null,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          notes: input.notes ?? null,
          isActive: input.isActive ?? true,
          createdById: actorUserId,
          updatedById: actorUserId,
        },
      });

      // O POP nasce JÁ presente na planta óptica. Era isto que faltava: até
      // aqui cadastrar um POP em Técnico não fazia nada aparecer no FiberMap,
      // e o operador tinha que desenhá-lo de novo lá — os dois cadastros
      // divergindo desde o primeiro dia. Mesma transação de propósito: se o
      // elemento não puder ser criado, o POP também não é.
      await this.fibermapElements.ensureElementForPop(tx, tenantId, actorUserId, created);

      return created;
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'network.pop.created',
        resource: 'network_pops',
        resourceId: pop.id,
        afterState: { name: pop.name, code: pop.code, city: pop.city },
      });
      return toResponse(pop);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Já existe POP com esse nome ou código');
      }
      throw err;
    }
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdatePopInput,
  ) {
    const before = await this.findById(tenantId, id);
    try {
      const pop = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.networkPop.update({
        where: { id: before.id },
        data: {
          name: input.name?.trim(),
          code: input.code === undefined ? undefined : input.code?.trim() || null,
          city: input.city === undefined ? undefined : input.city?.trim() || null,
          state: input.state === undefined ? undefined : input.state?.trim() || null,
          address:
            input.address === undefined ? undefined : input.address?.trim() || null,
          latitude: input.latitude === undefined ? undefined : input.latitude ?? null,
          longitude:
            input.longitude === undefined ? undefined : input.longitude ?? null,
          notes: input.notes === undefined ? undefined : input.notes ?? null,
          isActive: input.isActive,
          updatedById: actorUserId,
        },
      });

      // Mantém o espelho na planta óptica em dia. Também cobre o POP legado
      // (sem coordenada) que acabou de GANHAR uma: nesse update ele finalmente
      // passa a existir no mapa, sem precisar de backfill.
      await this.fibermapElements.ensureElementForPop(tx, tenantId, actorUserId, updated);

      return updated;
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'network.pop.updated',
        resource: 'network_pops',
        resourceId: pop.id,
      });
      return toResponse(pop);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Já existe POP com esse nome ou código');
      }
      throw err;
    }
  }

  async remove(tenantId: string, actorUserId: string, id: string) {
    const before = await this.findById(tenantId, id);
    await this.prisma.networkPop.update({
      where: { id: before.id },
      data: { deletedAt: new Date(), updatedById: actorUserId },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'network.pop.deleted',
      resource: 'network_pops',
      resourceId: before.id,
    });
  }
}

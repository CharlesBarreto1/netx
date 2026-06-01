import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type {
  CreateServiceOrderReasonRequest,
  ListServiceOrderReasonsQuery,
  ServiceOrderReasonResponse,
  UpdateServiceOrderReasonRequest,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * CRUD do cadastro de motivos de O.S. Fica em /v1/service-order-reasons.
 *
 * Convenções:
 *   - "Excluir" = soft toggle: marca isActive=false. Não deletamos linha
 *     porque há FK em ServiceOrder e queremos preservar histórico.
 *   - List default só traz ativos; passar ?includeInactive=true pra ver tudo.
 *   - Unique constraint em (tenantId, name): erro P2002 vira 409.
 */
@Injectable()
export class ServiceOrderReasonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenantId: string,
    q: ListServiceOrderReasonsQuery,
  ): Promise<ServiceOrderReasonResponse[]> {
    const rows = await this.prisma.serviceOrderReason.findMany({
      where: {
        tenantId,
        ...(q.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toResponse);
  }

  async findById(tenantId: string, id: string): Promise<ServiceOrderReasonResponse> {
    const row = await this.prisma.serviceOrderReason.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Motivo de O.S não encontrado');
    return toResponse(row);
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateServiceOrderReasonRequest,
  ): Promise<ServiceOrderReasonResponse> {
    try {
      const row = await this.prisma.serviceOrderReason.create({
        data: {
          tenantId,
          name: input.name.trim(),
          description: input.description ?? null,
          isActive: input.isActive ?? true,
          kind: input.kind ?? 'SUPPORT',
          // isInstallation segue o kind (fonte de verdade do fluxo /os).
          isInstallation: (input.kind ?? 'SUPPORT') === 'INSTALLATION',
          order: input.order ?? 0,
        },
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'service_order_reason.created',
        resource: 'service_order_reasons',
        resourceId: row.id,
        afterState: { name: row.name, isActive: row.isActive },
      });
      return toResponse(row);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `Já existe um motivo com o nome "${input.name}"`,
        );
      }
      throw err;
    }
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateServiceOrderReasonRequest,
  ): Promise<ServiceOrderReasonResponse> {
    const before = await this.prisma.serviceOrderReason.findFirst({
      where: { id, tenantId },
    });
    if (!before) throw new NotFoundException('Motivo de O.S não encontrado');

    try {
      const row = await this.prisma.serviceOrderReason.update({
        where: { id },
        data: {
          name: input.name?.trim(),
          description: input.description,
          isActive: input.isActive,
          kind: input.kind,
          // Se o kind mudou, sincroniza isInstallation; senão respeita o input.
          isInstallation:
            input.kind !== undefined
              ? input.kind === 'INSTALLATION'
              : input.isInstallation,
          order: input.order,
        },
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'service_order_reason.updated',
        resource: 'service_order_reasons',
        resourceId: id,
        beforeState: { isActive: before.isActive, name: before.name },
        afterState: { isActive: row.isActive, name: row.name },
      });
      return toResponse(row);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `Já existe um motivo com o nome "${input.name}"`,
        );
      }
      throw err;
    }
  }

  /**
   * Não deletamos de verdade pra preservar referências em O.S antigas. Vira
   * inactive — pode ser reativado depois.
   */
  async deactivate(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const before = await this.prisma.serviceOrderReason.findFirst({
      where: { id, tenantId },
    });
    if (!before) throw new NotFoundException('Motivo de O.S não encontrado');

    if (!before.isActive) return;

    await this.prisma.serviceOrderReason.update({
      where: { id },
      data: { isActive: false },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'service_order_reason.deactivated',
      resource: 'service_order_reasons',
      resourceId: id,
    });
  }
}

function toResponse(r: any): ServiceOrderReasonResponse {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    description: r.description,
    isActive: r.isActive,
    isInstallation: r.isInstallation ?? false,
    kind: r.kind ?? 'SUPPORT',
    order: r.order,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

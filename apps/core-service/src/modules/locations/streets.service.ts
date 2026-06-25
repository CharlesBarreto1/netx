import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type {
  CreateStreetRequest,
  StreetResponse,
  UpdateStreetRequest,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { assertBrTenant } from './br-tenant.util';

@Injectable()
export class StreetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getById(tenantId: string, id: string): Promise<StreetResponse> {
    await assertBrTenant(this.prisma, tenantId);
    const row = await this.prisma.street.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Logradouro não encontrado');
    return toResponse(row);
  }

  async list(
    tenantId: string,
    query: { cityId: string; q?: string; cep?: string },
  ): Promise<StreetResponse[]> {
    await assertBrTenant(this.prisma, tenantId);
    await this.assertCity(tenantId, query.cityId);
    const rows = await this.prisma.street.findMany({
      where: {
        tenantId,
        cityId: query.cityId,
        ...(query.cep ? { postalCode: query.cep } : {}),
        ...(query.q
          ? { name: { contains: query.q, mode: 'insensitive' } }
          : {}),
      },
      orderBy: [{ name: 'asc' }],
    });
    return rows.map(toResponse);
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateStreetRequest,
  ): Promise<StreetResponse> {
    await assertBrTenant(this.prisma, tenantId);
    await this.assertCity(tenantId, input.cityId);
    if (input.neighborhoodId) {
      await this.assertNeighborhood(tenantId, input.cityId, input.neighborhoodId);
    }
    let row;
    try {
      row = await this.prisma.street.create({
        data: {
          tenantId,
          cityId: input.cityId,
          neighborhoodId: input.neighborhoodId ?? null,
          name: input.name,
          postalCode: input.postalCode ?? null,
          kind: input.kind ?? null,
        },
      });
    } catch (e) {
      throw mapDup(e);
    }
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'location.street.created',
      resource: 'locations',
      resourceId: row.id,
      afterState: { cityId: row.cityId, name: row.name, postalCode: row.postalCode },
    });
    return toResponse(row);
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateStreetRequest,
  ): Promise<StreetResponse> {
    await assertBrTenant(this.prisma, tenantId);
    const before = await this.prisma.street.findFirst({
      where: { id, tenantId },
      select: { id: true, cityId: true },
    });
    if (!before) throw new NotFoundException('Logradouro não encontrado');
    if (input.neighborhoodId) {
      await this.assertNeighborhood(tenantId, before.cityId, input.neighborhoodId);
    }
    let row;
    try {
      row = await this.prisma.street.update({
        where: { id },
        data: {
          neighborhoodId: input.neighborhoodId,
          name: input.name,
          postalCode: input.postalCode,
          kind: input.kind,
        },
      });
    } catch (e) {
      throw mapDup(e);
    }
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'location.street.updated',
      resource: 'locations',
      resourceId: id,
      afterState: { name: row.name, postalCode: row.postalCode },
    });
    return toResponse(row);
  }

  async remove(tenantId: string, actorUserId: string, id: string): Promise<void> {
    await assertBrTenant(this.prisma, tenantId);
    await this.assertExists(tenantId, id);
    try {
      await this.prisma.street.delete({ where: { id } });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2003'
      ) {
        throw new ConflictException(
          'Logradouro vinculado a contratos; não pode ser removido',
        );
      }
      throw e;
    }
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'location.street.deleted',
      resource: 'locations',
      resourceId: id,
    });
  }

  private async assertCity(tenantId: string, cityId: string): Promise<void> {
    const c = await this.prisma.city.findFirst({
      where: { id: cityId, tenantId },
      select: { id: true },
    });
    if (!c) throw new NotFoundException('Cidade não encontrada');
  }

  private async assertNeighborhood(
    tenantId: string,
    cityId: string,
    neighborhoodId: string,
  ): Promise<void> {
    const n = await this.prisma.neighborhood.findFirst({
      where: { id: neighborhoodId, tenantId, cityId },
      select: { id: true },
    });
    if (!n)
      throw new BadRequestException(
        'Bairro não pertence à cidade informada',
      );
  }

  private async assertExists(tenantId: string, id: string): Promise<void> {
    const s = await this.prisma.street.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!s) throw new NotFoundException('Logradouro não encontrado');
  }
}

function mapDup(e: unknown): Error {
  if (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === 'P2002'
  ) {
    return new ConflictException(
      'Logradouro já cadastrado (mesmo nome e CEP) nesta cidade',
    );
  }
  return e as Error;
}

function toResponse(s: {
  id: string;
  cityId: string;
  neighborhoodId: string | null;
  name: string;
  postalCode: string | null;
  kind: string | null;
  createdAt: Date;
  updatedAt: Date;
}): StreetResponse {
  return {
    id: s.id,
    cityId: s.cityId,
    neighborhoodId: s.neighborhoodId,
    name: s.name,
    postalCode: s.postalCode,
    kind: s.kind,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

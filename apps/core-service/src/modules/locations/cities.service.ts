import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type {
  CityResponse,
  CreateCityRequest,
  UpdateCityRequest,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { assertBrTenant } from './br-tenant.util';

@Injectable()
export class CitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenantId: string,
    query: { q?: string; uf?: string; active?: boolean },
  ): Promise<CityResponse[]> {
    await assertBrTenant(this.prisma, tenantId);
    const rows = await this.prisma.city.findMany({
      where: {
        tenantId,
        ...(query.uf ? { uf: query.uf } : {}),
        ...(query.active != null ? { active: query.active } : {}),
        ...(query.q
          ? { name: { contains: query.q, mode: 'insensitive' } }
          : {}),
      },
      orderBy: [{ name: 'asc' }],
    });
    return rows.map(toCityResponse);
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateCityRequest,
  ): Promise<CityResponse> {
    await assertBrTenant(this.prisma, tenantId);

    // Se a referência IBGE existir (seed rodado), valida o código e confere a UF.
    const muni = await this.prisma.ibgeMunicipality.findUnique({
      where: { codigo: input.ibgeCode },
      select: { uf: true },
    });
    if (muni && muni.uf !== input.uf) {
      throw new BadRequestException(
        `UF "${input.uf}" não confere com o município IBGE (${muni.uf})`,
      );
    }

    let row;
    try {
      row = await this.prisma.city.create({
        data: {
          tenantId,
          ibgeCode: input.ibgeCode,
          name: input.name,
          uf: input.uf,
          active: input.active,
          latitude:
            input.latitude != null ? new Prisma.Decimal(input.latitude) : null,
          longitude:
            input.longitude != null ? new Prisma.Decimal(input.longitude) : null,
        },
      });
    } catch (e) {
      throw this.mapKnownError(e);
    }

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'location.city.created',
      resource: 'locations',
      resourceId: row.id,
      afterState: { ibgeCode: row.ibgeCode, name: row.name, uf: row.uf },
    });
    return toCityResponse(row);
  }

  async update(
    tenantId: string,
    actorUserId: string,
    cityId: string,
    input: UpdateCityRequest,
  ): Promise<CityResponse> {
    await assertBrTenant(this.prisma, tenantId);
    await this.assertCity(tenantId, cityId);

    const row = await this.prisma.city.update({
      where: { id: cityId },
      data: {
        name: input.name,
        uf: input.uf,
        active: input.active,
        latitude:
          input.latitude === undefined
            ? undefined
            : input.latitude === null
              ? null
              : new Prisma.Decimal(input.latitude),
        longitude:
          input.longitude === undefined
            ? undefined
            : input.longitude === null
              ? null
              : new Prisma.Decimal(input.longitude),
      },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'location.city.updated',
      resource: 'locations',
      resourceId: cityId,
      afterState: { name: row.name, active: row.active },
    });
    return toCityResponse(row);
  }

  async remove(
    tenantId: string,
    actorUserId: string,
    cityId: string,
  ): Promise<void> {
    await assertBrTenant(this.prisma, tenantId);
    await this.assertCity(tenantId, cityId);
    try {
      await this.prisma.city.delete({ where: { id: cityId } });
    } catch (e) {
      // FK de Street (Cascade) limpa bairros/ruas; se um contrato referencia
      // uma rua da cidade, o delete falha (RESTRICT na FK street->contract).
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2003'
      ) {
        throw new ConflictException(
          'Cidade tem ruas vinculadas a contratos; não pode ser removida',
        );
      }
      throw e;
    }
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'location.city.deleted',
      resource: 'locations',
      resourceId: cityId,
    });
  }

  private async assertCity(tenantId: string, cityId: string): Promise<void> {
    const c = await this.prisma.city.findFirst({
      where: { id: cityId, tenantId },
      select: { id: true },
    });
    if (!c) throw new NotFoundException('Cidade não encontrada');
  }

  private mapKnownError(e: unknown): Error {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002')
        return new ConflictException('Cidade já cadastrada (mesmo IBGE)');
      if (e.code === 'P2003')
        return new BadRequestException(
          'Código IBGE inexistente na referência nacional (rode o seed do IBGE)',
        );
    }
    return e as Error;
  }
}

function toCityResponse(c: {
  id: string;
  ibgeCode: string;
  name: string;
  uf: string;
  active: boolean;
  latitude: Prisma.Decimal | null;
  longitude: Prisma.Decimal | null;
  createdAt: Date;
  updatedAt: Date;
}): CityResponse {
  return {
    id: c.id,
    ibgeCode: c.ibgeCode,
    name: c.name,
    uf: c.uf,
    active: c.active,
    latitude: c.latitude ? Number(c.latitude) : null,
    longitude: c.longitude ? Number(c.longitude) : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

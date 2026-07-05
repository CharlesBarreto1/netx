/**
 * FibermapAttenuationService — defaults de atenuação por tenant (spec §5.3).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * As 19 chaves são seedadas por tenant no seed do catálogo (valores de fábrica
 * ficam pinados — mudar constante depois não altera tenants existentes). O GET
 * preenche defensivamente chaves ausentes com o default de fábrica; o PATCH
 * faz upsert parcial (só as chaves enviadas).
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  FIBERMAP_ATTENUATION_DEFAULTS,
  FIBERMAP_ATTENUATION_KEYS,
  isFibermapAttenuationKey,
  type FibermapAttenuationKey,
  type FibermapAttenuationResponse,
  type PatchFibermapAttenuationRequest,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FibermapAttenuationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(tenantId: string): Promise<FibermapAttenuationResponse> {
    const rows = await this.prisma.fibermapAttenuationDefault.findMany({
      where: { tenantId },
    });
    const values = { ...FIBERMAP_ATTENUATION_DEFAULTS };
    const overridden: FibermapAttenuationKey[] = [];
    for (const row of rows) {
      if (!isFibermapAttenuationKey(row.itemKey)) continue; // chave legada
      const v = Number(row.valueDb);
      values[row.itemKey] = v;
      if (v !== FIBERMAP_ATTENUATION_DEFAULTS[row.itemKey]) {
        overridden.push(row.itemKey);
      }
    }
    return { values, overridden };
  }

  async patch(
    tenantId: string,
    actorUserId: string,
    input: PatchFibermapAttenuationRequest,
  ): Promise<FibermapAttenuationResponse> {
    const entries = Object.entries(input.values).filter(
      (e): e is [FibermapAttenuationKey, number] =>
        isFibermapAttenuationKey(e[0]),
    );
    await this.prisma.$transaction(
      entries.map(([itemKey, value]) =>
        this.prisma.fibermapAttenuationDefault.upsert({
          where: { tenantId_itemKey: { tenantId, itemKey } },
          update: {
            valueDb: new Prisma.Decimal(value),
            updatedById: actorUserId,
          },
          create: {
            tenantId,
            itemKey,
            valueDb: new Prisma.Decimal(value),
            updatedById: actorUserId,
          },
        }),
      ),
    );
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.attenuation.updated',
      resource: 'fibermap_attenuation_defaults',
      afterState: Object.fromEntries(entries),
    });
    return this.get(tenantId);
  }

  /**
   * Seed idempotente das 19 chaves (create-if-missing, nunca sobrescreve).
   * Chamado pelo seed do catálogo e reutilizável em provisionamento de tenant.
   */
  async seedDefaults(tenantId: string): Promise<number> {
    let created = 0;
    for (const itemKey of FIBERMAP_ATTENUATION_KEYS) {
      const res = await this.prisma.fibermapAttenuationDefault.createMany({
        data: [
          {
            tenantId,
            itemKey,
            valueDb: new Prisma.Decimal(FIBERMAP_ATTENUATION_DEFAULTS[itemKey]),
          },
        ],
        skipDuplicates: true,
      });
      created += res.count;
    }
    return created;
  }
}

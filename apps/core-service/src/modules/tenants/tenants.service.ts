import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import {
  getCountryPreset,
  type CreateTenantRequest,
  type TenantResponse,
  type UpdateTenantSettingsRequest,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateTenantRequest): Promise<TenantResponse> {
    const existing = await this.prisma.tenant.findUnique({ where: { slug: input.slug } });
    if (existing) throw new ConflictException(`Tenant slug "${input.slug}" already exists`);

    const tenant = await this.prisma.tenant.create({
      data: {
        slug: input.slug,
        name: input.name,
        legalName: input.legalName,
        taxId: input.taxId,
        country: input.country,
        locale: input.locale,
        timezone: input.timezone,
        currency: input.currency,
      },
    });
    return this.toResponse(tenant);
  }

  async findById(id: string): Promise<TenantResponse> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return this.toResponse(tenant);
  }

  async findBySlug(slug: string): Promise<TenantResponse> {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return this.toResponse(tenant);
  }

  /**
   * Atualiza as parametrizações da operação. Se `applyCountryDefaults=true`
   * E `country` foi informado, sobrescreve locale/currency/timezone com o
   * preset do país (a menos que o admin tenha mandado valores explícitos
   * pra esses campos no mesmo request — explicit wins).
   */
  async updateSettings(
    tenantId: string,
    input: UpdateTenantSettingsRequest,
  ): Promise<TenantResponse> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.legalName !== undefined) data.legalName = input.legalName;
    if (input.taxId !== undefined) data.taxId = input.taxId;
    if (input.country !== undefined) data.country = input.country;

    // Aplicar presets do país se requisitado e country informado.
    if (input.applyCountryDefaults && input.country) {
      const preset = getCountryPreset(input.country);
      // Explicit-wins: se o request também trouxe locale/currency/timezone,
      // respeitamos. Caso contrário, aplicamos o preset.
      if (input.locale === undefined) data.locale = preset.locale;
      if (input.currency === undefined) data.currency = preset.currency;
      if (input.timezone === undefined) data.timezone = preset.timezone;
    }
    if (input.locale !== undefined) data.locale = input.locale;
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.timezone !== undefined) data.timezone = input.timezone;

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data,
    });
    return this.toResponse(updated);
  }

  private toResponse(t: any): TenantResponse {
    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      legalName: t.legalName,
      taxId: t.taxId,
      country: t.country,
      locale: t.locale,
      timezone: t.timezone,
      currency: t.currency,
      status: t.status,
      trialEndsAt: t.trialEndsAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }
}

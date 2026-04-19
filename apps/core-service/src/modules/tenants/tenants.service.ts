import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import type { CreateTenantRequest, TenantResponse } from '@netx/shared';

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

import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CreateTenantRequestSchema, type CreateTenantRequest } from '@netx/shared';
import { RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { TenantsService } from './tenants.service';

@ApiTags('tenants')
@ApiBearerAuth()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  // Creating a new tenant is a superadmin-only operation (cross-tenant).
  @Post()
  @RequirePermissions('tenants.update')
  async create(@ZodBody(CreateTenantRequestSchema) body: CreateTenantRequest) {
    return this.tenants.create(body);
  }

  @Get(':id')
  @RequirePermissions('tenants.read')
  async findOne(@Param('id') id: string) {
    return this.tenants.findById(id);
  }
}

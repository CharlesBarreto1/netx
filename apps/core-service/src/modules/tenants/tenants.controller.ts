import { Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import {
  CreateTenantRequestSchema,
  UpdateTenantSettingsRequestSchema,
  type AuthenticatedPrincipal,
  type CreateTenantRequest,
  type UpdateTenantSettingsRequest,
} from '@netx/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
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

  /**
   * GET /v1/tenants/me — retorna o tenant atual do usuário autenticado.
   * Qualquer usuário autenticado pode ler (frontend usa pra montar moeda,
   * locale e tipos de documento).
   */
  @Get('me')
  async getMe(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.tenants.findById(user.tenantId);
  }

  /**
   * PATCH /v1/tenants/me — atualiza parametrizações da operação. Restrito
   * a `tenants.update` (admin do tenant).
   */
  @Patch('me')
  @RequirePermissions('tenants.update')
  async updateMe(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(UpdateTenantSettingsRequestSchema) body: UpdateTenantSettingsRequest,
  ) {
    return this.tenants.updateSettings(user.tenantId, body);
  }

  @Get(':id')
  @RequirePermissions('tenants.read')
  async findOne(@Param('id') id: string) {
    return this.tenants.findById(id);
  }
}

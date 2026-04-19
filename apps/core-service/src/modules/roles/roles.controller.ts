import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import type { AuthenticatedPrincipal } from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { RolesService } from './roles.service';

const CreateRoleSchema = z.object({
  name: z.string().min(2).max(64),
  description: z.string().max(255).optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  permissionCodes: z.array(z.string()).min(1),
});
type CreateRoleDto = z.infer<typeof CreateRoleSchema>;

@ApiTags('roles')
@ApiBearerAuth()
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('roles')
  @RequirePermissions('roles.read')
  list(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.roles.list(user.tenantId);
  }

  @Post('roles')
  @RequirePermissions('roles.create')
  create(@CurrentUser() user: AuthenticatedPrincipal, @ZodBody(CreateRoleSchema) body: CreateRoleDto) {
    return this.roles.create({ tenantId: user.tenantId, ...body });
  }

  @Delete('roles/:id')
  @HttpCode(204)
  @RequirePermissions('roles.delete')
  async remove(@CurrentUser() user: AuthenticatedPrincipal, @Param('id') id: string) {
    await this.roles.delete(user.tenantId, id);
  }

  @Get('permissions')
  @RequirePermissions('roles.read')
  listPermissions() {
    return this.roles.listPermissions();
  }
}

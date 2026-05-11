import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import {
  CreateUserRequestSchema,
  UpdateMyUserRequestSchema,
  UpdateUserRequestSchema,
  type CreateUserRequest,
  type UpdateMyUserRequest,
  type UpdateUserRequest,
  type AuthenticatedPrincipal,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('search') search?: string,
  ) {
    return this.users.list(user.tenantId, Math.max(1, Number(page)), Math.min(100, Math.max(1, Number(pageSize))), search);
  }

  /**
   * GET /v1/users/me — eu mesmo. Sem requerer `users.read` (qualquer user
   * autenticado pode ler o próprio perfil). DEVE vir antes de `:id` pra que
   * o roteador do Nest não interprete "me" como um id.
   */
  @Get('me')
  getMe(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.users.findById(user.tenantId, user.sub);
  }

  /**
   * PATCH /v1/users/me — atualiza preferências pessoais (locale, timezone,
   * nome, telefone). Sem `users.update` — é o próprio usuário.
   */
  @Patch('me')
  updateMe(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(UpdateMyUserRequestSchema) body: UpdateMyUserRequest,
  ) {
    return this.users.updateMe(user.sub, body);
  }

  @Get(':id')
  @RequirePermissions('users.read')
  findOne(@CurrentUser() user: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.users.findById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('users.create')
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(CreateUserRequestSchema) body: CreateUserRequest,
  ) {
    return this.users.create(user.tenantId, user.sub, body);
  }

  @Patch(':id')
  @RequirePermissions('users.update')
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id') id: string,
    @ZodBody(UpdateUserRequestSchema) body: UpdateUserRequest,
  ) {
    return this.users.update(user.tenantId, user.sub, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('users.delete')
  async remove(@CurrentUser() user: AuthenticatedPrincipal, @Param('id') id: string) {
    await this.users.softDelete(user.tenantId, user.sub, id);
  }
}

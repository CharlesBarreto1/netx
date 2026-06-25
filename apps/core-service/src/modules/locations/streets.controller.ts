import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import {
  CreateStreetRequestSchema,
  UpdateStreetRequestSchema,
  type AuthenticatedPrincipal,
  type CreateStreetRequest,
  type UpdateStreetRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody, ZodQuery } from '../../common/zod.pipe';
import { StreetsService } from './streets.service';

const ListStreetsQuerySchema = z.object({
  cityId: z.string().uuid(),
  q: z.string().trim().min(1).max(255).optional(),
  cep: z
    .string()
    .transform((s) => s.replace(/\D/g, ''))
    .refine((s) => s.length === 8, { message: 'CEP deve ter 8 dígitos' })
    .optional(),
});
type ListStreetsQuery = z.infer<typeof ListStreetsQuerySchema>;

@ApiTags('locations')
@ApiBearerAuth()
@Controller('locations/streets')
export class StreetsController {
  constructor(private readonly streets: StreetsService) {}

  @Get()
  @RequirePermissions('locations.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodQuery(ListStreetsQuerySchema) query: ListStreetsQuery,
  ) {
    return this.streets.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions('locations.read')
  getById(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.streets.getById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('locations.manage')
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(CreateStreetRequestSchema) body: CreateStreetRequest,
  ) {
    return this.streets.create(user.tenantId, user.sub, body);
  }

  @Patch(':id')
  @RequirePermissions('locations.manage')
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateStreetRequestSchema) body: UpdateStreetRequest,
  ) {
    return this.streets.update(user.tenantId, user.sub, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('locations.manage')
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.streets.remove(user.tenantId, user.sub, id);
  }
}

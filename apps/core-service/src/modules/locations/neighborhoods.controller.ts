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
  CreateNeighborhoodRequestSchema,
  UpdateNeighborhoodRequestSchema,
  type AuthenticatedPrincipal,
  type CreateNeighborhoodRequest,
  type UpdateNeighborhoodRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody, ZodQuery } from '../../common/zod.pipe';
import { NeighborhoodsService } from './neighborhoods.service';

const ListNeighborhoodsQuerySchema = z.object({ cityId: z.string().uuid() });
type ListNeighborhoodsQuery = z.infer<typeof ListNeighborhoodsQuerySchema>;

@ApiTags('locations')
@ApiBearerAuth()
@Controller('locations/neighborhoods')
export class NeighborhoodsController {
  constructor(private readonly neighborhoods: NeighborhoodsService) {}

  @Get()
  @RequirePermissions('locations.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodQuery(ListNeighborhoodsQuerySchema) query: ListNeighborhoodsQuery,
  ) {
    return this.neighborhoods.list(user.tenantId, query.cityId);
  }

  @Post()
  @RequirePermissions('locations.manage')
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(CreateNeighborhoodRequestSchema) body: CreateNeighborhoodRequest,
  ) {
    return this.neighborhoods.create(user.tenantId, user.sub, body);
  }

  @Patch(':id')
  @RequirePermissions('locations.manage')
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateNeighborhoodRequestSchema) body: UpdateNeighborhoodRequest,
  ) {
    return this.neighborhoods.update(user.tenantId, user.sub, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('locations.manage')
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.neighborhoods.remove(user.tenantId, user.sub, id);
  }
}

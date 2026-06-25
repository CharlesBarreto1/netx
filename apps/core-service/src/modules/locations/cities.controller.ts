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
  CreateCityRequestSchema,
  UpdateCityRequestSchema,
  type AuthenticatedPrincipal,
  type CreateCityRequest,
  type UpdateCityRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody, ZodQuery } from '../../common/zod.pipe';
import { CitiesService } from './cities.service';

const ListCitiesQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  uf: z.string().length(2).toUpperCase().optional(),
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
type ListCitiesQuery = z.infer<typeof ListCitiesQuerySchema>;

@ApiTags('locations')
@ApiBearerAuth()
@Controller('locations/cities')
export class CitiesController {
  constructor(private readonly cities: CitiesService) {}

  @Get()
  @RequirePermissions('locations.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodQuery(ListCitiesQuerySchema) query: ListCitiesQuery,
  ) {
    return this.cities.list(user.tenantId, query);
  }

  @Post()
  @RequirePermissions('locations.manage')
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(CreateCityRequestSchema) body: CreateCityRequest,
  ) {
    return this.cities.create(user.tenantId, user.sub, body);
  }

  @Patch(':cityId')
  @RequirePermissions('locations.manage')
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('cityId', new ParseUUIDPipe()) cityId: string,
    @ZodBody(UpdateCityRequestSchema) body: UpdateCityRequest,
  ) {
    return this.cities.update(user.tenantId, user.sub, cityId, body);
  }

  @Delete(':cityId')
  @HttpCode(204)
  @RequirePermissions('locations.manage')
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('cityId', new ParseUUIDPipe()) cityId: string,
  ): Promise<void> {
    await this.cities.remove(user.tenantId, user.sub, cityId);
  }
}

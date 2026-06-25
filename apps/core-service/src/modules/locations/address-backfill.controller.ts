import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import {
  AddressBackfillQuerySchema,
  type AddressBackfillQuery,
  type AuthenticatedPrincipal,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodQuery } from '../../common/zod.pipe';
import { AddressBackfillService } from './address-backfill.service';

@ApiTags('locations')
@ApiBearerAuth()
@Controller('locations/backfill')
export class AddressBackfillController {
  constructor(private readonly backfill: AddressBackfillService) {}

  /** Contratos BR ainda em texto livre (streetId null) p/ reconciliação. */
  @Get('contracts')
  @RequirePermissions('contracts.read')
  listPending(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodQuery(AddressBackfillQuerySchema) query: AddressBackfillQuery,
  ) {
    return this.backfill.listPending(user.tenantId, query);
  }
}

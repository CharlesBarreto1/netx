import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import {
  ListConsentsQuerySchema,
  RecordConsentRequestSchema,
  type AuthenticatedPrincipal,
  type ListConsentsQuery,
  type RecordConsentRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { ZodQueryPipe } from './zod-query.pipe';
import { CustomerConsentsService } from './consents.service';

@ApiTags('crm/customers')
@ApiBearerAuth()
@Controller('customers/:customerId/consents')
export class CustomerConsentsController {
  constructor(private readonly consents: CustomerConsentsService) {}

  @Get()
  @RequirePermissions('customers.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Query(new ZodQueryPipe(ListConsentsQuerySchema)) q: ListConsentsQuery,
  ) {
    return this.consents.list(user.tenantId, customerId, q);
  }

  @Get('current')
  @RequirePermissions('customers.read')
  currentState(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
  ) {
    return this.consents.currentState(user.tenantId, customerId);
  }

  @Post()
  @RequirePermissions('customers.consents.manage')
  record(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @ZodBody(RecordConsentRequestSchema) body: RecordConsentRequest,
    @Req() req: Request,
  ) {
    const ip =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      req.socket?.remoteAddress ??
      null;
    const userAgent = (req.headers['user-agent'] as string | undefined) ?? null;
    return this.consents.record(user.tenantId, user.sub, customerId, body, { ip, userAgent });
  }
}

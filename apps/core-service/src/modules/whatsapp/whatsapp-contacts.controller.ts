import { Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import type { AuthenticatedPrincipal } from '@netx/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { RequiresModule } from '../licensing/license.decorators';

import { WhatsappContactsService } from './whatsapp-contacts.service';

const LinkBodySchema = z.object({
  customerId: z.string().uuid().nullable(),
});
type LinkBody = z.infer<typeof LinkBodySchema>;

/**
 * Vínculo manual de contato WhatsApp ↔ Customer.
 *   PATCH /v1/whatsapp/contacts/:id   { customerId: uuid | null }
 */
@ApiTags('whatsapp')
@ApiBearerAuth()
@RequiresModule('netx-call')
@Controller('whatsapp/contacts')
export class WhatsappContactsController {
  constructor(private readonly contacts: WhatsappContactsService) {}

  @Patch(':id')
  @RequirePermissions('chat.send')
  link(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(LinkBodySchema) body: LinkBody,
  ) {
    return this.contacts.linkCustomer(user.tenantId, user.sub, id, body.customerId);
  }
}

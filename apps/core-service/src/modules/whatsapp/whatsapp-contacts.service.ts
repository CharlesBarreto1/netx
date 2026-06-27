import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import { WhatsappEventsBus } from './whatsapp-events.bus';

/**
 * Vínculo manual de um WhatsappContact a um Customer. O auto-match por telefone
 * (em whatsapp-messages.service) cobre o caso feliz; aqui o atendente corrige/
 * vincula manualmente (ex.: número que não bate com o cadastro, ou LID sem PN).
 */
@Injectable()
export class WhatsappContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: WhatsappEventsBus,
  ) {}

  /** Vincula (ou desvincula com customerId=null) o contato a um cliente. */
  async linkCustomer(
    tenantId: string,
    actorUserId: string,
    contactId: string,
    customerId: string | null,
  ) {
    const contact = await this.prisma.whatsappContact.findFirst({
      where: { id: contactId, tenantId },
    });
    if (!contact) throw new NotFoundException('Contato não encontrado');

    if (customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: customerId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!customer) throw new BadRequestException('Cliente inválido');
    }

    const updated = await this.prisma.whatsappContact.update({
      where: { id: contactId },
      data: { customerId },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: customerId ? 'whatsapp.contact.linked' : 'whatsapp.contact.unlinked',
      resource: 'whatsapp_contact',
      resourceId: contactId,
      metadata: { customerId, from: contact.customerId },
    });

    // Avisa as conversas abertas desse contato (atualiza o painel em realtime).
    const convs = await this.prisma.whatsappConversation.findMany({
      where: { contactId, tenantId },
      select: { id: true },
    });
    for (const c of convs) {
      this.events.emit({
        type: 'conversation.updated',
        tenantId,
        payload: { id: c.id, contactLinked: customerId },
      });
    }

    return updated;
  }
}

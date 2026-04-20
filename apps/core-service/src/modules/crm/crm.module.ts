import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';

import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerAddressesController } from './addresses.controller';
import { CustomerAddressesService } from './addresses.service';
import { CustomerContactsController } from './contacts.controller';
import { CustomerContactsService } from './contacts.service';
import { CustomerTagsController } from './tags.controller';
import { CustomerTagsService } from './tags.service';
import { CustomerConsentsController } from './consents.controller';
import { CustomerConsentsService } from './consents.service';
import { CustomerNotesController } from './notes.controller';
import { CustomerNotesService } from './notes.service';

/**
 * Módulo 02 — CRM / Clientes
 *
 * Subdivisões:
 *   /customers                     -> CRUD de clientes (PF/PJ) + tags helpers
 *   /customers/:id/addresses       -> endereços
 *   /customers/:id/contacts        -> canais de contato (e-mail, fone, etc.)
 *   /customers/:id/consents        -> trilha LGPD/GDPR
 *   /customers/:id/notes           -> anotações internas
 *   /crm/tags                      -> catálogo de tags do tenant
 */
@Module({
  imports: [AuditModule],
  controllers: [
    CustomersController,
    CustomerAddressesController,
    CustomerContactsController,
    CustomerTagsController,
    CustomerConsentsController,
    CustomerNotesController,
  ],
  providers: [
    CustomersService,
    CustomerAddressesService,
    CustomerContactsService,
    CustomerTagsService,
    CustomerConsentsService,
    CustomerNotesService,
  ],
  exports: [CustomersService],
})
export class CrmModule {}

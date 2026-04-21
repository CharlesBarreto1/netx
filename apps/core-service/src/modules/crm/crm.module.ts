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
import { PipelinesController } from './pipelines.controller';
import { PipelinesService } from './pipelines.service';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';

/**
 * Módulo 02 — CRM
 *
 * Sub-áreas:
 *   Clientes:
 *     /customers                     -> CRUD (PF/PJ) + helpers de tags
 *     /customers/:id/addresses       -> endereços
 *     /customers/:id/contacts        -> canais de contato
 *     /customers/:id/consents        -> trilha LGPD/GDPR
 *     /customers/:id/notes           -> anotações internas
 *     /crm/tags                      -> catálogo de tags do tenant
 *
 *   Vendas:
 *     /crm/pipelines                 -> funis comerciais + estágios
 *     /crm/deals                     -> oportunidades + Kanban board
 *     /crm/activities                -> agenda/tarefas (call/meeting/email/...)
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
    PipelinesController,
    DealsController,
    ActivitiesController,
  ],
  providers: [
    CustomersService,
    CustomerAddressesService,
    CustomerContactsService,
    CustomerTagsService,
    CustomerConsentsService,
    CustomerNotesService,
    PipelinesService,
    DealsService,
    ActivitiesService,
  ],
  exports: [CustomersService, PipelinesService, DealsService, ActivitiesService],
})
export class CrmModule {}

/**
 * FieldActionsService — ações privilegiadas de campo. Field é consumidor: a
 * escrita real vai pela API do módulo dono (aqui, ContractsService). Este
 * serviço só orquestra + AUDITA (quem/quando/de onde/o quê). O gating de
 * segurança (permissão `field.unblock` + step-up) mora no controller.
 */
import { Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { ContractsService } from '../contracts/contracts.service';

@Injectable()
export class FieldActionsService {
  constructor(
    private readonly contracts: ContractsService,
    private readonly audit: AuditService,
  ) {}

  /** Desbloqueia (reativa) um contrato suspenso — via API do módulo dono. */
  async unblock(
    tenantId: string,
    actorUserId: string,
    contractId: string,
    ctx: { ip?: string; userAgent?: string; note?: string },
  ) {
    const result = await this.contracts.applyReactivate(tenantId, contractId, {
      actorUserId,
      note: ctx.note,
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'field.unblock',
      resource: 'contract',
      resourceId: contractId,
      level: 'WARNING',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { source: 'netx-field', note: ctx.note ?? null },
    });
    return result;
  }
}

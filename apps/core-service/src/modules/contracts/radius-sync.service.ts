import { Injectable, Logger } from '@nestjs/common';
import {
  ContractStatus,
  RadiusAction,
  RadiusEventStatus,
  type Prisma,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Mapa de status do contrato -> ação RADIUS + pool de destino.
 * O RADIUS/Mikrotik real ainda não está integrado; esta classe apenas registra
 * a intenção numa tabela (`radius_events`) para ser consumida por um worker
 * quando a integração for feita.
 */
export const POOL_ATIVOS = 'ativos';
export const POOL_BLOQUEADOS = 'bloqueados';
export const POOL_CANCELADOS = 'cancelados';

function actionFor(status: ContractStatus): { action: RadiusAction; pool: string } {
  switch (status) {
    case ContractStatus.ACTIVE:
      return { action: RadiusAction.AUTHORIZE, pool: POOL_ATIVOS };
    case ContractStatus.SUSPENDED:
      return { action: RadiusAction.BLOCK, pool: POOL_BLOQUEADOS };
    case ContractStatus.CANCELLED:
      return { action: RadiusAction.CANCEL, pool: POOL_CANCELADOS };
    default:
      // TypeScript guard — exaustivo
      return { action: RadiusAction.BLOCK, pool: POOL_BLOQUEADOS };
  }
}

export interface ContractSyncTarget {
  id: string;
  tenantId: string;
  pppoeUsername: string;
  status: ContractStatus;
}

@Injectable()
export class RadiusSyncService {
  private readonly logger = new Logger(RadiusSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra a intenção de sincronizar um contrato com o RADIUS.
   * Usa a transaction quando fornecida (para manter atomicidade com a mudança
   * de status do contrato).
   */
  async enqueueSync(
    contract: ContractSyncTarget,
    note?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const { action, pool } = actionFor(contract.status);

    await client.radiusEvent.create({
      data: {
        tenantId: contract.tenantId,
        contractId: contract.id,
        action,
        status: RadiusEventStatus.PENDING,
        pppoeUsername: contract.pppoeUsername,
        targetPool: pool,
        note: note ?? null,
      },
    });

    this.logger.log(
      `[RADIUS] enqueue tenant=${contract.tenantId} user=${contract.pppoeUsername} action=${action} pool=${pool}`,
    );
  }

  /**
   * Força desconexão (CoA disconnect). Útil ao suspender/cancelar para derrubar
   * a sessão ativa. No stub atual só registra o evento.
   */
  async enqueueDisconnect(
    contract: ContractSyncTarget,
    note?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.radiusEvent.create({
      data: {
        tenantId: contract.tenantId,
        contractId: contract.id,
        action: RadiusAction.DISCONNECT,
        status: RadiusEventStatus.PENDING,
        pppoeUsername: contract.pppoeUsername,
        note: note ?? null,
      },
    });
    this.logger.log(
      `[RADIUS] disconnect tenant=${contract.tenantId} user=${contract.pppoeUsername}`,
    );
  }
}

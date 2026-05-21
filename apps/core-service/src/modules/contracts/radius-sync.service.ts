/**
 * RadiusSyncService — propaga mudanças de Contract → tabelas radius.* (PPPoE/IPoE).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  ContractAuthMethod,
  ContractStatus,
  RadiusAction,
  RadiusEventStatus,
  type Prisma,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Mapa de status do contrato -> ação RADIUS + pool de destino.
 * O RADIUS/Mikrotik real é consumido pelo RadiusApplierService; este service
 * só enfileira a intenção em `radius_events`.
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

/**
 * Identificador efetivo do contrato no RADIUS:
 *   PPPOE → pppoeUsername
 *   IPOE  → circuitId (preferido) ou macAddress (fallback)
 *
 * Lança se nada estiver setado — defesa em profundidade; o DTO já garante
 * que pelo menos um exista.
 */
export function radiusIdentifier(contract: {
  authMethod: ContractAuthMethod;
  pppoeUsername: string | null;
  circuitId: string | null;
  macAddress: string | null;
}): string {
  if (contract.authMethod === ContractAuthMethod.IPOE) {
    const id = contract.circuitId ?? contract.macAddress;
    if (!id) {
      throw new Error(
        'Contrato IPoE sem circuit-id e sem MAC — RADIUS não pode aplicar.',
      );
    }
    return id;
  }
  if (!contract.pppoeUsername) {
    throw new Error('Contrato PPPoE sem username.');
  }
  return contract.pppoeUsername;
}

export interface ContractSyncTarget {
  id: string;
  tenantId: string;
  authMethod: ContractAuthMethod;
  pppoeUsername: string | null;
  circuitId: string | null;
  macAddress: string | null;
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
    const identifier = radiusIdentifier(contract);

    await client.radiusEvent.create({
      data: {
        tenantId: contract.tenantId,
        contractId: contract.id,
        action,
        status: RadiusEventStatus.PENDING,
        // Coluna se chama pppoe_username por compat; conteúdo é o identifier
        // efetivo (username PPPoE ou circuit-id/MAC pra IPoE).
        pppoeUsername: identifier,
        targetPool: pool,
        note: note ?? null,
      },
    });

    this.logger.log(
      `[RADIUS] enqueue tenant=${contract.tenantId} method=${contract.authMethod} id=${identifier} action=${action} pool=${pool}`,
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
    const identifier = radiusIdentifier(contract);
    await client.radiusEvent.create({
      data: {
        tenantId: contract.tenantId,
        contractId: contract.id,
        action: RadiusAction.DISCONNECT,
        status: RadiusEventStatus.PENDING,
        pppoeUsername: identifier,
        note: note ?? null,
      },
    });
    this.logger.log(
      `[RADIUS] disconnect tenant=${contract.tenantId} method=${contract.authMethod} id=${identifier}`,
    );
  }

  /**
   * Limpa entradas RADIUS de um identificador OBSOLETO do contrato (ex.: usuário
   * trocou pppoeUsername / circuitId / MAC via update()). Sem isso, o
   * identificador antigo continua "autorizado" indefinidamente em
   * radcheck/radusergroup — vazamento de credencial.
   *
   * Implementado como evento CANCEL com pppoe_username = oldIdentifier:
   *   - applier executa deleteCredentials + clearFramedIp + putInGroup(cancelados)
   *     usando oldIdentifier como username em radcheck/radreply/radusergroup
   *   - dispara CoA pra derrubar a sessão atual (se houver) do identificador antigo
   *
   * Não impacta o estado do contrato (que continua ACTIVE / SUSPENDED / etc).
   * O novo identificador é re-autorizado por uma chamada separada a `enqueueSync`.
   */
  async enqueueCleanupOldIdentifier(
    contract: ContractSyncTarget,
    oldIdentifier: string,
    note?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.radiusEvent.create({
      data: {
        tenantId: contract.tenantId,
        contractId: contract.id,
        action: RadiusAction.CANCEL,
        status: RadiusEventStatus.PENDING,
        pppoeUsername: oldIdentifier,
        // pool não importa — CANCEL faz putInGroup(cancelados) hard-coded
        targetPool: POOL_CANCELADOS,
        note: note ?? `cleanup do identificador antigo (${oldIdentifier})`,
      },
    });
    this.logger.log(
      `[RADIUS] cleanup tenant=${contract.tenantId} old_id=${oldIdentifier} (contract=${contract.id})`,
    );
  }
}

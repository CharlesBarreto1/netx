/**
 * Auto-status do Customer baseado nos contratos.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Regra (decisão 2026-05-22):
 *   Sem contrato                         → PROSPECT
 *   Algum contrato PENDING_INSTALL       → INACTIVE
 *   Algum contrato ACTIVE                → ACTIVE
 *   Algum contrato SUSPENDED (sem ACTIVE)→ SUSPENDED
 *   Só contratos CANCELLED               → CHURNED
 *
 * Hierarquia em customers com múltiplos contratos: o "melhor" status vence
 * (ACTIVE > SUSPENDED > INACTIVE > CHURNED > PROSPECT).
 *
 * O helper é chamado em todo ponto que muda status de contrato:
 *   - create / update / suspend / reactivate / cancel
 *   - provisioning.installCustomer (ativa contrato PENDING_INSTALL)
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { type ContractStatus, CustomerStatus, type Prisma } from '@prisma/client';

/** Tipo mínimo aceito pelo helper — só precisa do status. */
interface ContractStatusOnly {
  status: ContractStatus;
}

/**
 * Calcula o status final do customer dado o conjunto de contratos
 * (já filtrados por `deletedAt: null`). Função PURA — sem I/O.
 */
export function computeCustomerStatusFromContracts(
  contracts: ContractStatusOnly[],
): CustomerStatus {
  if (contracts.length === 0) return CustomerStatus.PROSPECT;
  if (contracts.some((c) => c.status === 'ACTIVE')) return CustomerStatus.ACTIVE;
  if (contracts.some((c) => c.status === 'SUSPENDED')) return CustomerStatus.SUSPENDED;
  if (contracts.some((c) => c.status === 'PENDING_INSTALL'))
    return CustomerStatus.INACTIVE;
  // Sobrou: todos CANCELLED.
  return CustomerStatus.CHURNED;
}

/**
 * Lê os contratos ativos (deletedAt: null) do customer, calcula o status
 * derivado e atualiza o Customer. Idempotente — se o status já bate, não
 * faz update (evita ruído em audit/updated_at).
 *
 * Aceita `PrismaClient` ou `TransactionClient` — chamar de dentro de uma
 * transação onde já há mudanças de contrato.
 */
export async function recalcCustomerStatus(
  client: Prisma.TransactionClient | { contract: Prisma.TransactionClient['contract']; customer: Prisma.TransactionClient['customer'] },
  tenantId: string,
  customerId: string,
): Promise<CustomerStatus | null> {
  const contracts = await client.contract.findMany({
    where: { tenantId, customerId, deletedAt: null },
    select: { status: true },
  });
  const next = computeCustomerStatusFromContracts(contracts);

  const customer = await client.customer.findFirst({
    where: { id: customerId, tenantId, deletedAt: null },
    select: { status: true },
  });
  if (!customer) return null;
  if (customer.status === next) return next; // sem mudança

  await client.customer.update({
    where: { id: customerId },
    data: { status: next },
  });
  return next;
}

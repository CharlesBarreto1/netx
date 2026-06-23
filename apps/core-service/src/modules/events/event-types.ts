import { defineModule } from '@netx/core-sdk';

/**
 * Tipos de evento publicados pelo módulo ERP no bus (convenção
 * `<módulo>.<entidade>.<ação>`). Ver docs/ecosystem/ECOSYSTEM-MODULAR-PLAN.md.
 */
export const ERP_CONTRACT_CREATED = 'netx-erp.contract.created';
export const ERP_CONTRACT_SUSPENDED = 'netx-erp.contract.suspended';
export const ERP_CONTRACT_REACTIVATED = 'netx-erp.contract.reactivated';
export const ERP_CONTRACT_PLAN_CHANGED = 'netx-erp.contract.plan-changed';
export const ERP_CONTRACT_CANCELLED = 'netx-erp.contract.cancelled';
export const ERP_CONTRACT_INSTALLED = 'netx-erp.contract.installed';
export const ERP_INVOICE_PAID = 'netx-erp.invoice.paid';

/** Eventos do domínio CPE/TR-069 (source `netx-cpe`). */
export const CPE_ONT_SWAPPED = 'netx-cpe.ont.swapped';

/**
 * Registra no manifesto do módulo o que o ERP EMITE (Fase 3). Side-effect de
 * import: mantém o manifesto (@netx/core-sdk) coerente com as costuras
 * realmente ligadas, sem inventar contrato de evento solto.
 */
defineModule('netx-erp', {
  emits: [
    ERP_CONTRACT_CREATED,
    ERP_CONTRACT_SUSPENDED,
    ERP_CONTRACT_REACTIVATED,
    ERP_CONTRACT_PLAN_CHANGED,
    ERP_CONTRACT_CANCELLED,
    ERP_CONTRACT_INSTALLED,
    ERP_INVOICE_PAID,
  ],
});

// O domínio CPE/TR-069 é dono dos eventos de equipamento (ex.: troca de ONT).
defineModule('netx-cpe', { emits: [CPE_ONT_SWAPPED] });

/** Payload de `netx-erp.contract.created` (version 1). */
export interface ContractCreatedPayload {
  contractId: string;
  customerId: string;
  code: string | null;
  status: string;
  authMethod: string;
}

/** Payload de `netx-erp.contract.suspended` (version 1). */
export interface ContractSuspendedPayload {
  contractId: string;
  customerId: string;
  /** Motivo da suspensão (ContractSuspendReason). */
  reason: string;
  /** true = ação manual de operador; false = cron (inadimplência). */
  manual: boolean;
}

/** Payload de `netx-erp.contract.reactivated` (version 1). */
export interface ContractReactivatedPayload {
  contractId: string;
  customerId: string;
}

/** Payload de `netx-erp.contract.plan-changed` (version 1). */
export interface ContractPlanChangedPayload {
  contractId: string;
  customerId: string;
  fromPlanId: string | null;
  toPlanId: string;
}

/** Payload de `netx-erp.contract.cancelled` (version 1). */
export interface ContractCancelledPayload {
  contractId: string;
  customerId: string;
  /** true = cancelado antes de instalar (PENDING_INSTALL → CANCELLED). */
  wasPendingInstall: boolean;
}

/** Payload de `netx-erp.contract.installed` (version 1). 1ª ativação em campo. */
export interface ContractInstalledPayload {
  contractId: string;
  customerId: string;
  ontId: string;
  oltId: string;
}

/** Payload de `netx-erp.invoice.paid` (version 1). Cobre baixa manual e gateway. */
export interface InvoicePaidPayload {
  invoiceId: string;
  contractId: string;
  customerId: string;
  paidAmount: number;
  /** ISO 8601. */
  paidAt: string;
  /** Forma de pagamento (ContractInvoicePaidVia). null se não informado. */
  paidVia: string | null;
}

/** Payload de `netx-cpe.ont.swapped` (version 1). Troca de ONT (manual ou O.S). */
export interface OntSwappedPayload {
  contractId: string;
  ontId: string;
  oldSn: string | null;
  newSn: string;
  /** Rede da OLT: 'ufinet' (orquestrador) ou 'own' (rede própria). */
  network: 'ufinet' | 'own';
  /** Status do provisionamento da nova ONT. */
  status: string;
}

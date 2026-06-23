import { defineModule } from '@netx/core-sdk';

/**
 * Tipos de evento publicados pelo módulo ERP no bus (convenção
 * `<módulo>.<entidade>.<ação>`). Ver docs/ecosystem/ECOSYSTEM-MODULAR-PLAN.md.
 */
export const ERP_CONTRACT_CREATED = 'netx-erp.contract.created';

/**
 * Registra no manifesto do módulo o que o ERP EMITE (Fase 3). Side-effect de
 * import: mantém o manifesto (@netx/core-sdk) coerente com as costuras
 * realmente ligadas, sem inventar contrato de evento solto.
 */
defineModule('netx-erp', { emits: [ERP_CONTRACT_CREATED] });

/** Payload de `netx-erp.contract.created` (version 1). */
export interface ContractCreatedPayload {
  contractId: string;
  customerId: string;
  code: string | null;
  status: string;
  authMethod: string;
}

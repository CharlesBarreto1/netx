/**
 * Assinante 360 — visão agregada READ-ONLY consumida pelo NetX Field (mobile) e
 * pelas surfaces de atendente (web). Montada por um BFF read-only no core-service
 * que junta ERP (customer/contract/faturas/O.S) + CPE (ONT/sinal óptico) + rede
 * óptica (CTO/porta) numa única chamada. É produzida pelo backend — por isso são
 * `interface`s (Response), não schemas Zod validados na entrada.
 *
 * NMS (outage por PON) é enriquecimento futuro: o campo `nms` fica reservado e
 * hoje vem `null` (não há link determinístico Olt→device NMS ainda). Ver
 * docs/ecosystem e o brief de mapping/NMS.
 */

export interface Subscriber360Customer {
  id: string;
  code: string | null;
  displayName: string;
  type: 'INDIVIDUAL' | 'COMPANY';
  /** CustomerStatus (LEAD/PROSPECT/ACTIVE/SUSPENDED/INACTIVE/CHURNED). */
  status: string;
  primaryPhone: string | null;
  primaryEmail: string | null;
}

/** Estado da conexão no RADIUS (sessão ativa) — leitura. */
export interface Subscriber360Connection {
  online: boolean;
  /** Identificador que casou no radacct (PPPoE > circuitId > MAC). */
  radiusIdentifier: string | null;
}

/** Snapshot da ONT vinda do domínio CPE (persistido; sinal pode estar defasado). */
export interface Subscriber360Ont {
  id: string;
  snGpon: string;
  status: 'PENDING_AUTH' | 'AUTHORIZED' | 'ONLINE' | 'OFFLINE' | 'LOS' | 'FAULT';
  /** Sinal óptico dBm — null se nunca lido. STATUS_ONT/TR-069 são assíncronos. */
  lastRxPowerDbm: number | null;
  lastTxPowerDbm: number | null;
  lastSeenAt: string | null; // ISO 8601
}

/** Porta de CTO/splitter (rede óptica) onde o contrato é atendido. */
export interface Subscriber360OpticalPort {
  /** Código completo da CTO (ex.: JLMPY-PY13734). */
  enclosureCode: string;
  number: number;
}

export interface Subscriber360Contract {
  id: string;
  code: string | null;
  status: 'PENDING_INSTALL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  authMethod: 'PPPOE' | 'IPOE';
  planName: string | null;
  monthlyValue: number;
  bandwidthMbps: number;
  uploadMbps: number | null;
  pppoeUsername: string | null;
  installationAddress: string;
  latitude: number | null;
  longitude: number | null;
  activatedAt: string | null; // ISO 8601
  connection: Subscriber360Connection;
  ont: Subscriber360Ont | null;
  opticalPort: Subscriber360OpticalPort | null;
}

export interface Subscriber360Invoice {
  id: string;
  contractId: string;
  amount: number;
  dueDate: string; // YYYY-MM-DD
  status: 'OPEN' | 'OVERDUE';
}

export interface Subscriber360ServiceOrder {
  id: string;
  code: string | null;
  status: 'OPEN' | 'SCHEDULED' | 'EN_ROUTE' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  /** Inclui OVERDUE derivado (não persistido). */
  displayStatus: string;
  reasonName: string;
  scheduledAt: string | null; // ISO 8601
  openedAt: string; // ISO 8601
}

export interface Subscriber360Response {
  customer: Subscriber360Customer;
  contracts: Subscriber360Contract[];
  /** Faturas em aberto/vencidas de todos os contratos do assinante. */
  openInvoices: Subscriber360Invoice[];
  /** O.S recentes (últimas N) do assinante. */
  recentServiceOrders: Subscriber360ServiceOrder[];
  /** Somatório das faturas em aberto (moeda do tenant). */
  balanceDue: number;
  /** ISO 8601 — quando o agregado foi montado (o app sabe a idade do snapshot). */
  generatedAt: string;
}

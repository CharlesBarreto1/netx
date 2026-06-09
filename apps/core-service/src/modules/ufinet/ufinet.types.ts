/**
 * Tipos INTERNOS da integração Ufinet (TM Forum). Não vão pro @netx/shared —
 * são os shapes crus da API + a conexão resolvida a partir da OLT.
 *
 * Shapes validados ao vivo em QA (apim-ufinet-qa.azure-api.net/multiop).
 */

/**
 * Conexão resolvida de uma OLT (vendor=UFINET, providerMode=ORCHESTRATOR):
 * apiEndpoint + apiCredentialsEnc (segredos) + apiConfig (não-secreto).
 */
export interface UfinetConnection {
  /** Base URL terminando em `/multiop/`. */
  baseUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  /** Header `Access` da APIM. */
  accessKey: string;
  scope: string;
  operator: string;
  region: string;
  /** contractId TMF do operador (ex. "FTTH_ZUX_PY") — NÃO é o contrato NetX. */
  contractId: string;
  polygonAlias: string | null;
  userName: string;
  country: string;
  city: string | null;
  nms: string;
  nmsId: string;
  bandwidthProfile: string;
  bandwidthProfileId: string;
  /** Alta enxuta: omite PII (contato + geometria) do payload de provide. */
  minimalProvidePayload: boolean;
  /**
   * Query param pra filtrar o ServiceInventory por externalServiceId no servidor
   * (ex.: "externalServiceId"). Null = baixa o inventário inteiro e filtra no
   * cliente (default; inviável em escala). Ver UfinetOltConfig.
   */
  inventoryFilterParam: string | null;
}

export interface UfinetErrorMessage {
  code?: string;
  message?: string;
  reason?: string;
  referenceError?: string;
  status?: number;
  timestamp?: string;
}

export interface UfinetServiceCharacteristic {
  id?: string | null;
  name: string;
  value: string;
  valueType?: string;
}

export interface UfinetServiceShape {
  id?: string | number | null;
  state?: string | null;
  stateDescription?: string | null;
  externalServiceId?: string | null;
  networkType?: string | null;
  serviceSpecification?: { id?: string | null; name?: string | null; version?: string | null } | null;
  serviceCharacteristic?: UfinetServiceCharacteristic[] | null;
  parentServiceId?: string | number | null;
  symServiceId?: string | null;
  installDrop?: unknown;
  ont?: unknown;
}

export interface UfinetOrderItem {
  id?: number | string;
  action?: string;
  state?: string;
  service?: UfinetServiceShape;
}

/** Resposta de GET/POST ServiceOrder/order(/{id}). */
export interface UfinetOrderResponse {
  id: number | string;
  externalId?: string | null;
  serviceOrderType?: string | null;
  state?: string | null; // initial | inProgress | completed | Failed
  stateDescription?: string | null;
  waitingCode?: string | null;
  availability?: string | null;
  idContrato?: string | null;
  completionDate?: string | null;
  errorMessages?: UfinetErrorMessage[] | null;
  relatedParty?: unknown[];
  serviceOrderItem?: UfinetOrderItem[];
}

/** Item de GET ServiceInventory/service(/{id}). */
export interface UfinetInventoryService extends UfinetServiceShape {
  operator?: string;
  region?: string;
  contractId?: string;
  externalServiceId?: string | null;
}

/**
 * Envelope de POST/PATCH: a Ufinet embrulha a ordem criada em
 * `{ status: "success", message: "Orden Generada. Datos: <id>", data: {...} }`.
 * GETs retornam a ordem crua. `extractOrder` normaliza os dois.
 */
export interface UfinetMutationResponse {
  status?: string;
  message?: string;
  data?: UfinetOrderResponse;
}

export function extractOrder(
  resp: UfinetMutationResponse | UfinetOrderResponse | null | undefined,
): UfinetOrderResponse | null {
  if (!resp || typeof resp !== 'object') return null;
  const r = resp as Record<string, unknown>;
  if (r.data && typeof r.data === 'object') return r.data as UfinetOrderResponse;
  if ('id' in r) return resp as UfinetOrderResponse;
  return null;
}

export function extractOrderId(
  resp: UfinetMutationResponse | UfinetOrderResponse | null | undefined,
): string | null {
  const order = extractOrder(resp);
  return order?.id != null ? String(order.id) : null;
}

/** spec.id numérico dos 4 sub-serviços do bundle (mapeado ao vivo). */
export const UFINET_SPEC = {
  DATOS: '10',
  FIBER_ACCESS: '3',
  HSD: '5',
  RES_PON_ACCESS: '4',
} as const;

/** Estados TMF normalizados (case-insensitive na API). */
export function normalizeUfinetState(state: string | null | undefined): string {
  return (state ?? '').trim().toLowerCase();
}

export const UFINET_STATE = {
  INITIAL: 'initial',
  IN_PROGRESS: 'inprogress',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

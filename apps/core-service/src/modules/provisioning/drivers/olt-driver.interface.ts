/**
 * Interface comum pra drivers de OLT.
 *
 * Implementações:
 *   - MockOltDriver           — Fase 1, retorna sucesso simulado pra dev/UI
 *   - UfinetOrchestratorDriver — Fase 2, REST API rede neutra PY
 *   - HuaweiSshDriver          — Fase BR, SSH CLI MA5800
 *   - ParksSshDriver           — Fase BR
 *
 * Drivers são instanciados pelo OltDriverFactory baseado em Olt.providerMode +
 * Olt.vendor. Cada call retorna `OltDriverResult<T>` com `success` boolean +
 * payload/erro tipado, pra o ProvisioningService logar em
 * `provisioning_events` sem precisar tratar exceções por caminho.
 *
 * Convenção:
 *   - Drivers NUNCA lançam pra falhas operacionais esperadas (SN não
 *     encontrado, OLT offline, credenciais erradas) — retornam
 *     `{ success: false, error }`.
 *   - Drivers PODEM lançar pra bugs de programação (input inválido vindo do
 *     orquestrador, contrato quebrado de versão).
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */

export interface OltConnectionContext {
  oltId: string;
  managementIp: string | null;
  sshPort: number;
  sshUser: string | null;
  /** Senha SSH em PLAINTEXT — driver já recebe decifrado. */
  sshPassword: string | null;
  enableSecret: string | null;
  apiEndpoint: string | null;
  apiAuthType: string | null;
  /** Credenciais API em plaintext (JSON parseado). */
  apiCredentials: Record<string, unknown> | null;
  defaults: {
    serviceVlanId: number | null;
    upProfile: string | null;
    downProfile: string | null;
  };
}

export interface AuthorizeOntInput {
  snGpon: string;
  /** MAC da ONT (opcional — alguns providers retornam, outros exigem). */
  macAddress: string | null;
  /** Posição PON sugerida (DIRECT pode ignorar e auto-descobrir). */
  ponFrame: number | null;
  ponSlot: number | null;
  /** Banda em Mbps (driver mapeia pra profile da OLT). */
  bandwidthMbps: number;
  /** VLAN (default herdado da OLT, override por ONT). */
  vlanId?: number | null;
  /** Identificador único do contrato (pra logs/audit no provider). */
  contractRef: string;
}

export interface AuthorizedOntResult {
  /** SN confirmado pelo provider. */
  snGpon: string;
  /** MAC reportado pelo provider (se disponível). */
  macAddress: string | null;
  /** Posição alocada pelo provider. */
  ponFrame: number | null;
  ponSlot: number | null;
  ponOnuIndex: number | null;
  /** Identificador interno do provider — útil pra deauthorize depois. */
  providerOntRef: string | null;
}

export interface OntStatusResult {
  status: 'ONLINE' | 'OFFLINE' | 'LOS' | 'FAULT' | 'PENDING_AUTH' | 'AUTHORIZED';
  lastRxPower: number | null;   // dBm
  lastTxPower: number | null;
  raw?: unknown;                // payload original pra debug
}

export type OltDriverResult<T> =
  | { success: true; data: T; durationMs: number; raw?: unknown }
  | { success: false; error: string; durationMs: number; raw?: unknown };

export interface OltDriver {
  readonly name: string;
  testConnection(ctx: OltConnectionContext): Promise<OltDriverResult<{ message: string }>>;
  authorizeOnt(
    ctx: OltConnectionContext,
    input: AuthorizeOntInput,
  ): Promise<OltDriverResult<AuthorizedOntResult>>;
  deauthorizeOnt(
    ctx: OltConnectionContext,
    snGpon: string,
  ): Promise<OltDriverResult<{ message: string }>>;
  getOntStatus(
    ctx: OltConnectionContext,
    snGpon: string,
  ): Promise<OltDriverResult<OntStatusResult>>;
}

/**
 * Helper interno usado por todos os drivers pra padronizar medição de duração
 * e formato do result. Mantém DRY sem hierarquia de classes.
 */
export async function runDriverCall<T>(
  fn: () => Promise<T>,
): Promise<OltDriverResult<T>> {
  const startedAt = Date.now();
  try {
    const data = await fn();
    return { success: true, data, durationMs: Date.now() - startedAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, durationMs: Date.now() - startedAt };
  }
}

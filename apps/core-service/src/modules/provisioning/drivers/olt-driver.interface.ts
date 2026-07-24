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
  /**
   * Template de provisionamento resolvido (Plan ?? OLT default). Drivers que
   * provisionam por CLI estruturado (ex: ZyxelZynosDriver) usam isto pra
   * renderizar o bloco. Drivers que ignoram (mock/Ufinet) não precisam.
   */
  provisioningProfile?: ResolvedProvisioningProfile | null;
}

/** Uma VLAN do serviço dentro de um template resolvido. */
export interface ProvisioningProfileVlan {
  vid: number;
  role: 'DATA' | 'MGMT';
  /** txtag tag (true) | untag (false). */
  tagged: boolean;
  /** pvid do uniport aponta pra esta VLAN. */
  isPvid: boolean;
  /** gera `protocol-based <proto> vlan <vid>`. */
  isProtocolBased: boolean;
}

/**
 * Template de provisionamento já resolvido (sem campos de DB) que o
 * ProvisioningService passa pro driver. Espelha OltProvisioningProfile +
 * vlans, mas é um tipo de domínio puro pra não acoplar drivers ao Prisma.
 */
export interface ResolvedProvisioningProfile {
  ontPassword: string;
  fullBridge: boolean;
  bwUpProfileName: string;
  bwDownProfileName: string;
  bwGroupId: number;
  uniPort: string;
  serviceProtocol: 'PPPOE' | 'IPOE' | 'BRIDGE';
  queueTc: number;
  queuePriority: number;
  queueWeight: number;
  ingressProfile: string;
  vlans: ProvisioningProfileVlan[];
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

/**
 * Leitura de potência óptica de UMA ONU pela OLT (não pelo CPE/TR-069). É a
 * ÚNICA fonte de sinal para ONUs cujo CPE não fala TR-069 com o ACS do NetX
 * (ex.: Parks, que não expõe óptico via TR-069). Coordenada + níveis em dBm.
 */
export interface OntOpticalReading {
  slot: number;
  pon: number;
  onuIndex: number;
  /** Estado do enlace na OLT (up/dn). */
  up: boolean;
  /** Potência RX na ONU (dBm) — null se a ONU está down. */
  rxPower: number | null;
  /** Potência TX da ONU (dBm). */
  txPower: number | null;
  /** Potência que a OLT RECEBE da ONU (dBm) — visão do lado OLT. */
  oltRxPower: number | null;
  temperature: number | null;
  voltage: number | null;
  biasCurrent: number | null;
  distanceM: number | null;
}

/**
 * Uma ONU descoberta na OLT durante uma varredura de inventário (listOnts).
 * É o dado CRU que alimenta a tabela de staging `discovered_onts` — antes de
 * casar com o ERP e materializar em Ont/Contract. Campos opcionais porque nem
 * toda OLT expõe tudo num único comando (o MAC, por exemplo, costuma vir de um
 * segundo comando por PON).
 */
export interface DiscoveredOntRaw {
  /** SN GPON / phy-id — identidade física da ONU (ex.: "HWTC24680caa"). */
  serial: string;
  /** Coordenada lógica reportada pela OLT. */
  slot: number;
  pon: number;
  onuIndex: number;
  model?: string | null;       // ex.: "HG260"
  onuState?: string | null;    // texto cru: up/down/online/offline/los…
  macAddress?: string | null;  // canonicalizado AA:BB:CC:DD:EE:FF (chave p/ ERP)
  vlan?: number | null;
}

/**
 * Baseline de gerência aplicado na OLT (Fase 3): aponta syslog + NTP do
 * equipamento pros endpoints do NetX, pra receber eventos de queda
 * (dying-gasp/LOS) em tempo real e manter o relógio sincronizado. Campos
 * vazios/null são pulados (NetX não força o que não está configurado).
 */
export interface ManagementBaselineInput {
  /** Host/IP que a OLT alcança pra mandar syslog (coletor do NetX). */
  syslogHost?: string | null;
  /** Nível do syslog server no ZyNOS (0..7). */
  syslogLevel?: number;
  /** Servidor NTP a apontar na OLT (se o NetX expõe um). */
  ntpServer?: string | null;
  /** Offset de timezone no formato ZyNOS, ex "-0300" (BR), "-0400" (PY). */
  timezone?: string | null;
}

export interface ManagementBaselineResult {
  /** Itens efetivamente configurados (pra audit/UI). */
  applied: string[];
  /** Itens pulados (já corretos ou não configurados no NetX). */
  skipped: string[];
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
  /**
   * Opcional (Fase 3): aponta syslog + NTP da OLT pros endpoints do NetX.
   * Só drivers DIRECT por CLI implementam (ex: ZyxelZynosDriver). O
   * OltsService chama best-effort após salvar a OLT.
   */
  applyManagementBaseline?(
    ctx: OltConnectionContext,
    input: ManagementBaselineInput,
  ): Promise<OltDriverResult<ManagementBaselineResult>>;

  /**
   * Opcional (integrador técnico): VARRE a OLT e retorna o inventário de ONUs
   * autorizadas (serial, coordenada, estado e — quando possível — MAC). É a base
   * da descoberta que alimenta `discovered_onts`. Só drivers que sabem listar
   * (ex.: FiberhomeTelnetDriver) implementam. `onProgress` permite reportar
   * andamento de uma varredura longa (uma PON por vez) sem acumular tudo em
   * memória antes de gravar. Deve ser GENTIL com a OLT (pausas, 1 PON por vez).
   */
  listOnts?(
    ctx: OltConnectionContext,
    opts?: {
      onProgress?: (batch: DiscoveredOntRaw[], meta: { slot: number; pon: number }) => Promise<void>;
      /** Coletar MAC por PON (2º comando) — mais lento; default false. */
      collectMac?: boolean;
      /**
       * Limita a varredura a UM slot/pon (piloto controlado). Sem escopo, varre
       * a OLT inteira (slot all pon all). Útil pra testar 1 PON antes do lote.
       */
      scope?: { slot: number; pon: number };
    },
  ): Promise<OltDriverResult<{ onts: DiscoveredOntRaw[] }>>;

  /**
   * Opcional (integrador técnico): lê a POTÊNCIA ÓPTICA de todas as ONUs pela
   * OLT — a fonte de sinal para ONUs sem TR-069. Varre por PON (um comando por
   * PON cobre ~todas as ONUs da PON), gentil com a OLT. `onProgress` reporta por
   * PON. Só drivers que sabem ler óptico (ex.: FiberhomeTelnetDriver) implementam.
   */
  listOntOptical?(
    ctx: OltConnectionContext,
    opts?: {
      onProgress?: (batch: OntOpticalReading[], meta: { slot: number; pon: number }) => Promise<void>;
      /** Limita a UM slot/pon; sem escopo, varre os slots/pons conhecidos. */
      scope?: { slot: number; pon: number };
      /** PONs a varrer quando sem escopo específico (default: as descobertas). */
      pons?: Array<{ slot: number; pon: number }>;
    },
  ): Promise<OltDriverResult<{ readings: OntOpticalReading[] }>>;
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

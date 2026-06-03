/**
 * Data model paths Huawei EG8145V5/X10 (Customized HGW DataModel).
 *
 * Extraído pra arquivo standalone — pode ser importado pelo
 * Tr069TasksService (provisioning) e pelo ContractsService (mudança de
 * Wi-Fi pós-instalação) sem criar dep circular entre módulos.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
/**
 * Índice da WANConnectionDevice que carrega o serviço de INTERNET (PPPoE).
 *
 * ⚠️ ATENÇÃO: este índice depende de como o preset de fábrica / a Ufinet
 * estruturou as WAN connections na ONT. O padrão Huawei comum é:
 *   - WANConnectionDevice.1 → serviço de gerência (TR-069/management)
 *   - WANConnectionDevice.2 → serviço de internet (PPPoE)
 * mas varia. Se a injeção de PPPoE falhar (CPE retorna fault no SET_PARAMS),
 * o primeiro suspeito é este índice — confirme com a Ufinet o layout das
 * WANs no preset e ajuste aqui. É a ÚNICA constante a mexer.
 */
export const HUAWEI_PPPOE_WAN_INDEX = process.env.HUAWEI_PPPOE_WAN_INDEX ?? '2';

/** Monta o prefixo da WANPPPConnection de internet. */
const pppPrefix = `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${HUAWEI_PPPOE_WAN_INDEX}.WANPPPConnection.1`;

export const HUAWEI_EG8145_PATHS = {
  // SSID 2.4GHz e 5GHz (X10 tem ambos; V5 tem ambos em algumas firmwares)
  ssid24: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID',
  ssid50: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID',
  pwd24:
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey',
  pwd50:
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.PreSharedKey',
  // Security mode (WPA2-PSK)
  sec24: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_HW_SecurityMode',
  sec50: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.X_HW_SecurityMode',
  // Inform interval — reduzir após primeira config pra próxima sessão ser rápida
  informInterval: 'InternetGatewayDevice.ManagementServer.PeriodicInformInterval',
  // Credenciais de Connection Request — o NetX define valores conhecidos pra
  // poder acionar o CPE (ACS→CPE) e forçar uma sessão imediata.
  connReqUsername: 'InternetGatewayDevice.ManagementServer.ConnectionRequestUsername',
  connReqPassword: 'InternetGatewayDevice.ManagementServer.ConnectionRequestPassword',

  // ── WAN PPPoE (internet) — ZTP injeta a credencial do contrato aqui ──────
  pppoeUsername: `${pppPrefix}.Username`,
  pppoePassword: `${pppPrefix}.Password`,
  // Enable garante que a WAN PPPoE está ligada após setar a credencial.
  pppoeEnable: `${pppPrefix}.Enable`,
  // ConnectionType típico Huawei pra PPPoE roteado.
  pppoeConnectionType: `${pppPrefix}.ConnectionType`,
  // VLAN da WAN PPPoE (802.1Q). O preset da OLT já cria a WAN2 com a VLAN,
  // mas o NetX reaplica pra garantir (idempotente). X_HW_VLAN é a extensão
  // vendor Huawei pra VLAN ID na WAN connection.
  pppoeVlan: `${pppPrefix}.X_HW_VLAN`,

  // ── IPv6 — dual-stack na WAN PPPoE ───────────────────────────────────────
  // Habilita IPv6 na WAN. A ONT negocia IPv6CP no PPP, recebe o /64 da WAN
  // e o /56 delegado (DHCPv6-PD) — ambos vêm do RADIUS/BNG. A ONT redistribui
  // o /56 na LAN automaticamente (RA + DHCPv6-PD server interno).
  ipv6Enable: `${pppPrefix}.X_HW_IPv6Enable`,
} as const;

/** Range de PeriodicInformInterval recomendado. */
export const HUAWEI_INFORM_INTERVAL_DEFAULT = 60;

/** VLAN padrão da WAN PPPoE (preset da OLT já vem com ela). */
export const HUAWEI_PPPOE_DEFAULT_VLAN = 1010;

/**
 * Monta o SSID da banda 5GHz conforme o modo Wi-Fi do modelo de ONT:
 *   BAND_STEERING → mesmo nome (cliente vê uma rede só — EG8145X6/X10)
 *   DUAL_BAND     → nome + "-5G" (rede 5GHz distinta — EG8145V5)
 *                   ex.: "Charles" → "Charles-5G"
 */
export function ssid5gFor(
  ssid: string,
  mode: 'BAND_STEERING' | 'DUAL_BAND',
): string {
  return mode === 'DUAL_BAND' ? `${ssid}-5G` : ssid;
}

// =============================================================================
// DIAGNÓSTICO — paths de leitura (GetParameterValues) p/ monitoramento proativo
// =============================================================================
/**
 * ⚠️ ATENÇÃO (mesma natureza do HUAWEI_PPPOE_WAN_INDEX): o Huawei devolve um
 * SOAP Fault para o GetParameterValues INTEIRO se UM ÚNICO parâmetro pedido
 * não existir no data model do firmware. Por isso pedimos um conjunto canônico
 * (um path por métrica), não uma lista de alternativas. Se a coleta falhar com
 * fault 9005 (Invalid parameter name), o primeiro suspeito é o prefixo da
 * interface GPON — confirme no firmware da ONT e ajuste `HUAWEI_GPON_IFACE_PATH`.
 *
 * Prefixo da interface óptica GPON na WAN. ⚠️ O objeto correto nos
 * EG8145V5/X10 (firmware HW_WAP_CWMP_V02) é `X_GponInterafceConfig` — sim, com
 * o ERRO DE DIGITAÇÃO de fábrica da Huawei ("Inter**af**ce"). Confirmado ao
 * vivo via probe de data model (GetParameterValues por caminho parcial).
 */
export const HUAWEI_GPON_IFACE_PATH =
  process.env.HUAWEI_GPON_IFACE_PATH ??
  'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig';

/** Índices das WLANs (mesmos usados na config de SSID). */
const WLAN_24 = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1';
const WLAN_50 = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5';

/**
 * Paths de diagnóstico óptico — transceiver GPON da ONT.
 * Unidades dependem do firmware (ver normalização no ACS); guardamos o bruto.
 */
export const HUAWEI_OPTICAL_PATHS = {
  rxPower: `${HUAWEI_GPON_IFACE_PATH}.RXPower`,
  txPower: `${HUAWEI_GPON_IFACE_PATH}.TXPower`,
  temperature: `${HUAWEI_GPON_IFACE_PATH}.TransceiverTemperature`,
  voltage: `${HUAWEI_GPON_IFACE_PATH}.SupplyVoltage`,
  biasCurrent: `${HUAWEI_GPON_IFACE_PATH}.BiasCurrent`,
} as const;

/** Status do enlace GPON (Up/Down) — bom alvo de notificação ATIVA. */
export const HUAWEI_GPON_STATUS_PATH = `${HUAWEI_GPON_IFACE_PATH}.Status`;

/**
 * Estatísticas de qualidade do enlace GPON (subárvore .Stats). FEC/HEC subindo
 * é sinal precoce de fibra suja/conector ruim — antes do RX cair. Nomes
 * confirmados via probe de data model (HW_WAP_CWMP_V02).
 */
export const HUAWEI_GPON_STATS_PATHS = {
  fecErrors: `${HUAWEI_GPON_IFACE_PATH}.Stats.FECError`,
  hecErrors: `${HUAWEI_GPON_IFACE_PATH}.Stats.HECError`,
  dropRate: `${HUAWEI_GPON_IFACE_PATH}.Stats.DropRate`,
  errorRate: `${HUAWEI_GPON_IFACE_PATH}.Stats.ErrorRate`,
} as const;

/**
 * Atributos de notificação a armar no CPE (SetParameterAttributes):
 *   - Status do GPON → ATIVA (2): o CPE manda Inform assim que muda.
 *   - Níveis ópticos → PASSIVA (1): vão de carona no Inform periódico, então
 *     lemos óptico sem GET_PARAMS (sem risco de fault atômico).
 * Todos confirmados como existentes via probe de data model.
 */
export function huaweiNotificationAttributes(): Array<{ name: string; notification: 0 | 1 | 2 }> {
  return [
    { name: HUAWEI_GPON_STATUS_PATH, notification: 2 },
    { name: HUAWEI_OPTICAL_PATHS.rxPower, notification: 1 },
    { name: HUAWEI_OPTICAL_PATHS.txPower, notification: 1 },
    { name: HUAWEI_OPTICAL_PATHS.temperature, notification: 1 },
    { name: HUAWEI_OPTICAL_PATHS.voltage, notification: 1 },
    { name: HUAWEI_OPTICAL_PATHS.biasCurrent, notification: 1 },
    { name: HUAWEI_GPON_STATS_PATHS.fecErrors, notification: 1 },
    { name: HUAWEI_GPON_STATS_PATHS.hecErrors, notification: 1 },
    { name: HUAWEI_GPON_STATS_PATHS.dropRate, notification: 1 },
    { name: HUAWEI_GPON_STATS_PATHS.errorRate, notification: 1 },
  ];
}

/**
 * Diagnóstico da WAN PPPoE (lado do CPE) — responde "por que o cliente não
 * conecta?" sem olhar o RADIUS. Mesmo índice de WAN do provisionamento.
 */
export const HUAWEI_PPP_PATHS = {
  status: `${pppPrefix}.ConnectionStatus`,
  lastError: `${pppPrefix}.LastConnectionError`,
  uptime: `${pppPrefix}.Uptime`,
} as const;

/** Caminho PARCIAL da tabela de hosts (dispositivos na LAN do cliente). */
export const HUAWEI_HOSTS_PATH = 'InternetGatewayDevice.LANDevice.1.Hosts.Host.';

/** Toggles — desligue se algum firmware der fault no GET (o óptico vem por Inform). */
export const HUAWEI_PPP_DIAG_ENABLED = (process.env.TR069_PPP_ENABLED ?? '1') !== '0';
export const HUAWEI_HOSTS_ENABLED = (process.env.TR069_HOSTS_ENABLED ?? '1') !== '0';

/** Paths de diagnóstico Wi-Fi (agregado por banda). */
export const HUAWEI_WIFI_DIAG_PATHS = {
  clients24: `${WLAN_24}.TotalAssociations`,
  clients5: `${WLAN_50}.TotalAssociations`,
  channel24: `${WLAN_24}.Channel`,
  channel5: `${WLAN_50}.Channel`,
} as const;

/**
 * Caminhos PARCIAIS (objeto, terminam em ".") da tabela de clientes Wi-Fi
 * associados por banda. Num GetParameterValues, um path de objeto faz o CPE
 * devolver TODA a subárvore (`AssociatedDevice.1.*`, `.2.*`, …) — assim
 * descobrimos quantos clientes há e o RSSI de cada um sem saber a contagem
 * de antemão (TR-069 §A.3.2.1).
 *
 * ⚠️ Se algum firmware der fault no path parcial, desligue só a enumeração
 * por cliente com `TR069_WIFI_CLIENTS_ENABLED=0` — o diagnóstico óptico segue.
 */
export const HUAWEI_WIFI_ASSOC_PATHS = {
  assoc24: `${WLAN_24}.AssociatedDevice.`,
  assoc5: `${WLAN_50}.AssociatedDevice.`,
} as const;

/** Habilita a enumeração por cliente Wi-Fi (RSSI/MAC/taxa) no diagnóstico. */
export const HUAWEI_WIFI_CLIENTS_ENABLED =
  (process.env.TR069_WIFI_CLIENTS_ENABLED ?? '1') !== '0';

// =============================================================================
// TR-143 — diagnósticos a pedido (speed test / ping). Nomes padrão TR-098,
// confirmados ao vivo no firmware HW_WAP_CWMP_V02.
// =============================================================================
export const TR143_DOWNLOAD = {
  state: 'InternetGatewayDevice.DownloadDiagnostics.DiagnosticsState',
  url: 'InternetGatewayDevice.DownloadDiagnostics.DownloadURL',
  testBytes: 'InternetGatewayDevice.DownloadDiagnostics.TestBytesReceived',
  totalBytes: 'InternetGatewayDevice.DownloadDiagnostics.TotalBytesReceived',
  bomTime: 'InternetGatewayDevice.DownloadDiagnostics.BOMTime',
  eomTime: 'InternetGatewayDevice.DownloadDiagnostics.EOMTime',
} as const;

export const TR143_UPLOAD = {
  state: 'InternetGatewayDevice.UploadDiagnostics.DiagnosticsState',
  url: 'InternetGatewayDevice.UploadDiagnostics.UploadURL',
  testFileLength: 'InternetGatewayDevice.UploadDiagnostics.TestFileLength',
  totalBytesSent: 'InternetGatewayDevice.UploadDiagnostics.TotalBytesSent',
  bomTime: 'InternetGatewayDevice.UploadDiagnostics.BOMTime',
  eomTime: 'InternetGatewayDevice.UploadDiagnostics.EOMTime',
} as const;

export const TR143_PING = {
  state: 'InternetGatewayDevice.IPPingDiagnostics.DiagnosticsState',
  host: 'InternetGatewayDevice.IPPingDiagnostics.Host',
  reps: 'InternetGatewayDevice.IPPingDiagnostics.NumberOfRepetitions',
  timeout: 'InternetGatewayDevice.IPPingDiagnostics.Timeout',
  success: 'InternetGatewayDevice.IPPingDiagnostics.SuccessCount',
  failure: 'InternetGatewayDevice.IPPingDiagnostics.FailureCount',
  avg: 'InternetGatewayDevice.IPPingDiagnostics.AverageResponseTime',
  min: 'InternetGatewayDevice.IPPingDiagnostics.MinimumResponseTime',
  max: 'InternetGatewayDevice.IPPingDiagnostics.MaximumResponseTime',
} as const;

/** Nomes a ler no GET de resultado após "8 DIAGNOSTICS COMPLETE". */
export function tr143ResultParamNames(): string[] {
  return [
    TR143_DOWNLOAD.state,
    TR143_DOWNLOAD.testBytes,
    TR143_DOWNLOAD.totalBytes,
    TR143_DOWNLOAD.bomTime,
    TR143_DOWNLOAD.eomTime,
    TR143_UPLOAD.state,
    TR143_UPLOAD.totalBytesSent,
    TR143_UPLOAD.testFileLength,
    TR143_UPLOAD.bomTime,
    TR143_UPLOAD.eomTime,
    TR143_PING.state,
    TR143_PING.success,
    TR143_PING.failure,
    TR143_PING.avg,
    TR143_PING.min,
    TR143_PING.max,
  ];
}

/**
 * Lista achatada de nomes de parâmetro para o GetParameterValues de
 * diagnóstico. Ordem estável (óptico → Wi-Fi agregado → clientes) só por
 * legibilidade no log.
 */
export function huaweiDiagnosticParamNames(): string[] {
  return [
    ...Object.values(HUAWEI_OPTICAL_PATHS),
    HUAWEI_GPON_STATUS_PATH,
    ...Object.values(HUAWEI_GPON_STATS_PATHS),
    ...(HUAWEI_PPP_DIAG_ENABLED ? Object.values(HUAWEI_PPP_PATHS) : []),
    ...Object.values(HUAWEI_WIFI_DIAG_PATHS),
    ...(HUAWEI_WIFI_CLIENTS_ENABLED ? Object.values(HUAWEI_WIFI_ASSOC_PATHS) : []),
    ...(HUAWEI_HOSTS_ENABLED ? [HUAWEI_HOSTS_PATH] : []),
  ];
}

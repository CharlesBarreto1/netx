/**
 * Data model paths ZTE F670L (GPON ONT dual-band AC, raiz TR-098
 * `InternetGatewayDevice.`). Base: F670L V9.0 (SW V9.0.10P1N12A) do piloto PY
 * — device 6CD2A2-ZTEGC6A2F09E, primeiro Inform 2026-07-11. Espelha a
 * estrutura de tr069-paths.huawei.ts; consumido via tr069-paths.registry.ts.
 *
 * NÍVEL DE PROVA — [LIVE] = confirmado no device real. O perfil nasceu do
 * snapshot do Inform + data model público e em 2026-07-11 foi validado por
 * WALK COMPLETO ao vivo (GET_PARAMS de `InternetGatewayDevice.`, 2198 params,
 * task 5dba6ec1 no ACS do PY). O walk também CORRIGIU os chutes originais:
 * KeyPassphrase fica no nível da WLAN (não sob PreSharedKey.1), a VLAN é
 * X_ZTE-COM_VLANID na própria WANPPPConnection (WANGponLinkConfig NÃO existe),
 * o 5G não tem DFS 100-140 e CPU/memória são X_ZTE-COM_CpuUsed/MemUsed
 * (strings com "%", CPU por core). zteDiagnosticParamNames() segue preferindo
 * paths parciais (terminando em ".") — fault 9005 é atômico no GET e o
 * parcial não depende de nome de folha.
 *
 * Diferenças-chave vs Huawei:
 *   - SerialNumber CWMP É o SN GPON ("ZTEG..."), sem derivação — o placeholder
 *     pré-Inform casa direto com o deviceId real.
 *   - PPPoE de internet em WANDevice.1.WANConnectionDevice.1 [LIVE] (não WAN 2
 *     como Huawei). ⚠️ No piloto PY a WAN TR-069 dedicada (VLAN 1001) não pega
 *     IP — o TR-069 foi unificado na WAN PPPoE de internet.
 *   - Óptico em WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig [LIVE]. Este
 *     firmware reporta dBm/°C/mA DIRETO e SupplyVoltage em mV (3268) — o
 *     parser do ACS mantém a normalização tolerante (outros firmwares F6xx
 *     reportam deci/centi-dBm ou DDM cru), override via ZTE_OPTICAL_DIVISOR.
 *   - WLAN 1-4 = 2.4GHz e 5-8 = 5GHz [LIVE] (X_ZTE-COM_OperatingFrequencyBand
 *     confirma) — mesma convenção 1/5 do Huawei/Zyxel, NÃO a invertida VSOL.
 *   - Senha Wi-Fi é WLANConfiguration.{i}.KeyPassphrase [LIVE] — no nível da
 *     WLAN, não sob PreSharedKey.1 como Zyxel/VSOL (lá só existe o
 *     PreSharedKey.1.PreSharedKey hex, write-only).
 *   - DeviceSummary [LIVE]: "Baseline:1, EthernetLAN:4, WiFi:2, PONWAN:1,
 *     Voip:1, Time:1, IPPing:1" — SEM Download/Upload diagnostics: TR-143 de
 *     speed test NÃO existe nesse firmware (só IPPing).
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */

/**
 * Índice da WANConnectionDevice que carrega o serviço de INTERNET (PPPoE).
 * [LIVE] O Inform do piloto reporta ExternalIPAddress em
 * WANConnectionDevice.1.WANPPPConnection.1 — WAN 1 (não 2 como Huawei).
 */
export const ZTE_PPPOE_WAN_INDEX = process.env.ZTE_PPPOE_WAN_INDEX ?? '1';
const wanConnDev = `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${ZTE_PPPOE_WAN_INDEX}`;
const pppPrefix = `${wanConnDev}.WANPPPConnection.1`;

/**
 * Índice da WLANConfiguration por banda. [DOC] Convenção ZTE: instâncias 1-4
 * são os SSIDs do rádio 2.4GHz e 5-8 os do 5GHz (SSID5 = primeira rede 5G) —
 * igual Huawei/Zyxel. Se o firmware customizado (ProvisioningCode "TLCO.GRP2")
 * fugir disso, ajuste ZTE_WLAN_5G_INDEX sem redeploy.
 */
export const ZTE_WLAN_5G_INDEX = parseInt(process.env.ZTE_WLAN_5G_INDEX ?? '5', 10);
export const ZTE_WLAN_INDEX = { '2.4G': 1, '5G': ZTE_WLAN_5G_INDEX } as const;
const WLAN_24 = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1';
const WLAN_50 = `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${ZTE_WLAN_5G_INDEX}`;

export const ZTE_F670L_PATHS = {
  // ── Wi-Fi (sistema é dono) ───────────────────────────────────────────────
  ssid24: `${WLAN_24}.SSID`,
  ssid50: `${WLAN_50}.SSID`,
  // Senha: KeyPassphrase no NÍVEL DA WLAN [LIVE] — não PreSharedKey.1.* como
  // Zyxel/VSOL (no walk só existe PreSharedKey.1.PreSharedKey, o hex write-only).
  pwd24: `${WLAN_24}.KeyPassphrase`,
  pwd50: `${WLAN_50}.KeyPassphrase`,

  // ── ManagementServer (padrão TR-098 — igual aos demais vendors) [LIVE] ────
  informInterval: 'InternetGatewayDevice.ManagementServer.PeriodicInformInterval',
  connReqUsername: 'InternetGatewayDevice.ManagementServer.ConnectionRequestUsername',
  connReqPassword: 'InternetGatewayDevice.ManagementServer.ConnectionRequestPassword',

  // ── WAN PPPoE (internet) — WAN 1 [LIVE] ──────────────────────────────────
  pppoeUsername: `${pppPrefix}.Username`,
  pppoePassword: `${pppPrefix}.Password`,
  pppoeEnable: `${pppPrefix}.Enable`,
  pppoeConnectionType: `${pppPrefix}.ConnectionType`,
  // VLAN 802.1Q da WAN — X_ZTE-COM_VLANID na PRÓPRIA WANPPPConnection [LIVE]
  // (=1010 no piloto, com X_ZTE-COM_VLANEnable=1 ao lado; WANGponLinkConfig
  // NÃO existe neste data model). Env de escape caso outro firmware divirja.
  pppoeVlan: process.env.ZTE_PPPOE_VLAN_PATH ?? `${pppPrefix}.X_ZTE-COM_VLANID`,
} as const;

/** Segurança Wi-Fi — params padrão TR-098 (mesmo desenho da VSOL). [LIVE]
 * (walk: BeaconType=11i + IEEE11iAuthenticationMode/EncryptionModes de fábrica). */
export function zteWlanSecurityParams(
  band: '2.4G' | '5G',
  security: 'WPA2' | 'WPA_WPA2',
): Array<{ name: string; value: string; type: string }> {
  const p = `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${ZTE_WLAN_INDEX[band]}`;
  if (security === 'WPA2') {
    return [
      { name: `${p}.BeaconType`, value: '11i', type: 'xsd:string' },
      { name: `${p}.IEEE11iAuthenticationMode`, value: 'PSKAuthentication', type: 'xsd:string' },
      { name: `${p}.IEEE11iEncryptionModes`, value: 'AESEncryption', type: 'xsd:string' },
    ];
  }
  // WPA/WPA2 misto — WPA* (TKIP) + 11i (AES), padrão TR-098 puro.
  return [
    { name: `${p}.BeaconType`, value: 'WPAand11i', type: 'xsd:string' },
    { name: `${p}.WPAAuthenticationMode`, value: 'PSKAuthentication', type: 'xsd:string' },
    { name: `${p}.WPAEncryptionModes`, value: 'TKIPEncryption', type: 'xsd:string' },
    { name: `${p}.IEEE11iAuthenticationMode`, value: 'PSKAuthentication', type: 'xsd:string' },
    { name: `${p}.IEEE11iEncryptionModes`, value: 'AESEncryption', type: 'xsd:string' },
  ];
}

/** Paths de tuning de rádio (canal/potência) — padrão TR-098 puro. [LIVE]
 * (walk: AutoChannelEnable, Channel e TransmitPower c/ Supported=20..100). */
export function zteWlanPaths(band: '2.4G' | '5G') {
  const p = `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${ZTE_WLAN_INDEX[band]}`;
  return {
    channel: `${p}.Channel`,
    autoChannel: `${p}.AutoChannelEnable`,
    txPower: `${p}.TransmitPower`, // % do máximo, como Huawei/VSOL
  } as const;
}

/**
 * Canais válidos por banda — PossibleChannels do firmware [LIVE]: 2.4G vai
 * até 13; 5G NÃO tem a faixa DFS 100-140 (só UNII-1/2A/3).
 */
export const ZTE_WIFI_CHANNELS: Record<'2.4G' | '5G', number[]> = {
  '2.4G': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  '5G': [36, 40, 44, 48, 52, 56, 60, 64, 149, 153, 157, 161],
};

// =============================================================================
// DIAGNÓSTICO — paths de leitura (GetParameterValues). Todos confirmados no
// walk completo ao vivo (2026-07-11). Fault 9005 é ATÔMICO no GET — objetos
// entram como PATH PARCIAL (terminando em "."): o CPE devolve a subárvore
// inteira sem depender de nome de folha, robusto a variação de firmware.
// =============================================================================

/** Prefixo da interface óptica PON — objeto canônico da família F6xx. [LIVE] */
export const ZTE_PON_IFACE_PATH =
  process.env.ZTE_PON_IFACE_PATH ??
  'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig';

/**
 * Níveis ópticos do transceiver — folhas confirmadas no walk [LIVE]: RXPower
 * -24.2 / TXPower 2.53 (dBm direto), TransceiverTemperature 36.35 (°C),
 * BiasCurrent 12.9 (mA), SupplyVoltage 3268 (mV). Usadas pelo arme de
 * notificação e pelo parser; o GET de diagnóstico pede o OBJETO parcial
 * (ZTE_PON_IFACE_PATH + "."), robusto a firmware com folha divergente.
 */
export const ZTE_OPTICAL_PATHS = {
  rxPower: `${ZTE_PON_IFACE_PATH}.RXPower`,
  txPower: `${ZTE_PON_IFACE_PATH}.TXPower`,
  temperature: `${ZTE_PON_IFACE_PATH}.TransceiverTemperature`,
  voltage: `${ZTE_PON_IFACE_PATH}.SupplyVoltage`,
  biasCurrent: `${ZTE_PON_IFACE_PATH}.BiasCurrent`,
} as const;

/** Status do enlace PON (Up/Down). [LIVE] O walk também confirma Stats.FECError/HECError. */
export const ZTE_PON_STATUS_PATH = `${ZTE_PON_IFACE_PATH}.Status`;

/** Diagnóstico da WAN PPPoE — paths padrão TR-098 na WAN 1 [LIVE]. */
export const ZTE_PPP_PATHS = {
  status: `${pppPrefix}.ConnectionStatus`,
  lastError: `${pppPrefix}.LastConnectionError`,
  uptime: `${pppPrefix}.Uptime`,
} as const;

/** Contadores de bytes da WAN PPPoE (cumulativos) — base do throughput. */
export const ZTE_WAN_STATS_PATHS = {
  rxBytes: `${pppPrefix}.Stats.EthernetBytesReceived`,
  txBytes: `${pppPrefix}.Stats.EthernetBytesSent`,
} as const;

/** Diagnóstico Wi-Fi agregado por banda (padrão TR-098). [LIVE] */
export const ZTE_WIFI_DIAG_PATHS = {
  clients24: `${WLAN_24}.TotalAssociations`,
  clients5: `${WLAN_50}.TotalAssociations`,
  channel24: `${WLAN_24}.Channel`,
  channel5: `${WLAN_50}.Channel`,
} as const;

/**
 * Subárvore de clientes Wi-Fi associados (path parcial). [LIVE] Por cliente o
 * walk traz AssociatedDeviceMACAddress, AssociatedDeviceRssi (dBm negativo),
 * AssociatedDeviceRate/X_ZTE-COM_RXRate e IP — o parser do ACS casa MAC/RSSI/
 * taxas por substring, então funciona sem mapeamento extra.
 */
export const ZTE_WIFI_ASSOC_PATHS = {
  assoc24: `${WLAN_24}.AssociatedDevice.`,
  assoc5: `${WLAN_50}.AssociatedDevice.`,
} as const;

/** Caminho PARCIAL da tabela de hosts da LAN (padrão TR-098). [LIVE] */
export const ZTE_HOSTS_PATH = 'InternetGatewayDevice.LANDevice.1.Hosts.Host.';

/**
 * Recursos do CPE — extensões vendor [LIVE]: X_ZTE-COM_CpuUsed devolve UM
 * VALOR POR CORE com sufixo de porcentagem ("4%;1%") e X_ZTE-COM_MemUsed
 * devolve "17%". O padrão TR-098 (ProcessStatus/MemoryStatus) NÃO existe
 * neste data model. Normalização (strip "%", pior core) no parser do ACS.
 */
export const ZTE_DEVICE_RESOURCE_PATHS = {
  cpuUsed: 'InternetGatewayDevice.DeviceInfo.X_ZTE-COM_CpuUsed',
  memUsed: 'InternetGatewayDevice.DeviceInfo.X_ZTE-COM_MemUsed',
} as const;

/** Toggles compartilhados por fluxo (mesmos envs do Huawei/VSOL). */
const ZTE_PPP_DIAG_ENABLED = (process.env.TR069_PPP_ENABLED ?? '1') !== '0';
const ZTE_WIFI_CLIENTS_ENABLED = (process.env.TR069_WIFI_CLIENTS_ENABLED ?? '1') !== '0';
const ZTE_HOSTS_ENABLED = (process.env.TR069_HOSTS_ENABLED ?? '1') !== '0';
/** 5GHz no índice 5 [LIVE] — desligue se algum firmware tiver outro layout. */
const ZTE_WLAN5_ENABLED = (process.env.TR069_ZTE_WLAN5_ENABLED ?? '1') !== '0';
/** CPU/memória (X_ZTE-COM_*) [LIVE] — ligado por default desde o walk. */
const ZTE_DEVICE_RESOURCES_ENABLED =
  (process.env.TR069_ZTE_DEVICE_RESOURCES_ENABLED ?? '1') !== '0';

/**
 * Lista de nomes para o GET de diagnóstico — todos [LIVE]. Paths PARCIAIS
 * pros objetos óptico e PPP (subárvore completa, sem depender de folha);
 * folhas explícitas só no Wi-Fi agregado e nos recursos (escalares).
 * O path parcial do PPP já traz .Stats.* — sem toggle separado de WAN stats.
 */
export function zteDiagnosticParamNames(): string[] {
  return [
    `${ZTE_PON_IFACE_PATH}.`,
    ...(ZTE_PPP_DIAG_ENABLED ? [`${pppPrefix}.`] : []),
    ZTE_WIFI_DIAG_PATHS.clients24,
    ZTE_WIFI_DIAG_PATHS.channel24,
    ...(ZTE_WLAN5_ENABLED ? [ZTE_WIFI_DIAG_PATHS.clients5, ZTE_WIFI_DIAG_PATHS.channel5] : []),
    ...(ZTE_WIFI_CLIENTS_ENABLED
      ? [ZTE_WIFI_ASSOC_PATHS.assoc24, ...(ZTE_WLAN5_ENABLED ? [ZTE_WIFI_ASSOC_PATHS.assoc5] : [])]
      : []),
    ...(ZTE_HOSTS_ENABLED ? [ZTE_HOSTS_PATH] : []),
    ...(ZTE_DEVICE_RESOURCES_ENABLED ? Object.values(ZTE_DEVICE_RESOURCE_PATHS) : []),
  ];
}

/**
 * Atributos de notificação a armar (SetParameterAttributes): Status ATIVO (2)
 * + ópticos PASSIVOS (1), como nos demais vendors. Folhas confirmadas no walk
 * [LIVE]; se o firmware recusar o ARME (fault), a task falha e o polling
 * proativo segue como fallback — sem regressão.
 */
export function zteNotificationAttributes(): Array<{ name: string; notification: 0 | 1 | 2 }> {
  return [
    { name: ZTE_PON_STATUS_PATH, notification: 2 },
    { name: ZTE_OPTICAL_PATHS.rxPower, notification: 1 },
    { name: ZTE_OPTICAL_PATHS.txPower, notification: 1 },
    { name: ZTE_OPTICAL_PATHS.temperature, notification: 1 },
    { name: ZTE_OPTICAL_PATHS.voltage, notification: 1 },
    { name: ZTE_OPTICAL_PATHS.biasCurrent, notification: 1 },
  ];
}

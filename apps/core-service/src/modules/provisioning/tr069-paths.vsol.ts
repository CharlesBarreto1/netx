/**
 * Data model paths VSOL/Realtek (ONTs XPON com stack CT-COM/E8C, raiz TR-098
 * `InternetGatewayDevice.`). Coletados por dump completo ao vivo na bancada
 * (jul/2026) — firmware V2.0.10-200611, HW V1.3, productClass "XPON+2GE+2WIFI",
 * OUI 006D61, perfil X_CT-COM_InterfaceVersion 2271-2013.A.1. Espelha a
 * estrutura de tr069-paths.huawei.ts; consumido via tr069-paths.registry.ts.
 *
 * Diferenças-chave vs Huawei:
 *   - SerialNumber CWMP NÃO é o SN GPON: é "12345" + MAC base (ex.:
 *     12345006D61EF2342). O SN GPON ("GPON00EF2342") termina nos mesmos 3
 *     últimos bytes do MAC — o matching do ACS deriva um do outro.
 *   - Óptico em WANDevice.1.X_CT-COM_GponInterfaceConfig (grafia CORRETA
 *     "Interface" — não o typo Huawei "Interafce"). Valores crus estilo DDM
 *     SFF-8472 (TX/RX em 0.1µW, tensão em 100µV, bias em 2µA, temp em 0.01°C)
 *     — normalização no parser do ACS (diagnostics.ts).
 *   - Firmware tem typo próprio: "SupplyVottage" (não "SupplyVoltage").
 *   - PPPoE de internet no MESMO índice WAN 2 do Huawei; VLAN via
 *     X_CT-COM_WANGponLinkConfig.VLANIDMark (nível WANConnectionDevice).
 *   - Senha Wi-Fi é PreSharedKey.1.KeyPassphrase (como Zyxel).
 *   - Índices de WLAN INVERTIDOS: WLAN 1 = 5GHz, WLAN 5 = 2.4GHz (Huawei é
 *     o contrário) — ver VSOL_WLAN_INDEX.
 *   - SEM Hosts.Host (a tabela de LAN não existe — pedir dá fault 9005 no GET
 *     inteiro); os clientes Wi-Fi vêm por AssociatedDevice (MAC+IP, sem RSSI).
 *   - SEM NeighboringWiFiDiagnostic (scan de canais indisponível).
 *   - GetParameterValues da árvore INTEIRA estoura o session timeout — só
 *     pedir listas escalares/subárvores pequenas.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */

/** Prefixo da WANPPPConnection de internet (PPPoE). WAN 2, como no Huawei. */
export const VSOL_PPPOE_WAN_INDEX = process.env.VSOL_PPPOE_WAN_INDEX ?? '2';
const wanConnDev = `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${VSOL_PPPOE_WAN_INDEX}`;
const pppPrefix = `${wanConnDev}.WANPPPConnection.1`;

/**
 * Índice da WLANConfiguration por banda — ⚠️ INVERTIDO vs Huawei/Zyxel:
 * WLAN 1 = rádio 5GHz (Standard "ac,n,a", canais 36-161) e WLAN 5 = rádio
 * 2.4GHz (Standard "b,g,n", canais 1-11). Confirmado por Standard/
 * PossibleChannels no dump e por observação em bancada (SSID com sufixo
 * "-5G" aplicado no índice 5 apareceu na rede 2.4GHz).
 */
export const VSOL_WLAN_INDEX = { '2.4G': 5, '5G': 1 } as const;
const WLAN_24 = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5';
const WLAN_50 = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1';

export const VSOL_PATHS = {
  // ── Wi-Fi (sistema é dono) ───────────────────────────────────────────────
  ssid24: `${WLAN_24}.SSID`,
  ssid50: `${WLAN_50}.SSID`,
  // Senha: KeyPassphrase é o campo gravável (PreSharedKey é o hex derivado).
  pwd24: `${WLAN_24}.PreSharedKey.1.KeyPassphrase`,
  pwd50: `${WLAN_50}.PreSharedKey.1.KeyPassphrase`,

  // ── ManagementServer (padrão TR-098 — igual Huawei/Zyxel) ────────────────
  informInterval: 'InternetGatewayDevice.ManagementServer.PeriodicInformInterval',
  connReqUsername: 'InternetGatewayDevice.ManagementServer.ConnectionRequestUsername',
  connReqPassword: 'InternetGatewayDevice.ManagementServer.ConnectionRequestPassword',

  // ── WAN PPPoE (internet) ─────────────────────────────────────────────────
  pppoeUsername: `${pppPrefix}.Username`,
  pppoePassword: `${pppPrefix}.Password`,
  pppoeEnable: `${pppPrefix}.Enable`,
  pppoeConnectionType: `${pppPrefix}.ConnectionType`,
  // VLAN 802.1Q da WAN — extensão CT-COM no nível da WANConnectionDevice
  // (não da WANPPPConnection). Confirmado ao vivo: VLANIDMark=1010.
  pppoeVlan: `${wanConnDev}.X_CT-COM_WANGponLinkConfig.VLANIDMark`,
} as const;

/**
 * ⚠️ IPv6: o firmware VSOL expõe IPv6 via X_CT-COM_IPv6* (estrutura diferente
 * do X_HW_* Huawei) e o comportamento não foi provado em bancada. O ZTP NÃO
 * injeta IPv6 em VSOL até um probe confirmar os paths graváveis — dual-stack
 * fica por conta do preset/OMCI da OLT.
 */

/** Segurança Wi-Fi — params padrão TR-098, todos confirmados no dump. */
export function vsolWlanSecurityParams(
  band: '2.4G' | '5G',
  security: 'WPA2' | 'WPA_WPA2',
): Array<{ name: string; value: string; type: string }> {
  const p = `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${VSOL_WLAN_INDEX[band]}`;
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

/** Paths de tuning de rádio (canal/potência) — padrão TR-098 puro. */
export function vsolWlanPaths(band: '2.4G' | '5G') {
  const p = `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${VSOL_WLAN_INDEX[band]}`;
  return {
    channel: `${p}.Channel`,
    autoChannel: `${p}.AutoChannelEnable`,
    txPower: `${p}.TransmitPower`, // % (TransmitPower=100 observado)
  } as const;
}

/**
 * Canais válidos por banda — PossibleChannels reportado pelo firmware
 * (regdomain US-like: 2.4G vai só até 11; 5G sem 120-132 exceto 136/140).
 */
export const VSOL_WIFI_CHANNELS: Record<'2.4G' | '5G', number[]> = {
  '2.4G': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  '5G': [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 136, 140, 149, 153, 157, 161],
};

// =============================================================================
// DIAGNÓSTICO — paths de leitura (GetParameterValues). Todos confirmados no
// dump ao vivo; NÃO adicionar paths não provados (fault 9005 é atômico no GET).
// =============================================================================

/** Prefixo da interface óptica GPON (grafia correta "Interface"). */
export const VSOL_GPON_IFACE_PATH =
  process.env.VSOL_GPON_IFACE_PATH ??
  'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig';

/**
 * Níveis ópticos do transceiver — valores CRUS estilo DDM (SFF-8472):
 * TX/RXPower em 0.1µW, SupplyVottage (typo do firmware!) em 100µV,
 * BiasCurrent em 2µA, TransceiverTemperature em 0.01°C. O parser do ACS
 * (diagnostics.ts) converte pra dBm/V/mA/°C.
 */
export const VSOL_OPTICAL_PATHS = {
  rxPower: `${VSOL_GPON_IFACE_PATH}.RXPower`,
  txPower: `${VSOL_GPON_IFACE_PATH}.TXPower`,
  temperature: `${VSOL_GPON_IFACE_PATH}.TransceiverTemperature`,
  voltage: `${VSOL_GPON_IFACE_PATH}.SupplyVottage`,
  biasCurrent: `${VSOL_GPON_IFACE_PATH}.BiasCurrent`,
} as const;

/** Status do enlace GPON (Up/Down). */
export const VSOL_GPON_STATUS_PATH = `${VSOL_GPON_IFACE_PATH}.Status`;

/** Qualidade do enlace — FEC/HEC sobem antes do RX cair (fibra suja). */
export const VSOL_GPON_STATS_PATHS = {
  fecErrors: `${VSOL_GPON_IFACE_PATH}.Stats.FECError`,
  hecErrors: `${VSOL_GPON_IFACE_PATH}.Stats.HECError`,
} as const;

/** Diagnóstico da WAN PPPoE — mesmos paths padrão do Huawei (WAN 2). */
export const VSOL_PPP_PATHS = {
  status: `${pppPrefix}.ConnectionStatus`,
  lastError: `${pppPrefix}.LastConnectionError`,
  uptime: `${pppPrefix}.Uptime`,
} as const;

/** Contadores de bytes da WAN PPPoE (cumulativos) — base do throughput. */
export const VSOL_WAN_STATS_PATHS = {
  rxBytes: `${pppPrefix}.Stats.EthernetBytesReceived`,
  txBytes: `${pppPrefix}.Stats.EthernetBytesSent`,
} as const;

/** Diagnóstico Wi-Fi agregado por banda (padrão TR-098). */
export const VSOL_WIFI_DIAG_PATHS = {
  clients24: `${WLAN_24}.TotalAssociations`,
  clients5: `${WLAN_50}.TotalAssociations`,
  channel24: `${WLAN_24}.Channel`,
  channel5: `${WLAN_50}.Channel`,
} as const;

/**
 * Subárvore de clientes Wi-Fi associados. O firmware devolve MAC + IP +
 * AuthenticationState por cliente (SEM RSSI — o campo não existe nesse data
 * model, então a cobertura por cliente fica null; o agregado TotalAssociations
 * segue funcionando).
 */
export const VSOL_WIFI_ASSOC_PATHS = {
  assoc24: `${WLAN_24}.AssociatedDevice.`,
  assoc5: `${WLAN_50}.AssociatedDevice.`,
} as const;

/** Recursos do CPE — params escalares padrão TR-098 (iguais aos da Zyxel). */
export const VSOL_DEVICE_RESOURCE_PATHS = {
  cpuUsed: 'InternetGatewayDevice.DeviceInfo.ProcessStatus.CPUUsage',
  memTotal: 'InternetGatewayDevice.DeviceInfo.MemoryStatus.Total',
  memFree: 'InternetGatewayDevice.DeviceInfo.MemoryStatus.Free',
} as const;

/** Habilita a enumeração por cliente Wi-Fi no diagnóstico (mesmo env do Huawei). */
const VSOL_WIFI_CLIENTS_ENABLED = (process.env.TR069_WIFI_CLIENTS_ENABLED ?? '1') !== '0';
/** Habilita PPP/WAN stats (mesmos envs do Huawei — toggle global por fluxo). */
const VSOL_PPP_DIAG_ENABLED = (process.env.TR069_PPP_ENABLED ?? '1') !== '0';
const VSOL_WAN_STATS_ENABLED = (process.env.TR069_WAN_STATS_ENABLED ?? '1') !== '0';

/** Lista achatada de nomes de parâmetro para o GET de diagnóstico. */
export function vsolDiagnosticParamNames(): string[] {
  return [
    ...Object.values(VSOL_OPTICAL_PATHS),
    VSOL_GPON_STATUS_PATH,
    ...Object.values(VSOL_GPON_STATS_PATHS),
    ...(VSOL_PPP_DIAG_ENABLED ? Object.values(VSOL_PPP_PATHS) : []),
    ...(VSOL_WAN_STATS_ENABLED ? Object.values(VSOL_WAN_STATS_PATHS) : []),
    ...Object.values(VSOL_WIFI_DIAG_PATHS),
    ...(VSOL_WIFI_CLIENTS_ENABLED ? Object.values(VSOL_WIFI_ASSOC_PATHS) : []),
    ...Object.values(VSOL_DEVICE_RESOURCE_PATHS),
  ];
}

/**
 * Atributos de notificação a armar (SetParameterAttributes): Status ATIVO (2)
 * + ópticos PASSIVOS (1), como no Huawei. Se o firmware recusar (fault), a
 * task falha e o polling proativo segue como fallback — sem regressão.
 */
export function vsolNotificationAttributes(): Array<{ name: string; notification: 0 | 1 | 2 }> {
  return [
    { name: VSOL_GPON_STATUS_PATH, notification: 2 },
    { name: VSOL_OPTICAL_PATHS.rxPower, notification: 1 },
    { name: VSOL_OPTICAL_PATHS.txPower, notification: 1 },
    { name: VSOL_OPTICAL_PATHS.temperature, notification: 1 },
    { name: VSOL_OPTICAL_PATHS.voltage, notification: 1 },
    { name: VSOL_OPTICAL_PATHS.biasCurrent, notification: 1 },
    { name: VSOL_GPON_STATS_PATHS.fecErrors, notification: 1 },
    { name: VSOL_GPON_STATS_PATHS.hecErrors, notification: 1 },
  ];
}

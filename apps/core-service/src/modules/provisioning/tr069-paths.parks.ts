/**
 * Data model paths Parks (ONTs GPON/XPON, manufacturer "PARKS"/"PRKS", OUI
 * 000416, raiz TR-098 `InternetGatewayDevice.`). Consumido via
 * tr069-paths.registry.ts. A Parks tem DUAS famílias de firmware DISTINTAS na
 * base — cada uma um data model próprio, selecionadas por productClass:
 *
 *   • **5xx** (Fiberlink 411/501/511) — chipset Realtek RTL960x, stack gSOAP,
 *     extensões `X_RTK_`. Base: Fiberlink511 SW V4.1.0-231020 do device
 *     416-D92205 (ZUX-PR). UI idêntica nas 411/501/511 → mesmo data model.
 *   • **6xx** (Fiberlink 611/612) — stack easycwmp/OpenWrt, extensões
 *     `X_SKYW_` (Skyworth OEM). Base: Fiberlink_612 SW V1.0.2-250905 do device
 *     416-DFCFE0 (ZUX-PR). WiFi 6 (ax), IPv6 dual-stack via TR-069.
 *
 * NÍVEL DE PROVA — [LIVE] = confirmado no device real. Os dois perfis nasceram
 * de um DUMP COMPLETO ao vivo (GetParameterNames/param dump da raiz via UI web:
 * 4916 params no 511, 2450 no 612, 2026-07-23) cruzado com GET_PARAMS de folhas
 * no ACS.
 *
 * ⚠️ INVARIANTES COMUNS ÀS DUAS FAMÍLIAS:
 *   - **A Parks RECUSA GetParameterValues por PREFIXO DE SUBÁRVORE** (path
 *     terminando em ".") — Fault 9005 no GET INTEIRO (atômico). Ao contrário da
 *     ZTE, TODO diagnóstico pede FOLHA EXPLÍCITA; Hosts/AssociatedDevice entram
 *     por ÍNDICE FIXO (`.1`,`.2`,...), nunca por objeto parcial. Os counts
 *     `*NumberOfEntries` também dão fault — não usar.
 *   - **SEM ÓPTICO via TR-069**: NENHUMA família expõe RX/TX/temperatura do
 *     transceiver GPON (0 params ópticos nos dumps). O nível de sinal vem da OLT
 *     (OMCI). Os perfis nascem SEM diagnóstico óptico (como CPE de varejo
 *     Zyxel); o parser do ACS trata a ausência como opticalHealth=UNKNOWN sem
 *     abrir alerta.
 *   - SerialNumber CWMP é SÓ o sufixo hex ("D92205"/"DFCFE0"), sem o vendor ID
 *     PRKS nem o OUI — o deviceId real é "416-<serial>" (OUI 000416 → "416").
 *   - Recursos são **TR-098 padrão** (ProcessStatus.CPUUsage + MemoryStatus.
 *     Total/Free + TemperatureStatus.TemperatureSensor.1.Value) — SEM extensão
 *     X_HW_/X_ZTE_. Download+IPPing → TR-143 (speed test/ping) existe.
 *   - Clientes Wi-Fi via AssociatedDevice trazem MAC + IP (SEM RSSI — como VSOL:
 *     cobertura por cliente fica null, agregado TotalAssociations funciona).
 *
 * ⚠️ DIFERENÇAS 5xx vs 6xx (por isso DOIS perfis):
 *   - PPPoE: 5xx na **WAN 1**, 6xx na **WAN 2**.
 *   - VLAN: 5xx em leaf gravável `X_RTK_VlanMuxID`; 6xx NÃO tem leaf de VLAN —
 *     vem embutida no Name da conexão (`..._VID_120`), provisionada no preset da
 *     OLT (o ZTP TR-069 não injeta VLAN no 6xx).
 *   - IPv6: 5xx não expõe; 6xx tem `X_SKYW_IPStack`/`X_SKYW_IPV6*` completo.
 *   - WLAN índice↔banda: 5xx **1-5=5G / 6-10=2.4G** (SSID primário WLAN 1+6);
 *     6xx **1-4=2.4G / 5-8=5G** (convenção Huawei; SSID primário WLAN 1+5).
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */

export type ParksFamily = '5XX' | '6XX';

/**
 * Discrimina a família de firmware por productClass. Fiberlink 611/612 → 6XX
 * (easycwmp/X_SKYW); 411/501/511 (e qualquer outro Fiberlink) → 5XX
 * (gSOAP/X_RTK). Fallback 5XX (a família com mais modelos catalogados).
 */
export function parksFamilyFor(productClass?: string | null): ParksFamily {
  const pc = (productClass ?? '').toLowerCase();
  return /6\d\d/.test(pc.replace(/[^0-9]/g, '')) || /fiberlink_?6/.test(pc) ? '6XX' : '5XX';
}

// =============================================================================
// 5xx — Fiberlink 411/501/511 (Realtek RTL960x, gSOAP, X_RTK_)
// =============================================================================

/** WAN de internet (PPPoE) — WAN 1 [LIVE] (Username/ExternalIPAddress na WAN 1). */
export const PARKS_5XX_PPPOE_WAN_INDEX = process.env.PARKS_5XX_PPPOE_WAN_INDEX ?? '1';
const ppp5 = `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${PARKS_5XX_PPPOE_WAN_INDEX}.WANPPPConnection.1`;

/**
 * Índice da WLANConfiguration por banda — layout PRÓPRIO do 5xx [LIVE]:
 * instâncias 1-5 = rádio 5GHz (Standard "ac", Name "wlan0") e 6-10 = 2.4GHz
 * (Standard "bgn"). SSID primário do cliente = WLAN 1 (5G) e WLAN 6 (2.4G).
 */
export const PARKS_5XX_WLAN_INDEX = {
  '2.4G': parseInt(process.env.PARKS_5XX_WLAN_24_INDEX ?? '6', 10),
  '5G': parseInt(process.env.PARKS_5XX_WLAN_5G_INDEX ?? '1', 10),
} as const;

// =============================================================================
// 6xx — Fiberlink 611/612 (easycwmp/OpenWrt, X_SKYW_)
// =============================================================================

/** WAN de internet (PPPoE) — WAN 2 [LIVE] (Name "2_TR069_VOIP_INTERNET_R_VID_120"). */
export const PARKS_6XX_PPPOE_WAN_INDEX = process.env.PARKS_6XX_PPPOE_WAN_INDEX ?? '2';
const ppp6 = `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${PARKS_6XX_PPPOE_WAN_INDEX}.WANPPPConnection.1`;

/**
 * Índice da WLANConfiguration por banda — 6xx [LIVE]: 1-4 = 2.4GHz (Standard
 * "b,g,n,ax") e 5-8 = 5GHz (Standard "a,n,ac,ax"). SSID primário WLAN 1 (2.4G)
 * e WLAN 5 (5G) — convenção Huawei 1/5 (INVERSO do 5xx).
 */
export const PARKS_6XX_WLAN_INDEX = {
  '2.4G': parseInt(process.env.PARKS_6XX_WLAN_24_INDEX ?? '1', 10),
  '5G': parseInt(process.env.PARKS_6XX_WLAN_5G_INDEX ?? '5', 10),
} as const;

// -----------------------------------------------------------------------------

interface ParksProfile {
  family: ParksFamily;
  pppPrefix: string;
  wlanIndex: { '2.4G': number; '5G': number };
  /** Path da VLAN 802.1Q gravável, ou null se a família não expõe (6xx). */
  vlanPath: string | null;
  vlanEnablePath: string | null;
}

const PROFILE_5XX: ParksProfile = {
  family: '5XX',
  pppPrefix: ppp5,
  wlanIndex: PARKS_5XX_WLAN_INDEX,
  // VLAN via extensão Realtek na própria WANPPPConnection [LIVE].
  vlanPath: process.env.PARKS_5XX_PPPOE_VLAN_PATH ?? `${ppp5}.X_RTK_VlanMuxID`,
  vlanEnablePath: `${ppp5}.X_RTK_VlanEnable`,
};

const PROFILE_6XX: ParksProfile = {
  family: '6XX',
  pppPrefix: ppp6,
  wlanIndex: PARKS_6XX_WLAN_INDEX,
  // 6xx NÃO tem leaf de VLAN gravável — vem no Name da conexão, provisionada no
  // preset da OLT. O ZTP TR-069 não injeta VLAN aqui.
  vlanPath: null,
  vlanEnablePath: null,
};

function profileFor(family: ParksFamily): ParksProfile {
  return family === '6XX' ? PROFILE_6XX : PROFILE_5XX;
}

function wlan(prof: ParksProfile, band: '2.4G' | '5G'): string {
  return `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${prof.wlanIndex[band]}`;
}

/**
 * Paths de provisionamento (ZTP + troca de Wi-Fi) por família. Senha Wi-Fi:
 * `KeyPassphrase` no NÍVEL DA WLAN [LIVE] (gravável nas duas famílias).
 */
export function parksProvisioningPaths(family: ParksFamily) {
  const prof = profileFor(family);
  const w24 = wlan(prof, '2.4G');
  const w50 = wlan(prof, '5G');
  return {
    ssid24: `${w24}.SSID`,
    ssid50: `${w50}.SSID`,
    pwd24: `${w24}.KeyPassphrase`,
    pwd50: `${w50}.KeyPassphrase`,
    informInterval: 'InternetGatewayDevice.ManagementServer.PeriodicInformInterval',
    connReqUsername: 'InternetGatewayDevice.ManagementServer.ConnectionRequestUsername',
    connReqPassword: 'InternetGatewayDevice.ManagementServer.ConnectionRequestPassword',
    pppoeUsername: `${prof.pppPrefix}.Username`,
    pppoePassword: `${prof.pppPrefix}.Password`,
    pppoeEnable: `${prof.pppPrefix}.Enable`,
    // VLAN: 6xx não tem leaf → devolve string vazia (o registry filtra vazios
    // no SET; a VLAN do 6xx vem do preset da OLT).
    pppoeVlan: prof.vlanPath ?? '',
  } as const;
}

/** Segurança Wi-Fi — params padrão TR-098 (BeaconType=11i confirmado [LIVE]). */
export function parksWlanSecurityParams(
  family: ParksFamily,
  band: '2.4G' | '5G',
  security: 'WPA2' | 'WPA_WPA2',
): Array<{ name: string; value: string; type: string }> {
  const p = wlan(profileFor(family), band);
  if (security === 'WPA2') {
    return [
      { name: `${p}.BeaconType`, value: '11i', type: 'xsd:string' },
      { name: `${p}.IEEE11iAuthenticationMode`, value: 'PSKAuthentication', type: 'xsd:string' },
      { name: `${p}.IEEE11iEncryptionModes`, value: 'AESEncryption', type: 'xsd:string' },
    ];
  }
  return [
    { name: `${p}.BeaconType`, value: 'WPAand11i', type: 'xsd:string' },
    { name: `${p}.WPAAuthenticationMode`, value: 'PSKAuthentication', type: 'xsd:string' },
    { name: `${p}.WPAEncryptionModes`, value: 'TKIPEncryption', type: 'xsd:string' },
    { name: `${p}.IEEE11iAuthenticationMode`, value: 'PSKAuthentication', type: 'xsd:string' },
    { name: `${p}.IEEE11iEncryptionModes`, value: 'AESEncryption', type: 'xsd:string' },
  ];
}

/** Paths de tuning de rádio (canal/potência) — padrão TR-098 puro [LIVE]. */
export function parksWlanPaths(family: ParksFamily, band: '2.4G' | '5G') {
  const p = wlan(profileFor(family), band);
  return {
    channel: `${p}.Channel`,
    autoChannel: `${p}.AutoChannelEnable`,
    txPower: `${p}.TransmitPower`, // % do máximo (TransmitPower=100 observado)
  } as const;
}

/**
 * Canais válidos por banda. ⚠️ [DOC] — o valor de PossibleChannels não foi
 * capturado; conjunto comum BR. Ajuste quando um GET confirmar.
 */
export const PARKS_WIFI_CHANNELS: Record<'2.4G' | '5G', number[]> = {
  '2.4G': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  '5G': [36, 40, 44, 48, 52, 56, 60, 64, 149, 153, 157, 161],
};

// =============================================================================
// DIAGNÓSTICO — paths de leitura (GetParameterValues). ⚠️ SÓ FOLHA EXPLÍCITA
// (a Parks recusa subárvore). SEM óptico (não existe em nenhuma família).
// =============================================================================

/** WAN PPPoE — status/erro/uptime (padrão TR-098) [LIVE]. */
export function parksPppPaths(family: ParksFamily) {
  const pfx = profileFor(family).pppPrefix;
  return {
    status: `${pfx}.ConnectionStatus`,
    lastError: `${pfx}.LastConnectionError`,
    uptime: `${pfx}.Uptime`,
  } as const;
}

/** Contadores de bytes da WAN PPPoE (cumulativos) — base do throughput [LIVE]. */
export function parksWanStatsPaths(family: ParksFamily) {
  const pfx = profileFor(family).pppPrefix;
  return {
    rxBytes: `${pfx}.Stats.EthernetBytesReceived`,
    txBytes: `${pfx}.Stats.EthernetBytesSent`,
  } as const;
}

/** Diagnóstico Wi-Fi agregado por banda (padrão TR-098) [LIVE]. */
export function parksWifiDiagPaths(family: ParksFamily) {
  const prof = profileFor(family);
  const w24 = wlan(prof, '2.4G');
  const w50 = wlan(prof, '5G');
  return {
    clients24: `${w24}.TotalAssociations`,
    clients5: `${w50}.TotalAssociations`,
    channel24: `${w24}.Channel`,
    channel5: `${w50}.Channel`,
  } as const;
}

/** Recursos do CPE — escalares padrão TR-098 [LIVE] (as duas famílias). */
export const PARKS_DEVICE_RESOURCE_PATHS = {
  cpuUsed: 'InternetGatewayDevice.DeviceInfo.ProcessStatus.CPUUsage',
  memTotal: 'InternetGatewayDevice.DeviceInfo.MemoryStatus.Total',
  memFree: 'InternetGatewayDevice.DeviceInfo.MemoryStatus.Free',
  deviceTemp: 'InternetGatewayDevice.DeviceInfo.TemperatureStatus.TemperatureSensor.1.Value',
} as const;

/** Máximo de slots a enumerar por índice (clientes Wi-Fi / hosts). */
export const PARKS_WIFI_CLIENTS_MAX = parseInt(process.env.PARKS_WIFI_CLIENTS_MAX ?? '8', 10);
export const PARKS_HOSTS_MAX = parseInt(process.env.PARKS_HOSTS_MAX ?? '16', 10);

/** Folhas de clientes Wi-Fi por ÍNDICE EXPLÍCITO (sem subárvore parcial). */
function assocLeaves(wlanPrefix: string, max: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= max; i++) {
    out.push(
      `${wlanPrefix}.AssociatedDevice.${i}.AssociatedDeviceMACAddress`,
      `${wlanPrefix}.AssociatedDevice.${i}.AssociatedDeviceIPAddress`,
    );
  }
  return out;
}

/** Folhas de hosts da LAN por ÍNDICE EXPLÍCITO (sem subárvore parcial) [LIVE]. */
function hostLeaves(max: number): string[] {
  const out: string[] = [];
  const base = 'InternetGatewayDevice.LANDevice.1.Hosts.Host';
  for (let i = 1; i <= max; i++) {
    out.push(
      `${base}.${i}.MACAddress`,
      `${base}.${i}.IPAddress`,
      `${base}.${i}.HostName`,
      `${base}.${i}.Active`,
    );
  }
  return out;
}

const PARKS_PPP_DIAG_ENABLED = (process.env.TR069_PPP_ENABLED ?? '1') !== '0';
const PARKS_WAN_STATS_ENABLED = (process.env.TR069_WAN_STATS_ENABLED ?? '1') !== '0';
const PARKS_WIFI_CLIENTS_ENABLED = (process.env.TR069_WIFI_CLIENTS_ENABLED ?? '1') !== '0';
const PARKS_HOSTS_ENABLED = (process.env.TR069_HOSTS_ENABLED ?? '1') !== '0';
const PARKS_DEVICE_RESOURCES_ENABLED = (process.env.TR069_DEVICE_RESOURCES_ENABLED ?? '1') !== '0';

/**
 * Lista de nomes para o GET de diagnóstico por família — todas FOLHAS
 * EXPLÍCITAS [LIVE] (a Parks recusa subárvore). SEM óptico.
 */
export function parksDiagnosticParamNames(family: ParksFamily): string[] {
  const prof = profileFor(family);
  const ppp = parksPppPaths(family);
  const wanStats = parksWanStatsPaths(family);
  const wifi = parksWifiDiagPaths(family);
  const w24 = wlan(prof, '2.4G');
  const w50 = wlan(prof, '5G');
  return [
    ...(PARKS_PPP_DIAG_ENABLED ? Object.values(ppp) : []),
    ...(PARKS_WAN_STATS_ENABLED ? Object.values(wanStats) : []),
    ...Object.values(wifi),
    ...(PARKS_WIFI_CLIENTS_ENABLED
      ? [...assocLeaves(w24, PARKS_WIFI_CLIENTS_MAX), ...assocLeaves(w50, PARKS_WIFI_CLIENTS_MAX)]
      : []),
    ...(PARKS_HOSTS_ENABLED ? hostLeaves(PARKS_HOSTS_MAX) : []),
    ...(PARKS_DEVICE_RESOURCES_ENABLED ? Object.values(PARKS_DEVICE_RESOURCE_PATHS) : []),
  ];
}

/**
 * Atributos de notificação a armar (SetParameterAttributes). SEM óptico (não
 * existe); armamos a WAN PPPoE ATIVA (2) — o CPE avisa quando a internet cai.
 * Se o firmware recusar o ARME (fault), a task falha e o polling proativo segue
 * como fallback — sem regressão.
 */
export function parksNotificationAttributes(family: ParksFamily): Array<{ name: string; notification: 0 | 1 | 2 }> {
  return [{ name: parksPppPaths(family).status, notification: 2 }];
}

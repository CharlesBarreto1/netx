/**
 * Data model paths Stavix / Datacom (ONTs GPON, raiz TR-098
 * `InternetGatewayDevice.`, chipset Realtek — "Powered by Realtek"). Consumido
 * via tr069-paths.registry.ts.
 *
 * ⚠️ Stavix e Datacom são o **MESMO hardware rebrandado** — um único perfil, dois
 * matchers no registry. No dump ao vivo do device MKPGB os DOIS rótulos de modelo
 * coexistem no mesmo CPE: `ModelName="DM986-416 AX30"` (rótulo Datacom) e
 * `ProductClass="MP-X4410A"` (rótulo Stavix/MKTECH). A ÚNICA coisa que distingue
 * as marcas é o `manufacturer` do Inform:
 *   • **Stavix**  — manufacturer "MKTECH", OUI 0CF0B4, serial "MKPG…"
 *   • **Datacom** — manufacturer "Datacom", OUI 1881ED, serial "DACM…"
 *
 * NÍVEL DE PROVA — [LIVE] = confirmado no device real. Este perfil nasceu de um
 * DUMP COMPLETO COM VALORES (export GenieACS, 3825 params com valor + 5087 nomes,
 * device 0CF0B4-MKPGB4E18DEB, base ZUX-PR, 2026-07-24) — por isso as UNIDADES do
 * óptico e o mapa índice↔banda das WLANs são [LIVE], não [DOC].
 *
 * ⚠️ INVARIANTES (do dump):
 *   - Raiz **TR-098** `InternetGatewayDevice.` (NÃO TR-181 `Device.`).
 *   - **TEM óptico via TR-069** em `WANDevice.1.X_GponInterafceConfig` — MESMO
 *     objeto (e MESMO typo de fábrica "Inter**af**ce") do Huawei, MAS `SupplyVoltage`
 *     com grafia CORRETA (≠ "Vottage" da VSOL/Nokia). Valores em unidade HUMANA
 *     direta: RXPower/TXPower em dBm ("-21"/"2"), SupplyVoltage em mV ("3298"),
 *     BiasCurrent em mA ("9"). ⚠️ `TransceiverTemperature` do GponIface é LIXO
 *     (escala desconhecida — "98" com o transceiver a 36°C real); a temperatura
 *     boa vem do sensor TR-098 dedicado (TemperatureSensor.2 "Optical Module").
 *   - PPPoE de internet na **WANConnectionDevice.1 / WANPPPConnection.1** (única —
 *     WANPPPConnectionNumberOfEntries=1, WAN 1 e não WAN 2). Extensão `X_CT-COM_`.
 *   - VLAN 802.1Q gravável em `WANPPPConnection.1.X_CT-COM_VLANIDMark` (com
 *     `X_CT-COM_VLANMode`); o preset da OLT já cria a WAN com a VLAN, o ZTP
 *     reaplica por garantia (idempotente).
 *   - **WLAN invertido igual VSOL/Parks-5xx**: instâncias **1-5 = 5GHz**
 *     (`Standard "a,n,ac,ax"`) e **6-10 = 2.4GHz** (`Standard "b,g,n,ax"`). SSID
 *     primário = WLAN 1 (5G) e WLAN 6 (2.4G). Senha Wi-Fi = `KeyPassphrase` no
 *     NÍVEL DA WLAN [LIVE] (gravável; PreSharedKey.1.* também existe).
 *   - **SEM RSSI por cliente**: AssociatedDevice traz só MAC/IP/AuthState (como
 *     VSOL/Parks) — cobertura por cliente fica null, agregado TotalAssociations
 *     funciona. ⚠️ há uma árvore WLAN DUPLICADA em `LANInterfaces.WLANConfiguration.*`
 *     (espelho read-only) — ancoramos SEMPRE em `LANDevice.1.WLANConfiguration.`.
 *   - Recursos **TR-098 padrão** (ProcessStatus.CPUUsage + MemoryStatus.Total/Free
 *     + TemperatureSensor.1.Value) — SEM extensão X_HW_/X_ZTE_. TR-143 existe.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */

/** Óptico: MESMO objeto (e typo) do Huawei, mas grafia "SupplyVoltage" correta. */
export const STAVIX_GPON_IFACE =
  process.env.STAVIX_GPON_IFACE_PATH ??
  'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig';

/** WAN de internet (PPPoE) — WANConnectionDevice.1 [LIVE] (única WANPPPConnection). */
export const STAVIX_PPPOE_WAN_INDEX = process.env.STAVIX_PPPOE_WAN_INDEX ?? '1';
const ppp = `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${STAVIX_PPPOE_WAN_INDEX}.WANPPPConnection.1`;

/**
 * VLAN 802.1Q da WAN — extensão X_CT-COM na própria WANPPPConnection [LIVE]
 * (X_CT-COM_VLANIDMark="120" no dump). NÃO fica no GponLinkConfig (Nokia) nem
 * numa extensão Realtek (Parks-5xx X_RTK_).
 */
export const STAVIX_PPPOE_VLAN_PATH =
  process.env.STAVIX_PPPOE_VLAN_PATH ?? `${ppp}.X_CT-COM_VLANIDMark`;

/**
 * Índice da WLANConfiguration por banda — layout INVERTIDO (igual VSOL/Parks-5xx)
 * [LIVE]: instâncias 1-5 = rádio 5GHz (Standard "a,n,ac,ax") e 6-10 = 2.4GHz
 * (Standard "b,g,n,ax"). SSID primário = WLAN 1 (5G) e WLAN 6 (2.4G).
 */
export const STAVIX_WLAN_INDEX = {
  '2.4G': parseInt(process.env.STAVIX_WLAN_24_INDEX ?? '6', 10),
  '5G': parseInt(process.env.STAVIX_WLAN_5G_INDEX ?? '1', 10),
} as const;

function wlan(band: '2.4G' | '5G'): string {
  return `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${STAVIX_WLAN_INDEX[band]}`;
}

/**
 * Paths de provisionamento (ZTP + troca de Wi-Fi). Senha Wi-Fi via
 * `KeyPassphrase` no NÍVEL DA WLAN [LIVE] (gravável) — como Parks/Nokia.
 */
export function stavixProvisioningPaths() {
  const w24 = wlan('2.4G');
  const w50 = wlan('5G');
  return {
    ssid24: `${w24}.SSID`,
    ssid50: `${w50}.SSID`,
    pwd24: `${w24}.KeyPassphrase`,
    pwd50: `${w50}.KeyPassphrase`,
    informInterval: 'InternetGatewayDevice.ManagementServer.PeriodicInformInterval',
    connReqUsername: 'InternetGatewayDevice.ManagementServer.ConnectionRequestUsername',
    connReqPassword: 'InternetGatewayDevice.ManagementServer.ConnectionRequestPassword',
    pppoeUsername: `${ppp}.Username`,
    pppoePassword: `${ppp}.Password`,
    pppoeEnable: `${ppp}.Enable`,
    pppoeVlan: STAVIX_PPPOE_VLAN_PATH,
  } as const;
}

/** Segurança Wi-Fi — params padrão TR-098 (BeaconType=WPA2/11i) [LIVE]. */
export function stavixWlanSecurityParams(
  band: '2.4G' | '5G',
  security: 'WPA2' | 'WPA_WPA2',
): Array<{ name: string; value: string; type: string }> {
  const p = wlan(band);
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
export function stavixWlanPaths(band: '2.4G' | '5G') {
  const p = wlan(band);
  return {
    channel: `${p}.Channel`,
    autoChannel: `${p}.AutoChannelEnable`,
    txPower: `${p}.TransmitPower`, // % do máximo (TransmitPower=100 observado)
  } as const;
}

/**
 * Canais válidos por banda. 2.4G [DOC] (conjunto comum BR); 5G [LIVE] — vem de
 * `WLANConfiguration.1.PossibleChannels` no dump ("36..64,100..140,149..161").
 */
export const STAVIX_WIFI_CHANNELS: Record<'2.4G' | '5G', number[]> = {
  '2.4G': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  '5G': [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 136, 140, 149, 153, 157, 161],
};

// =============================================================================
// DIAGNÓSTICO — paths de leitura (GetParameterValues) p/ monitoramento proativo.
// TEM óptico (X_GponInterafceConfig) e agregado Wi-Fi; SEM RSSI por cliente.
// =============================================================================

/**
 * Óptico do transceiver GPON — objeto `X_GponInterafceConfig` (MESMO typo do
 * Huawei) [LIVE]. Valores em unidade HUMANA direta (dBm/mV/mA) — ver o parser
 * do ACS (diagnostics.ts). ⚠️ TransceiverTemperature OMITIDO de propósito: o
 * campo é lixo (escala desconhecida); a temperatura vem do sensor TR-098.
 */
export const STAVIX_OPTICAL_PATHS = {
  rxPower: `${STAVIX_GPON_IFACE}.RXPower`,
  txPower: `${STAVIX_GPON_IFACE}.TXPower`,
  voltage: `${STAVIX_GPON_IFACE}.SupplyVoltage`,
  biasCurrent: `${STAVIX_GPON_IFACE}.BiasCurrent`,
} as const;

/** Status do transceiver óptico (Up/Down) — alvo de notificação ATIVA. */
export const STAVIX_OPTICAL_STATUS_PATH = `${STAVIX_GPON_IFACE}.Status`;

/** WAN PPPoE — status/erro/uptime (padrão TR-098) [LIVE]. */
export const STAVIX_PPP_PATHS = {
  status: `${ppp}.ConnectionStatus`,
  lastError: `${ppp}.LastConnectionError`,
  uptime: `${ppp}.Uptime`,
} as const;

/** Contadores de bytes da WAN PPPoE (cumulativos) — base do throughput [LIVE]. */
export const STAVIX_WAN_STATS_PATHS = {
  rxBytes: `${ppp}.Stats.EthernetBytesReceived`,
  txBytes: `${ppp}.Stats.EthernetBytesSent`,
} as const;

/**
 * Recursos do CPE — escalares padrão TR-098 [LIVE]. TemperatureSensor.1 é o SoC;
 * o .2 "Optical Module" é a temperatura óptica boa (o campo do GponIface é lixo).
 */
export const STAVIX_DEVICE_RESOURCE_PATHS = {
  cpuUsed: 'InternetGatewayDevice.DeviceInfo.ProcessStatus.CPUUsage',
  memTotal: 'InternetGatewayDevice.DeviceInfo.MemoryStatus.Total',
  memFree: 'InternetGatewayDevice.DeviceInfo.MemoryStatus.Free',
  deviceTemp: 'InternetGatewayDevice.DeviceInfo.TemperatureStatus.TemperatureSensor.1.Value',
} as const;

/** Diagnóstico Wi-Fi agregado por banda (padrão TR-098) [LIVE]. */
export function stavixWifiDiagPaths() {
  const w24 = wlan('2.4G');
  const w50 = wlan('5G');
  return {
    clients24: `${w24}.TotalAssociations`,
    clients5: `${w50}.TotalAssociations`,
    channel24: `${w24}.Channel`,
    channel5: `${w50}.Channel`,
  } as const;
}

/** Máximo de slots a enumerar por índice (clientes Wi-Fi / hosts). */
export const STAVIX_WIFI_CLIENTS_MAX = parseInt(process.env.STAVIX_WIFI_CLIENTS_MAX ?? '8', 10);
export const STAVIX_HOSTS_MAX = parseInt(process.env.STAVIX_HOSTS_MAX ?? '16', 10);

/**
 * Folhas de clientes Wi-Fi por ÍNDICE EXPLÍCITO. Só MAC+IP existem (SEM RSSI).
 * Ancorado em LANDevice.1.WLANConfiguration (nunca a árvore-espelho LANInterfaces).
 */
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

/** Folhas de hosts da LAN por ÍNDICE EXPLÍCITO [LIVE]. */
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

const STAVIX_OPTICAL_ENABLED = (process.env.TR069_OPTICAL_ENABLED ?? '1') !== '0';
const STAVIX_PPP_DIAG_ENABLED = (process.env.TR069_PPP_ENABLED ?? '1') !== '0';
const STAVIX_WAN_STATS_ENABLED = (process.env.TR069_WAN_STATS_ENABLED ?? '1') !== '0';
const STAVIX_WIFI_CLIENTS_ENABLED = (process.env.TR069_WIFI_CLIENTS_ENABLED ?? '1') !== '0';
const STAVIX_HOSTS_ENABLED = (process.env.TR069_HOSTS_ENABLED ?? '1') !== '0';
const STAVIX_DEVICE_RESOURCES_ENABLED = (process.env.TR069_DEVICE_RESOURCES_ENABLED ?? '1') !== '0';

/**
 * Lista de nomes para o GET de diagnóstico — todas FOLHAS EXPLÍCITAS (o GET
 * TR-069 é atômico; folha ausente = Fault 9005 no GET inteiro). Óptico +
 * Wi-Fi agregado + clientes (por índice) + hosts + recursos. [LIVE] no dump.
 * Se um firmware diferente derrubar a coleta, desligue o bloco suspeito pelo env.
 */
export function stavixDiagnosticParamNames(): string[] {
  const wifi = stavixWifiDiagPaths();
  const w24 = wlan('2.4G');
  const w50 = wlan('5G');
  return [
    ...(STAVIX_OPTICAL_ENABLED
      ? [...Object.values(STAVIX_OPTICAL_PATHS), STAVIX_OPTICAL_STATUS_PATH]
      : []),
    ...(STAVIX_PPP_DIAG_ENABLED ? Object.values(STAVIX_PPP_PATHS) : []),
    ...(STAVIX_WAN_STATS_ENABLED ? Object.values(STAVIX_WAN_STATS_PATHS) : []),
    ...Object.values(wifi),
    ...(STAVIX_WIFI_CLIENTS_ENABLED
      ? [...assocLeaves(w24, STAVIX_WIFI_CLIENTS_MAX), ...assocLeaves(w50, STAVIX_WIFI_CLIENTS_MAX)]
      : []),
    ...(STAVIX_HOSTS_ENABLED ? hostLeaves(STAVIX_HOSTS_MAX) : []),
    ...(STAVIX_DEVICE_RESOURCES_ENABLED ? Object.values(STAVIX_DEVICE_RESOURCE_PATHS) : []),
  ];
}

/**
 * Atributos de notificação a armar (SetParameterAttributes):
 *   - Óptico Status → ATIVA (2): avisa quando o enlace GPON muda.
 *   - Níveis ópticos → PASSIVA (1): vão de carona no Inform periódico (lemos
 *     óptico sem GET_PARAMS, sem risco de fault atômico) — como Huawei/Nokia.
 *   - WAN PPPoE → ATIVA (2): avisa quando a internet cai.
 * Se o firmware recusar o ARME (fault), a task falha e o polling proativo segue
 * como fallback — sem regressão.
 */
export function stavixNotificationAttributes(): Array<{ name: string; notification: 0 | 1 | 2 }> {
  return [
    { name: STAVIX_OPTICAL_STATUS_PATH, notification: 2 },
    { name: STAVIX_PPP_PATHS.status, notification: 2 },
    { name: STAVIX_OPTICAL_PATHS.rxPower, notification: 1 },
    { name: STAVIX_OPTICAL_PATHS.txPower, notification: 1 },
    { name: STAVIX_OPTICAL_PATHS.voltage, notification: 1 },
    { name: STAVIX_OPTICAL_PATHS.biasCurrent, notification: 1 },
  ];
}

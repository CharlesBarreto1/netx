/**
 * Data model paths Nokia (ONTs GPON, manufacturer "Nokia"/"ALCL", OUI da família
 * Alcatel-Lucent, raiz TR-098 `InternetGatewayDevice.`). Consumido via
 * tr069-paths.registry.ts. Modelo base: **G-1426G-A** (AX3000, WiFi 6 dual-band,
 * chipset Broadcom, firmware ALU/Nokia com extensões `X_ALU-COM_`/`X_ALU_`).
 *
 * NÍVEL DE PROVA — [LIVE] = confirmado no device real (dump GET com valores,
 * G-1426G-A SW 3TN00383HJKK99, base ZUX-PR 2026-07-24). O perfil nasceu de um
 * dump de GetParameterNames (nomes) cruzado com um dump GET COMPLETO (valores),
 * ambos ao vivo — unidades e mapa de banda CONFIRMADOS (não são mais [DOC]).
 *
 * ⚠️ INVARIANTES (do dump):
 *   - Raiz **TR-098** `InternetGatewayDevice.` (NÃO TR-181 `Device.`) — segue o
 *     padrão dos demais drivers, sem reescrever o normalizador do ACS.
 *   - Extensão vendor **`X_ALU-COM_`** (Alcatel-Lucent) — análogo a X_HW_
 *     (Huawei), X_ZTE-COM_, X_RTK_ (Parks).
 *   - **TEM óptico via TR-069** (diferente da Parks): `X_ALU_OntOpticalParam` é
 *     um objeto GLOBAL no topo do data model (NÃO fica sob WANDevice, ao
 *     contrário do X_GponInterafceConfig da Huawei) com RXPower/TXPower/
 *     TransceiverTemperature/SupplyVottage/BiasCurrent/Status. ⚠️ "SupplyVottage"
 *     tem o MESMO typo de fábrica da VSOL. UNIDADES [LIVE]: RX/TX em **dBm
 *     direto** (float, ex "-19.746941"), temp em **°C direto**, SupplyVottage em
 *     **VOLT direto** (3.289 — NÃO mV), BiasCurrent em **µA** (9000 = 9 mA).
 *     Normalização no ACS (ver diagnostics.ts). Bônus: expõe os thresholds de
 *     fábrica (RXPowerLower/Upper ≈ -27.96/-7.0, que batem com RX_THRESHOLDS).
 *   - **Wi-Fi NÃO popula métrica por cliente** [LIVE]: AssociatedDevice traz o
 *     MAC, mas RSSI/SignalStrength/SNR/TxRate vêm **ZERADOS** (=0) mesmo com
 *     clientes reais associados neste firmware — então a cobertura por cliente é
 *     null (como Parks/VSOL, NÃO como Huawei). O agregado TotalAssociations e a
 *     enumeração de MACs funcionam.
 *   - **CPU/memória TR-098 padrão vêm ZERADOS** [LIVE] (ProcessStatus.CPUUsage=0,
 *     MemoryStatus.Total/Free=0) — a Nokia não popula. Só a temperatura da placa
 *     (TemperatureSensor.1.Value) funciona. Por isso o diagnóstico NÃO pede
 *     CPU/mem (evita métrica falsa 0%); pede só a temperatura.
 *   - PPPoE de internet na **WANConnectionDevice.1 / WANPPPConnection.1** (só
 *     existe UMA WANPPPConnection no dump — mais simples que Huawei/Parks).
 *   - VLAN 802.1Q da WAN GPON em `X_CT-COM_WANGponLinkConfig.VLANIDMark`
 *     (gravável) na WCD 1 — herança do stack GPON. O link config Gpon é o real;
 *     Ethernet/PTM/DSL no dump são presets vestigiais.
 *   - Recursos são **TR-098 padrão** (ProcessStatus.CPUUsage + MemoryStatus.
 *     Total/Free + TemperatureStatus.TemperatureSensor.1.Value) — idênticos à
 *     Parks, SEM extensão X_ALU. TR-143 (Download/Upload/IPPing) existe.
 *   - 8 WLANConfiguration (radio dual-band): layout 1-4 = 2.4GHz, 5-8 = 5GHz
 *     (convenção Broadcom/Nokia — a MESMA da Parks 6xx e do Huawei). SSID
 *     primário = WLAN 1 (2.4G) e WLAN 5 (5G). ⚠️ [DOC] — a atribuição exata de
 *     banda por índice ainda não foi confirmada ao vivo (o dump de
 *     GetParameterNames não traz Standard/SupportedFrequencyBands com valor);
 *     override por env se o probe divergir.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */

/** WAN de internet (PPPoE) — WANConnectionDevice.1 [LIVE] (única WANPPPConnection). */
export const NOKIA_PPPOE_WAN_INDEX = process.env.NOKIA_PPPOE_WAN_INDEX ?? '1';
const ppp = `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${NOKIA_PPPOE_WAN_INDEX}.WANPPPConnection.1`;

/**
 * VLAN 802.1Q da WAN GPON — extensão X_CT-COM na WANConnectionDevice (o link
 * config GPON, não a WANPPPConnection) [LIVE]. O preset da OLT já cria a WAN com
 * a VLAN; o ZTP reaplica por garantia (idempotente).
 */
export const NOKIA_PPPOE_VLAN_PATH =
  process.env.NOKIA_PPPOE_VLAN_PATH ??
  `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${NOKIA_PPPOE_WAN_INDEX}.X_CT-COM_WANGponLinkConfig.VLANIDMark`;

/**
 * Índice da WLANConfiguration por banda [DOC] — layout Broadcom/Nokia: 1-4 =
 * 2.4GHz, 5-8 = 5GHz (mesma convenção Huawei/Parks-6xx). SSID primário do
 * cliente = WLAN 1 (2.4G) e WLAN 5 (5G). ⚠️ Confirmar por Standard/
 * SupportedFrequencyBands no probe ao vivo; override por env se divergir.
 */
export const NOKIA_WLAN_INDEX = {
  '2.4G': parseInt(process.env.NOKIA_WLAN_24_INDEX ?? '1', 10),
  '5G': parseInt(process.env.NOKIA_WLAN_5G_INDEX ?? '5', 10),
} as const;

function wlan(band: '2.4G' | '5G'): string {
  return `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${NOKIA_WLAN_INDEX[band]}`;
}

/**
 * Paths de provisionamento (ZTP + troca de Wi-Fi). Senha Wi-Fi via
 * `KeyPassphrase` no NÍVEL DA WLAN [LIVE] (gravável) — como a Parks (NÃO o
 * PreSharedKey.1.PreSharedKey da Huawei, embora o data model Nokia exponha
 * ambos; KeyPassphrase é o canônico do WebUI).
 */
export function nokiaProvisioningPaths() {
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
    pppoeVlan: NOKIA_PPPOE_VLAN_PATH,
  } as const;
}

/** Segurança Wi-Fi — params padrão TR-098 (BeaconType=11i) [LIVE] (folhas no dump). */
export function nokiaWlanSecurityParams(
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
export function nokiaWlanPaths(band: '2.4G' | '5G') {
  const p = wlan(band);
  return {
    channel: `${p}.Channel`,
    autoChannel: `${p}.AutoChannelEnable`,
    txPower: `${p}.TransmitPower`, // % do máximo (TransmitPower/TransmitPowerSupported no dump)
  } as const;
}

/**
 * Canais válidos por banda. ⚠️ [DOC] — PossibleChannels não capturado no dump;
 * conjunto comum BR. Ajuste quando um GET confirmar.
 */
export const NOKIA_WIFI_CHANNELS: Record<'2.4G' | '5G', number[]> = {
  '2.4G': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  '5G': [36, 40, 44, 48, 52, 56, 60, 64, 149, 153, 157, 161],
};

// =============================================================================
// DIAGNÓSTICO — paths de leitura (GetParameterValues) p/ monitoramento proativo.
// A Nokia TEM óptico (X_ALU_OntOpticalParam, objeto global) e RSSI por cliente.
// =============================================================================

/**
 * Óptico do transceiver GPON — objeto GLOBAL `X_ALU_OntOpticalParam` [LIVE]
 * (não fica sob WANDevice). Unidades a normalizar no ACS. ⚠️ "SupplyVottage"
 * com o typo de fábrica (idêntico à VSOL).
 */
export const NOKIA_OPTICAL_PATHS = {
  rxPower: 'InternetGatewayDevice.X_ALU_OntOpticalParam.RXPower',
  txPower: 'InternetGatewayDevice.X_ALU_OntOpticalParam.TXPower',
  temperature: 'InternetGatewayDevice.X_ALU_OntOpticalParam.TransceiverTemperature',
  voltage: 'InternetGatewayDevice.X_ALU_OntOpticalParam.SupplyVottage',
  biasCurrent: 'InternetGatewayDevice.X_ALU_OntOpticalParam.BiasCurrent',
} as const;

/** Status do transceiver óptico (Up/Down) — alvo de notificação ATIVA. */
export const NOKIA_OPTICAL_STATUS_PATH =
  'InternetGatewayDevice.X_ALU_OntOpticalParam.Status';

/** WAN PPPoE — status/erro/uptime (padrão TR-098) [LIVE]. */
export const NOKIA_PPP_PATHS = {
  status: `${ppp}.ConnectionStatus`,
  lastError: `${ppp}.LastConnectionError`,
  uptime: `${ppp}.Uptime`,
} as const;

/** Contadores de bytes da WAN PPPoE (cumulativos) — base do throughput [LIVE]. */
export const NOKIA_WAN_STATS_PATHS = {
  rxBytes: `${ppp}.Stats.EthernetBytesReceived`,
  txBytes: `${ppp}.Stats.EthernetBytesSent`,
} as const;

/**
 * Recursos do CPE. ⚠️ [LIVE] CPU/memória TR-098 padrão vêm ZERADOS neste
 * firmware (ProcessStatus.CPUUsage=0, MemoryStatus.Total/Free=0) — a Nokia não
 * popula. Só a temperatura da placa funciona (=34°C observado). Pedimos SÓ a
 * temperatura pra não gravar métrica falsa de 0% CPU/mem.
 */
export const NOKIA_DEVICE_RESOURCE_PATHS = {
  deviceTemp: 'InternetGatewayDevice.DeviceInfo.TemperatureStatus.TemperatureSensor.1.Value',
} as const;

/** Diagnóstico Wi-Fi agregado por banda (padrão TR-098) [LIVE]. */
export function nokiaWifiDiagPaths() {
  const w24 = wlan('2.4G');
  const w50 = wlan('5G');
  return {
    clients24: `${w24}.TotalAssociations`,
    clients5: `${w50}.TotalAssociations`,
    channel24: `${w24}.Channel`,
    channel5: `${w50}.Channel`,
  } as const;
}

/**
 * Caminhos PARCIAIS (objeto, terminam em ".") da tabela de clientes Wi-Fi
 * associados por banda. ⚠️ O dump ao vivo mostrou que RSSI/SignalStrength/SNR/
 * TxRate por cliente vêm ZERADOS (só o MAC é útil) — a enumeração só rende a
 * lista de MACs. Mantida por completude (contagem/inventário), mas com valor
 * diagnóstico baixo. O comportamento de GET por subárvore ('.') na Nokia ainda
 * NÃO foi isolado ao vivo; se um firmware der fault atômico (como a Parks),
 * desligue com NOKIA_WIFI_CLIENTS_ENABLED=0 — o resto do diagnóstico segue.
 */
export function nokiaWifiAssocPaths() {
  return {
    assoc24: `${wlan('2.4G')}.AssociatedDevice.`,
    assoc5: `${wlan('5G')}.AssociatedDevice.`,
  } as const;
}

/** Caminho PARCIAL da tabela de hosts (dispositivos na LAN do cliente) [LIVE]. */
export const NOKIA_HOSTS_PATH = 'InternetGatewayDevice.LANDevice.1.Hosts.Host.';

const NOKIA_OPTICAL_ENABLED = (process.env.TR069_OPTICAL_ENABLED ?? '1') !== '0';
const NOKIA_PPP_DIAG_ENABLED = (process.env.TR069_PPP_ENABLED ?? '1') !== '0';
const NOKIA_WAN_STATS_ENABLED = (process.env.TR069_WAN_STATS_ENABLED ?? '1') !== '0';
const NOKIA_WIFI_CLIENTS_ENABLED = (process.env.TR069_WIFI_CLIENTS_ENABLED ?? '1') !== '0';
const NOKIA_HOSTS_ENABLED = (process.env.TR069_HOSTS_ENABLED ?? '1') !== '0';
const NOKIA_DEVICE_RESOURCES_ENABLED = (process.env.TR069_DEVICE_RESOURCES_ENABLED ?? '1') !== '0';

/**
 * Lista achatada de nomes para o GET de diagnóstico. Óptico + Wi-Fi agregado +
 * clientes (subárvore, só MACs) + hosts + temperatura da placa. Todos [LIVE].
 * NÃO pede CPU/mem TR-098 (vêm zerados neste firmware — ver
 * NOKIA_DEVICE_RESOURCE_PATHS).
 *
 * ⚠️ TR-069 é ATÔMICO no GET: se UM path não existir, o CPE devolve Fault 9005
 * no GET inteiro. Todos os paths aqui saíram do dump da G-1426G-A, mas se um
 * firmware diferente derrubar a coleta, desligue o bloco suspeito pelo env
 * (TR069_OPTICAL_ENABLED / TR069_WIFI_CLIENTS_ENABLED / ...).
 */
export function nokiaDiagnosticParamNames(): string[] {
  return [
    ...(NOKIA_OPTICAL_ENABLED
      ? [...Object.values(NOKIA_OPTICAL_PATHS), NOKIA_OPTICAL_STATUS_PATH]
      : []),
    ...(NOKIA_PPP_DIAG_ENABLED ? Object.values(NOKIA_PPP_PATHS) : []),
    ...(NOKIA_WAN_STATS_ENABLED ? Object.values(NOKIA_WAN_STATS_PATHS) : []),
    ...Object.values(nokiaWifiDiagPaths()),
    ...(NOKIA_WIFI_CLIENTS_ENABLED ? Object.values(nokiaWifiAssocPaths()) : []),
    ...(NOKIA_HOSTS_ENABLED ? [NOKIA_HOSTS_PATH] : []),
    ...(NOKIA_DEVICE_RESOURCES_ENABLED ? Object.values(NOKIA_DEVICE_RESOURCE_PATHS) : []),
  ];
}

/**
 * Atributos de notificação a armar (SetParameterAttributes):
 *   - Status óptico → ATIVA (2): o CPE avisa quando o enlace GPON muda.
 *   - Níveis ópticos → PASSIVA (1): vão de carona no Inform periódico, então
 *     lemos óptico sem GET_PARAMS (sem risco de fault atômico) — como a Huawei.
 *   - WAN PPPoE → ATIVA (2): avisa quando a internet cai.
 * Se o firmware recusar o ARME (fault), a task falha e o polling proativo segue
 * como fallback — sem regressão.
 */
export function nokiaNotificationAttributes(): Array<{ name: string; notification: 0 | 1 | 2 }> {
  return [
    { name: NOKIA_OPTICAL_STATUS_PATH, notification: 2 },
    { name: NOKIA_PPP_PATHS.status, notification: 2 },
    { name: NOKIA_OPTICAL_PATHS.rxPower, notification: 1 },
    { name: NOKIA_OPTICAL_PATHS.txPower, notification: 1 },
    { name: NOKIA_OPTICAL_PATHS.temperature, notification: 1 },
    { name: NOKIA_OPTICAL_PATHS.voltage, notification: 1 },
    { name: NOKIA_OPTICAL_PATHS.biasCurrent, notification: 1 },
  ];
}

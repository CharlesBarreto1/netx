/**
 * Data model paths Huawei EG8145V5/X10 (Customized HGW DataModel).
 *
 * Extraído pra arquivo standalone — pode ser importado pelo
 * Tr069TasksService (provisioning) e pelo ContractsService (mudança de
 * Wi-Fi pós-instalação) sem criar dep circular entre módulos.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import {
  widthCodeFor,
  type HuaweiWifiCapability,
  type WifiOptMode,
  type WifiOptProfile,
} from './wifi-opt.resolver';

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
  // ⚠️ Segurança Wi-Fi NÃO é X_HW_SecurityMode (esse param não existe no
  // firmware do EG8145X6 — dava fault). É BeaconType + IEEE11i*/WPA* — ver
  // huaweiWlanSecurityParams() abaixo. Confirmado por probe ao vivo (jun/2026).
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
  // IP Acquisition Mode da WAN IPv6 (dropdown do WebUI). DEVE ser
  // "AutoConfigured" (Automatic). O preset de fábrica/Ufinet às vezes deixa
  // "DHCPv6", e nesse modo a entrega de IPv6 ao cliente quebra. ⚠️ Só aplica
  // após REBOOT (o Huawei responde Status=1 = "aplico no próximo boot").
  // Confirmado por probe de data model em ONT certa vs errada (jun/2026).
  ipv6AddrOrigin: `${pppPrefix}.X_HW_IPv6.IPv6Address.1.Origin`,
} as const;

/** Valor correto do IP Acquisition Mode IPv6 (Automatic — não DHCPv6). */
export const HUAWEI_IPV6_ADDR_ORIGIN = 'AutoConfigured';

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
// Edição de rádio Wi-Fi (canal/potência/criptografia) — SET direto no CPE.
// Paths/domínios confirmados por probe ao vivo no EG8145X6 (jun/2026).
// =============================================================================
export type HuaweiWifiBand = '2.4G' | '5G';
export type HuaweiWifiSecurity = 'WPA2' | 'WPA_WPA2';
export type HuaweiWifiWidth = 'auto' | '20' | '40' | '80' | '160';

/**
 * Largura de canal → valor do enum vendor `X_HW_HT20`. Mapeado por SET-probe ao
 * vivo no EG8145X6 (jun/2026): 0=Auto, 1=20, 2=40, 3=80, 4=160MHz.
 */
export const HUAWEI_WIFI_WIDTH_CODE: Record<HuaweiWifiWidth, string> = {
  auto: '0',
  '20': '1',
  '40': '2',
  '80': '3',
  '160': '4',
};

/** Larguras suportadas por banda (2.4G não faz 80/160). */
export const HUAWEI_WIFI_WIDTHS: Record<HuaweiWifiBand, HuaweiWifiWidth[]> = {
  '2.4G': ['auto', '20', '40'],
  '5G': ['auto', '20', '40', '80', '160'],
};

/** Índice da WLANConfiguration por banda (1=2.4G/ath0, 5=5G/ath4). */
export const HUAWEI_WLAN_INDEX: Record<HuaweiWifiBand, number> = { '2.4G': 1, '5G': 5 };

/** Potências aceitas (%) — TransmitPowerSupported. */
export const HUAWEI_TX_POWER_LEVELS = [20, 40, 60, 80, 100] as const;

/** Canais válidos por banda (PossibleChannels do EG8145X6, regdomain PY). */
export const HUAWEI_WIFI_CHANNELS: Record<HuaweiWifiBand, number[]> = {
  '2.4G': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  '5G': [
    36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140,
    144, 149, 153, 157, 161,
  ],
};

/** Monta os paths de uma WLANConfiguration por banda. */
export function huaweiWlanPaths(band: HuaweiWifiBand) {
  const p = `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${HUAWEI_WLAN_INDEX[band]}`;
  return {
    channel: `${p}.Channel`,
    autoChannel: `${p}.AutoChannelEnable`,
    txPower: `${p}.TransmitPower`,
    beaconType: `${p}.BeaconType`,
    ieee11iAuth: `${p}.IEEE11iAuthenticationMode`,
    ieee11iEnc: `${p}.IEEE11iEncryptionModes`,
    wpaAndIiAuth: `${p}.X_HW_WPAand11iAuthenticationMode`,
    wpaAndIiEnc: `${p}.X_HW_WPAand11iEncryptionModes`,
    // Largura (enum vendor X_HW_HT20) — enum ainda não mapeado; expor depois.
    htMode: `${p}.X_HW_HT20`,
  } as const;
}

// =============================================================================
// Toggles do roteador (TimeZone + BandSteering) — SET direto no CPE.
// Paths confirmados por probe ao vivo no EG8145X6 (jun/2026). UPnP e EasyMesh
// NÃO são expostos via TR-069 nesse firmware (2 rodadas de probe deram fault).
// =============================================================================
export const HUAWEI_ROUTER_PATHS = {
  timeEnable: 'InternetGatewayDevice.Time.Enable',
  timeZoneOffset: 'InternetGatewayDevice.Time.LocalTimeZone',
  timeZoneName: 'InternetGatewayDevice.Time.LocalTimeZoneName',
  ntpServer1: 'InternetGatewayDevice.Time.NTPServer1',
  // BandSteering: BandSteeringPolicy dobra como liga/desliga (0=off, 1=on);
  // BandSteeringCapability (read) indica suporte.
  bandSteeringPolicy:
    'InternetGatewayDevice.LANDevice.1.WiFi.X_HW_GlobalConfig.BandSteeringPolicy',
} as const;

/**
 * Params de criptografia (SET) por modo. Só WPA2 ou WPA/WPA2 misto — nunca
 * abrir a rede (None/WEP). Confirmado: BeaconType=11i (WPA2) ou WPAand11i
 * (misto) + os modos de auth/encryption correspondentes.
 */
export function huaweiWlanSecurityParams(
  band: HuaweiWifiBand,
  security: HuaweiWifiSecurity,
): Array<{ name: string; value: string; type: string }> {
  const w = huaweiWlanPaths(band);
  if (security === 'WPA2') {
    return [
      { name: w.beaconType, value: '11i', type: 'xsd:string' },
      { name: w.ieee11iAuth, value: 'PSKAuthentication', type: 'xsd:string' },
      { name: w.ieee11iEnc, value: 'AESEncryption', type: 'xsd:string' },
    ];
  }
  // WPA/WPA2 misto (TKIP+AES) — compatibilidade com dispositivos antigos.
  return [
    { name: w.beaconType, value: 'WPAand11i', type: 'xsd:string' },
    { name: w.wpaAndIiAuth, value: 'PSKAuthentication', type: 'xsd:string' },
    { name: w.wpaAndIiEnc, value: 'TKIPandAESEncryption', type: 'xsd:string' },
  ];
}

// =============================================================================
// WIFI-OPT — pacote de otimização Wi-Fi (bootstrap/plan-change/rollout).
// Decisões de capability/profile/largura em wifi-opt.resolver.ts (puro);
// aqui só a MONTAGEM dos params TR-069. Enum X_HW_HT20 confirmado ao vivo
// (jul/2026, persistente pós-reboot): 0=Auto(→negocia só 40MHz na prática),
// 3=80MHz, 4=160MHz — por isso o pacote fixa '3'/'4' e NUNCA manda '0'.
// =============================================================================

/**
 * Potência TX global (%) — variante X6/X10/V5-V2 (um param cobre as 2 bandas).
 * No V5 plain o nó não existe: usar TransmitPower por WLAN (huaweiWlanTxpower).
 */
export const HUAWEI_TXPOWER_GLOBAL =
  'InternetGatewayDevice.LANDevice.1.WiFi.X_HW_Txpower';

/** TransmitPower (%) por índice de WLAN — variante V5 plain (1=2.4G, 5=5G). */
export function huaweiWlanTxpower(i: number): string {
  return `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${i}.TransmitPower`;
}

/**
 * Economia de energia do rádio (APM) — o pacote DESLIGA (0) pra potência
 * plena valer 24/7. Nó de RAIZ do data model (NÃO fica sob LANDevice.1.WiFi):
 * confirmado por root-walk de 3985 params no EG8145X6 e por SET com Status 0
 * no EG8145V5 (probe ao vivo, jul/2026).
 */
export const HUAWEI_APM_POWER_SAVING =
  'InternetGatewayDevice.X_HW_APMPolicy.EnablePowerSavingMode';

/**
 * Domínio regulatório por WLAN (gravável e persistente — confirmado ao vivo,
 * jul/2026). Aplicar nas DUAS WLANs (1=2.4G, 5=5G).
 */
export function huaweiRegDomain(i: number): string {
  return `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${i}.RegulatoryDomain`;
}

/**
 * ⚠️ READ-ONLY (fault 9003 no SET nos dois tipos de ONT — confirmado ao vivo,
 * jul/2026): indica se o firmware suporta band steering. Entra SÓ no readback,
 * NUNCA num SetParameterValues (o liga/desliga é o BandSteeringPolicy).
 */
export const HUAWEI_BAND_STEERING_CAPABILITY =
  'InternetGatewayDevice.LANDevice.1.WiFi.X_HW_GlobalConfig.BandSteeringCapability';

export interface HuaweiWifiOptParamsInput {
  /** Capability do modelo (nunca null aqui — o caller já fez o gate de skip). */
  cap: HuaweiWifiCapability;
  profile: WifiOptProfile;
  /** Domínio regulatório do tenant (Tr069TenantConfig.wifiOptRegDomain). */
  regDomain: string;
  /** SSID do contrato — a 5G recebe o MESMO nome (band steering unificado). */
  ssid: string;
  /** PSK do contrato — só no FULL (WIDTH_ONLY/rollback nunca carregam senha). */
  psk: string;
  mode: WifiOptMode;
}

/**
 * Monta o SetParameterValues do pacote de otimização:
 *   FULL       — txpower=100 (na variante da cap) + APM off + RegDomain nas 2
 *                WLANs + SSID/PSK da 5G (unificado) + BandSteeringPolicy=1 +
 *                largura fixa (X_HW_HT20).
 *   WIDTH_ONLY — só X_HW_HT20 (mudança de plano; não re-escreve SSID/PSK).
 * Largura sai do widthCodeFor — se null (modelo sem nó HT20), o param é
 * omitido; em WIDTH_ONLY isso resulta em lista VAZIA e o caller não cria task.
 */
export function huaweiWifiOptParams(
  input: HuaweiWifiOptParamsInput,
): Array<{ name: string; value: string; type: string }> {
  const { cap, profile, regDomain, ssid, psk, mode } = input;
  const w5 = huaweiWlanPaths('5G');

  const width = widthCodeFor(profile, cap);
  const widthParams =
    width === null
      ? []
      : [{ name: w5.htMode, value: width, type: 'xsd:unsignedInt' }];
  if (mode === 'WIDTH_ONLY') return widthParams;

  return [
    // Potência plena — variante por capability (global vs por WLAN).
    ...(cap.txpower === 'X_HW_TXPOWER'
      ? [{ name: HUAWEI_TXPOWER_GLOBAL, value: '100', type: 'xsd:unsignedInt' }]
      : [
          { name: huaweiWlanTxpower(1), value: '100', type: 'xsd:unsignedInt' },
          { name: huaweiWlanTxpower(5), value: '100', type: 'xsd:unsignedInt' },
        ]),
    // Economia de energia OFF (senão a potência cai sozinha fora de pico).
    { name: HUAWEI_APM_POWER_SAVING, value: '0', type: 'xsd:boolean' },
    // Domínio regulatório nas duas WLANs (canais/potências legais corretos).
    { name: huaweiRegDomain(1), value: regDomain, type: 'xsd:string' },
    { name: huaweiRegDomain(5), value: regDomain, type: 'xsd:string' },
    // SSID unificado (5G = mesmo nome da 2.4G) + PSK — pré-requisito do band
    // steering. O caller flipa Ont.wifiBandMode='BAND_STEERING' junto.
    { name: HUAWEI_EG8145_PATHS.ssid50, value: ssid, type: 'xsd:string' },
    { name: HUAWEI_EG8145_PATHS.pwd50, value: psk, type: 'xsd:string' },
    // Band steering ON (Capability é read-only — NUNCA setar).
    {
      name: HUAWEI_ROUTER_PATHS.bandSteeringPolicy,
      value: '1',
      type: 'xsd:unsignedInt',
    },
    ...widthParams,
  ];
}

/**
 * Nomes pro GET de baseline ("previous", insumo do rollback) e de verificação
 * pós-push. Espelha o que o SET escreve (MENOS a PSK — write-only) + a
 * capability de band steering. Variantes seguem a cap pra não pedir path
 * inexistente (fault 9005 atômico).
 */
export function huaweiWifiOptReadbackNames(cap: HuaweiWifiCapability): string[] {
  return [
    HUAWEI_EG8145_PATHS.ssid50,
    HUAWEI_ROUTER_PATHS.bandSteeringPolicy,
    HUAWEI_BAND_STEERING_CAPABILITY,
    ...(cap.ht20 ? [huaweiWlanPaths('5G').htMode] : []),
    huaweiRegDomain(1),
    huaweiRegDomain(5),
    HUAWEI_APM_POWER_SAVING,
    ...(cap.txpower === 'X_HW_TXPOWER'
      ? [HUAWEI_TXPOWER_GLOBAL]
      : [huaweiWlanTxpower(1), huaweiWlanTxpower(5)]),
  ];
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

/**
 * Contadores de bytes da WAN PPPoE (cumulativos) — base do throughput WAN.
 * Params padrão TR-098 (.Stats) na conexão de internet. A vazão é calculada
 * pelo delta entre duas leituras da série de diagnóstico.
 */
export const HUAWEI_WAN_STATS_PATHS = {
  rxBytes: `${pppPrefix}.Stats.EthernetBytesReceived`,
  txBytes: `${pppPrefix}.Stats.EthernetBytesSent`,
} as const;

/** Habilita a coleta dos contadores de bytes da WAN (throughput). */
export const HUAWEI_WAN_STATS_ENABLED = (process.env.TR069_WAN_STATS_ENABLED ?? '1') !== '0';

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

/**
 * Recursos do CPE (DeviceInfo) — % CPU, % memória e temperatura da placa.
 * Params escalares (NÃO pedir a tabela ProcessStatus.Process inteira). Confirmados
 * ao vivo no EG8145X6. Desligue com TR069_DEVICE_RESOURCES_ENABLED=0 se algum
 * firmware der fault.
 */
export const HUAWEI_DEVICE_RESOURCE_PATHS = {
  cpuUsed: 'InternetGatewayDevice.DeviceInfo.X_HW_CpuUsed',
  memUsed: 'InternetGatewayDevice.DeviceInfo.X_HW_MemUsed',
  deviceTemp: 'InternetGatewayDevice.DeviceInfo.TemperatureStatus.TemperatureSensor.1.Value',
} as const;

/** Habilita a coleta de recursos do CPE (CPU/mem/temp) no diagnóstico. */
export const HUAWEI_DEVICE_RESOURCES_ENABLED =
  (process.env.TR069_DEVICE_RESOURCES_ENABLED ?? '1') !== '0';

/**
 * Scan de vizinhança Wi-Fi (NeighboringWiFiDiagnostic) — base do heatmap de
 * ocupação de canais. É um diagnóstico a pedido: seta DiagnosticsState=Requested
 * e depois lê a subárvore Result.{i}. Confirmado ao vivo no EG8145X6.
 */
export const HUAWEI_WIFI_SCAN = {
  state: 'InternetGatewayDevice.LANDevice.1.WiFi.NeighboringWiFiDiagnostic.DiagnosticsState',
  subtree: 'InternetGatewayDevice.LANDevice.1.WiFi.NeighboringWiFiDiagnostic.',
} as const;

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
export function huaweiDiagnosticParamNames(productClass?: string | null): string[] {
  // ⚠️ O sensor de temperatura (TemperatureStatus.TemperatureSensor.1) só
  // existe nos EG8145X6/X10. Nos V5/V5-V2 o nó não existe e — como o GET
  // Huawei é ATÔMICO — esse único path derrubava o diagnóstico INTEIRO da
  // família V5 (fault 9005; telemetria cega de jun→jul/2026, isolado por
  // probe ao vivo em 2026-07-11). productClass desconhecido → exclui
  // (fail-safe: perder só a temperatura, nunca a coleta toda).
  const pc = (productClass ?? '').toUpperCase();
  const hasTempSensor = pc.includes('X6') || pc.includes('X10');
  return [
    ...Object.values(HUAWEI_OPTICAL_PATHS),
    HUAWEI_GPON_STATUS_PATH,
    ...Object.values(HUAWEI_GPON_STATS_PATHS),
    ...(HUAWEI_PPP_DIAG_ENABLED ? Object.values(HUAWEI_PPP_PATHS) : []),
    ...(HUAWEI_WAN_STATS_ENABLED ? Object.values(HUAWEI_WAN_STATS_PATHS) : []),
    ...Object.values(HUAWEI_WIFI_DIAG_PATHS),
    ...(HUAWEI_WIFI_CLIENTS_ENABLED ? Object.values(HUAWEI_WIFI_ASSOC_PATHS) : []),
    ...(HUAWEI_HOSTS_ENABLED ? [HUAWEI_HOSTS_PATH] : []),
    ...(HUAWEI_DEVICE_RESOURCES_ENABLED
      ? [
          HUAWEI_DEVICE_RESOURCE_PATHS.cpuUsed,
          HUAWEI_DEVICE_RESOURCE_PATHS.memUsed,
          ...(hasTempSensor ? [HUAWEI_DEVICE_RESOURCE_PATHS.deviceTemp] : []),
        ]
      : []),
  ];
}

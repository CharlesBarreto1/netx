/**
 * Data model paths Zyxel PX3321-T1 (AX3000 WiFi 6 GPON ONT, raiz TR-098
 * `InternetGatewayDevice.`). Coletados por probe de path parcial ao vivo
 * (jun/2026) — dump completo de 3752 params. Firmware V5.44(ACHK.4)b3, OUI
 * 143375. Espelha a estrutura de tr069-paths.huawei.ts; consumido via
 * tr069-paths.registry.ts (resolver por fabricante).
 *
 * Diferenças-chave vs Huawei:
 *   - PPPoE de internet em WANDevice.1.WANConnectionDevice.1 (não WAN 2).
 *   - WLAN 1=2.4GHz, 5=5GHz (mesma convenção 1/5 do Huawei).
 *   - Senha Wi-Fi é PreSharedKey.1.KeyPassphrase (não PreSharedKey).
 *   - VLAN PPPoE em X_ZYXEL_VlanMuxID (vendor).
 *   - Níveis ópticos já vêm em unidade humana (dBm/°C/V) — sem normalização.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */

/** Prefixo da WANPPPConnection de internet (PPPoE). WAN 1 na Zyxel PX3321. */
const pppPrefix =
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1';

/** Índice da WLANConfiguration por banda (1=2.4G/ra0, 5=5G/rai0). */
export const ZYXEL_WLAN_INDEX = { '2.4G': 1, '5G': 5 } as const;
const WLAN_24 = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1';
const WLAN_50 = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5';

export const ZYXEL_PX3321_PATHS = {
  // ── Wi-Fi (sistema é dono) ───────────────────────────────────────────────
  ssid24: `${WLAN_24}.SSID`,
  ssid50: `${WLAN_50}.SSID`,
  // Senha: KeyPassphrase é o campo gravável (PreSharedKey é o hex derivado).
  pwd24: `${WLAN_24}.PreSharedKey.1.KeyPassphrase`,
  pwd50: `${WLAN_50}.PreSharedKey.1.KeyPassphrase`,

  // ── ManagementServer (servidor TR-069 + periodic inform) ─────────────────
  acsUrl: 'InternetGatewayDevice.ManagementServer.URL',
  informEnable: 'InternetGatewayDevice.ManagementServer.PeriodicInformEnable',
  informInterval: 'InternetGatewayDevice.ManagementServer.PeriodicInformInterval',
  connReqUsername: 'InternetGatewayDevice.ManagementServer.ConnectionRequestUsername',
  connReqPassword: 'InternetGatewayDevice.ManagementServer.ConnectionRequestPassword',

  // ── WAN PPPoE (internet) ─────────────────────────────────────────────────
  pppoeUsername: `${pppPrefix}.Username`,
  pppoePassword: `${pppPrefix}.Password`,
  pppoeEnable: `${pppPrefix}.Enable`,
  pppoeConnectionType: `${pppPrefix}.ConnectionType`,
  // VLAN 802.1Q da WAN PPPoE — extensão vendor Zyxel.
  pppoeVlan: `${pppPrefix}.X_ZYXEL_VlanMuxID`,
  pppoeVlanEnable: `${pppPrefix}.X_ZYXEL_VlanEnable`,

  // ── Senha de acesso (contas de login) ────────────────────────────────────
  // root = CLI/SSH; supervisor = web/admin (httpd); admin = web. Write-only:
  // o GET devolve vazio (não dá fault). SET confirmado ao vivo (jun/2026).
  accessPwdRoot: 'InternetGatewayDevice.X_ZYXEL_EXT.LoginCfg.LogGp.1.Account.1.Password',
  accessPwdSupervisor: 'InternetGatewayDevice.X_ZYXEL_EXT.LoginCfg.LogGp.1.Account.2.Password',
  accessPwdAdmin: 'InternetGatewayDevice.X_ZYXEL_EXT.LoginCfg.LogGp.2.Account.1.Password',

  // ── Gerência remota (acesso remoto + porta) ──────────────────────────────
  // Service.1=HTTP, 2=HTTPS. Mode LAN_WAN libera WAN (remoto); LAN_ONLY bloqueia.
  remoteHttpEnable: 'InternetGatewayDevice.X_ZYXEL_EXT.RemoteManagement.Service.1.Enable',
  remoteHttpMode: 'InternetGatewayDevice.X_ZYXEL_EXT.RemoteManagement.Service.1.Mode',
  remoteHttpPort: 'InternetGatewayDevice.X_ZYXEL_EXT.RemoteManagement.Service.1.Port',
  remoteHttpsEnable: 'InternetGatewayDevice.X_ZYXEL_EXT.RemoteManagement.Service.2.Enable',
  remoteHttpsMode: 'InternetGatewayDevice.X_ZYXEL_EXT.RemoteManagement.Service.2.Mode',
  remoteHttpsPort: 'InternetGatewayDevice.X_ZYXEL_EXT.RemoteManagement.Service.2.Port',
} as const;

/** Mapa das contas de login → path da senha (pra config por instância). */
export const ZYXEL_ACCESS_PASSWORD_PATHS: Record<string, string> = {
  root: ZYXEL_PX3321_PATHS.accessPwdRoot,
  supervisor: ZYXEL_PX3321_PATHS.accessPwdSupervisor,
  admin: ZYXEL_PX3321_PATHS.accessPwdAdmin,
};

/** Segurança Wi-Fi padrão de fábrica da PX3321: WPA2-PSK/AES (BeaconType 11i). */
export function zyxelWlanSecurityParams(
  band: '2.4G' | '5G',
): Array<{ name: string; value: string; type: string }> {
  const p = `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${ZYXEL_WLAN_INDEX[band]}`;
  return [
    { name: `${p}.BeaconType`, value: '11i', type: 'xsd:string' },
    { name: `${p}.IEEE11iAuthenticationMode`, value: 'PSKAuthentication', type: 'xsd:string' },
    { name: `${p}.IEEE11iEncryptionModes`, value: 'AESEncryption', type: 'xsd:string' },
  ];
}

// =============================================================================
// DIAGNÓSTICO — paths de leitura (GetParameterValues). Os níveis ópticos da
// Zyxel JÁ vêm em unidade humana (dBm/°C/V); o parser do ACS não normaliza.
// =============================================================================

/**
 * Níveis ópticos do transceiver GPON. Em InternetGatewayDevice.X_ZYXEL_EXT.
 * Optical.* — valores já em dBm/°C/V (ex.: rxPower=-21.87, txPower=2.28,
 * temperature=43.68, voltage=3.27). Sem biasCurrent neste firmware.
 */
export const ZYXEL_OPTICAL_PATHS = {
  rxPower: 'InternetGatewayDevice.X_ZYXEL_EXT.Optical.rxPower',
  txPower: 'InternetGatewayDevice.X_ZYXEL_EXT.Optical.txPower',
  temperature: 'InternetGatewayDevice.X_ZYXEL_EXT.Optical.temperature',
  voltage: 'InternetGatewayDevice.X_ZYXEL_EXT.Optical.voltage',
} as const;

/** Diagnóstico da WAN PPPoE (paths padrão TR-098). */
export const ZYXEL_PPP_PATHS = {
  status: `${pppPrefix}.ConnectionStatus`,
  lastError: `${pppPrefix}.LastConnectionError`,
  uptime: `${pppPrefix}.Uptime`,
} as const;

/** Contadores de bytes da WAN PPPoE (cumulativos) — base do throughput. */
export const ZYXEL_WAN_STATS_PATHS = {
  rxBytes: `${pppPrefix}.Stats.EthernetBytesReceived`,
  txBytes: `${pppPrefix}.Stats.EthernetBytesSent`,
} as const;

/** Diagnóstico Wi-Fi agregado por banda. */
export const ZYXEL_WIFI_DIAG_PATHS = {
  clients24: `${WLAN_24}.TotalAssociations`,
  clients5: `${WLAN_50}.TotalAssociations`,
} as const;

/** Recursos do CPE (DeviceInfo) — params escalares padrão TR-098. */
export const ZYXEL_DEVICE_RESOURCE_PATHS = {
  cpuUsed: 'InternetGatewayDevice.DeviceInfo.ProcessStatus.CPUUsage',
  memTotal: 'InternetGatewayDevice.DeviceInfo.MemoryStatus.Total',
  memFree: 'InternetGatewayDevice.DeviceInfo.MemoryStatus.Free',
} as const;

/** Lista achatada de nomes de parâmetro para o GET de diagnóstico. */
export function zyxelDiagnosticParamNames(): string[] {
  return [
    ...Object.values(ZYXEL_OPTICAL_PATHS),
    ...Object.values(ZYXEL_PPP_PATHS),
    ...Object.values(ZYXEL_WAN_STATS_PATHS),
    ...Object.values(ZYXEL_WIFI_DIAG_PATHS),
    ...Object.values(ZYXEL_DEVICE_RESOURCE_PATHS),
  ];
}

/**
 * Atributos de notificação a armar (SetParameterAttributes): níveis ópticos
 * PASSIVOS (1) — vão de carona no Inform periódico, sem GET dedicado.
 */
export function zyxelNotificationAttributes(): Array<{ name: string; notification: 0 | 1 | 2 }> {
  return [
    { name: ZYXEL_OPTICAL_PATHS.rxPower, notification: 1 },
    { name: ZYXEL_OPTICAL_PATHS.txPower, notification: 1 },
    { name: ZYXEL_OPTICAL_PATHS.temperature, notification: 1 },
    { name: ZYXEL_OPTICAL_PATHS.voltage, notification: 1 },
  ];
}

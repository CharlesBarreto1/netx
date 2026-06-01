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

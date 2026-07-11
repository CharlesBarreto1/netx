/**
 * WiFi-Opt — resolução PURA de capability/profile/largura (sem NestJS).
 *
 * Decide O QUE o pacote de otimização Wi-Fi aplica em cada ONT Huawei a partir
 * de dois insumos: a velocidade contratada (`Contract.bandwidthMbps` — o mesmo
 * valor que o RADIUS entrega) e a capability do modelo (productClass reportado
 * no Inform). A montagem dos parâmetros TR-069 em si mora em
 * tr069-paths.huawei.ts (`huaweiWifiOptParams`), que consome estas funções.
 *
 * Regras (validadas por probe ao vivo, jul/2026):
 *   - GIGA (>800 Mbps) exige rádio AX → largura FIXA 160 MHz (X_HW_HT20='4').
 *   - BASE fixa 80 MHz ('3') TANTO em AX quanto em AC — descobrimos que
 *     HT20=0 (auto) negocia só 40 MHz na prática, então '0' NUNCA entra no
 *     pacote (o design original previa '0' pra AC; corrigido empiricamente).
 *   - Capability desconhecida (productClass não mapeado ou null) → null =
 *     SKIP integral: o fault 9005 do Huawei é atômico e derruba o SET inteiro,
 *     então não arriscamos params em modelo não sondado.
 *   - Modelo sem o nó X_HW_HT20 → não tocar largura (só o resto do pacote).
 *
 * Enum X_HW_HT20 confirmado ao vivo (persistente pós-reboot): 0=Auto(→40MHz
 * observado), 3=80MHz, 4=160MHz. RegulatoryDomain é gravável e persistente.
 */

/** Perfil do pacote — denormalizado em Tr069Device.wifiOptProfile. */
export type WifiOptProfile = 'BASE' | 'GIGA';

/** Modo de aplicação: pacote completo vs só largura (mudança de plano). */
export type WifiOptMode = 'FULL' | 'WIDTH_ONLY';

/**
 * Variante do ajuste de potência TX por família de firmware:
 *   X_HW_TXPOWER        — global (LANDevice.1.WiFi.X_HW_Txpower) — X6/X10/V5-V2
 *   WLAN_TRANSMIT_POWER — TransmitPower por WLANConfiguration — V5 plain
 */
export type HuaweiTxpowerVariant = 'X_HW_TXPOWER' | 'WLAN_TRANSMIT_POWER';

/** O que o modelo/firmware suporta — insumo de TODAS as decisões do pacote. */
export interface HuaweiWifiCapability {
  /** Rádio Wi-Fi 6 (802.11ax) — pré-requisito de 160 MHz e do profile GIGA. */
  ax: boolean;
  /** Onde vive o ajuste de potência TX (ver HuaweiTxpowerVariant). */
  txpower: HuaweiTxpowerVariant;
  /** Teto do enum X_HW_HT20 ('4'=160MHz, '3'=80MHz). */
  maxWidthCode: '3' | '4';
  /** Nó X_HW_HT20 existe no data model (false → não tocar largura). */
  ht20: boolean;
}

/** Acima disso (e com rádio AX) o contrato ganha o profile GIGA. */
export const GIGA_THRESHOLD_MBPS = 800;

/**
 * Capability por modelo Huawei. Matcher por substring do productClass
 * (case-insensitive), no espírito do vendorFor() do registry. `softwareVersion`
 * fica reservado pra futuras capabilities condicionadas a firmware — hoje
 * nenhuma regra depende dele.
 *
 * Desconhecido/null → null = SKIP (nunca chutar params em modelo não sondado).
 */
export function huaweiWifiCapabilityFor(
  productClass?: string | null,
  _softwareVersion?: string | null,
): HuaweiWifiCapability | null {
  const pc = (productClass ?? '').toUpperCase();
  if (!pc) return null;
  // EG8145X6 / EG8145X10 — Wi-Fi 6, Txpower global, 160 MHz.
  if (pc.includes('X6') || pc.includes('X10')) {
    return { ax: true, txpower: 'X_HW_TXPOWER', maxWidthCode: '4', ht20: true };
  }
  // EG8145V5-V2 — Wi-Fi 5, mas firmware novo com Txpower global.
  if (pc.includes('V5-V2')) {
    return { ax: false, txpower: 'X_HW_TXPOWER', maxWidthCode: '3', ht20: true };
  }
  // EG8145V5 plain — Wi-Fi 5, TransmitPower por WLAN.
  if (pc.includes('V5')) {
    return { ax: false, txpower: 'WLAN_TRANSMIT_POWER', maxWidthCode: '3', ht20: true };
  }
  return null;
}

/**
 * Profile a partir da velocidade REAL do contrato (bandwidthMbps — o valor que
 * o RADIUS aplica). GIGA exige >800 Mbps E rádio AX; V5/desconhecido caem em
 * BASE por construção (nunca prometem 160 MHz).
 */
export function resolveWifiOptProfile(
  bandwidthMbps: number | null | undefined,
  cap: HuaweiWifiCapability | null,
): WifiOptProfile {
  return (bandwidthMbps ?? 0) > GIGA_THRESHOLD_MBPS && cap?.ax === true ? 'GIGA' : 'BASE';
}

/**
 * Código do enum X_HW_HT20 pro profile: GIGA→'4' (160 fixo), BASE→'3' (80
 * fixo, AX E AC — auto '0' negocia só 40 MHz na prática e NUNCA entra).
 * null = não tocar largura (capability desconhecida ou modelo sem o nó HT20).
 */
export function widthCodeFor(
  profile: WifiOptProfile,
  cap: HuaweiWifiCapability | null,
): '3' | '4' | null {
  if (!cap || !cap.ht20) return null;
  return profile === 'GIGA' ? '4' : '3';
}

/**
 * Canal 5 GHz sujeito a DFS (radar) — bandas UNII-2/UNII-2e, canais 52..144.
 * Usado pra anotar o evento TR069_CHANNEL_SWITCH (device GIGA mudou de canal).
 */
export function isDfsChannel(channel: number): boolean {
  return channel >= 52 && channel <= 144;
}

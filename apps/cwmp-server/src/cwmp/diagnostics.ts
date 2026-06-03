/**
 * Extração e normalização de diagnóstico a partir de um GetParameterValuesResponse.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * O core-service enfileira um GET_PARAMS de diagnóstico (níveis ópticos +
 * Wi-Fi). Quando o CPE responde, transformamos a ParameterList num conjunto
 * de métricas tipadas + classificação de saúde óptica. Os LIMIARES aqui são
 * uma CÓPIA dos canônicos em @netx/shared (tr069.dto.ts) — o ACS não depende
 * de @netx/shared pra evitar acoplamento; manter os dois em sincronia.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */

// Mesmo env do core-service (tr069-paths.huawei.ts) — os dois lados precisam
// concordar no prefixo da interface óptica.
// ⚠️ Objeto com o erro de digitação de fábrica da Huawei ("Inter**af**ce") —
// confirmado ao vivo no firmware HW_WAP_CWMP_V02 (EG8145V5/X10). Mesmo default
// do core-service (tr069-paths.huawei.ts); os dois lados precisam concordar.
const GPON_IFACE =
  process.env.HUAWEI_GPON_IFACE_PATH ??
  'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig';

const WLAN_24 = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1';
const WLAN_50 = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5';

const OPTICAL_PATHS = {
  rxPower: `${GPON_IFACE}.RXPower`,
  txPower: `${GPON_IFACE}.TXPower`,
  temperature: `${GPON_IFACE}.TransceiverTemperature`,
  voltage: `${GPON_IFACE}.SupplyVoltage`,
  biasCurrent: `${GPON_IFACE}.BiasCurrent`,
};

const STATS_PATHS = {
  status: `${GPON_IFACE}.Status`,
  fecErrors: `${GPON_IFACE}.Stats.FECError`,
  hecErrors: `${GPON_IFACE}.Stats.HECError`,
  dropRate: `${GPON_IFACE}.Stats.DropRate`,
  errorRate: `${GPON_IFACE}.Stats.ErrorRate`,
};

const WIFI_PATHS = {
  clients24: `${WLAN_24}.TotalAssociations`,
  clients5: `${WLAN_50}.TotalAssociations`,
  channel24: `${WLAN_24}.Channel`,
  channel5: `${WLAN_50}.Channel`,
};

// ── Limiares ópticos (cópia de @netx/shared OPTICAL_RX_THRESHOLDS) ────────────
export const RX_THRESHOLDS = { critHigh: -5, warnHigh: -8, warnLow: -25, critLow: -27 } as const;
export const TX_THRESHOLDS = { min: 0.0, max: 7.0 } as const;
/** RSSI (dBm) abaixo do qual um cliente Wi-Fi é considerado mal coberto. */
export const WIFI_WEAK_RSSI_DBM = -75;

export type OpticalHealth = 'OK' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';

export function classifyRxPower(rx: number | null): OpticalHealth {
  if (rx === null || Number.isNaN(rx)) return 'UNKNOWN';
  if (rx < RX_THRESHOLDS.critLow || rx > RX_THRESHOLDS.critHigh) return 'CRITICAL';
  if (rx < RX_THRESHOLDS.warnLow || rx > RX_THRESHOLDS.warnHigh) return 'WARNING';
  return 'OK';
}

/** True se a potência TX da ONT está fora da faixa esperada. */
export function isTxPowerAbnormal(tx: number | null): boolean {
  if (tx === null || Number.isNaN(tx)) return false;
  return tx < TX_THRESHOLDS.min || tx > TX_THRESHOLDS.max;
}

export interface WifiClient {
  mac: string | null;
  band: string;
  rssi: number | null;
  txRate: number | null;
  rxRate: number | null;
}

export interface ExtractedDiagnostics {
  rxPower: number | null;
  txPower: number | null;
  temperature: number | null;
  voltage: number | null;
  biasCurrent: number | null;
  opticalHealth: OpticalHealth;
  gponStatus: string | null;
  fecErrors: number | null;
  hecErrors: number | null;
  dropRate: number | null;
  errorRate: number | null;
  wifiClients24: number | null;
  wifiClients5: number | null;
  wifiChannel24: number | null;
  wifiChannel5: number | null;
  wifiClients: WifiClient[];
  wifiWorstRssi: number | null;
  raw: Record<string, string>;
  /** Algum parâmetro óptico veio preenchido — define se vale persistir. */
  hasOptical: boolean;
}

/**
 * Achata o body de um GetParameterValuesResponse em { nome: valor }.
 * Aceita o shape do parser (cwmp-soap): ParameterList.ParameterValueStruct[].
 */
export function parseParameterList(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const list = body.ParameterList as Record<string, unknown> | undefined;
  const structs = (list?.ParameterValueStruct as Array<Record<string, unknown>>) ?? [];
  for (const p of structs) {
    const name = String(p.Name ?? '');
    if (!name) continue;
    const valRaw = p.Value as unknown;
    const value =
      valRaw != null && typeof valRaw === 'object'
        ? String((valRaw as { '#text'?: unknown })['#text'] ?? '')
        : String(valRaw ?? '');
    out[name] = value;
  }
  return out;
}

/**
 * Normaliza potência óptica (RX/TX) pra dBm.
 *
 * Firmwares Huawei divergem: alguns reportam dBm direto ("-22.80"), outros em
 * centi-dBm como inteiro ("-2280"). Heurística segura pra faixa real de GPON:
 * se |valor| >= 100, é centi-dBm → divide por 100. Override fixo via
 * HUAWEI_OPTICAL_DIVISOR (ex.: "10" pra deci-dBm) quando o firmware fugir.
 */
function normalizePower(raw: string | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (Number.isNaN(n)) return null;
  const forced = process.env.HUAWEI_OPTICAL_DIVISOR;
  if (forced) {
    const d = Number(forced);
    return d > 0 ? round2(n / d) : round2(n);
  }
  return round2(Math.abs(n) >= 100 ? n / 100 : n);
}

function numOrNull(raw: string | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}

/**
 * Tensão de alimentação do transceiver. O firmware HW_WAP_CWMP_V02 reporta em
 * milivolts (ex.: 3338 = 3.338 V); valores <100 já vêm em volts. Override fixo
 * via HUAWEI_VOLTAGE_DIVISOR.
 */
function normalizeVoltage(raw: string | undefined): number | null {
  const n = numOrNull(raw);
  if (n === null) return null;
  const round3 = (v: number) => Math.round(v * 1000) / 1000;
  const forced = process.env.HUAWEI_VOLTAGE_DIVISOR;
  if (forced) {
    const d = Number(forced);
    return d > 0 ? round3(n / d) : n;
  }
  return n > 100 ? round3(n / 1000) : n;
}

function intOrNull(raw: string | undefined): number | null {
  const n = numOrNull(raw);
  return n === null ? null : Math.trunc(n);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const ASSOC_RE = /WLANConfiguration\.(\d+)\.AssociatedDevice\.(\d+)\.(.+)$/;

function bandOf(wlanIdx: string): string {
  if (wlanIdx === '1') return '2.4GHz';
  if (wlanIdx === '5') return '5GHz';
  return `WLAN${wlanIdx}`;
}

/**
 * Reconstrói a lista de clientes Wi-Fi a partir dos params da subárvore
 * AssociatedDevice. Tolerante a variações de firmware: casa MAC/RSSI/taxas
 * por substring no nome do campo.
 */
export function extractWifiClients(params: Record<string, string>): {
  clients: WifiClient[];
  worstRssi: number | null;
} {
  const byKey = new Map<string, WifiClient>();
  for (const [name, value] of Object.entries(params)) {
    const m = ASSOC_RE.exec(name);
    if (!m) continue;
    const [, wlanIdx, clientIdx, field] = m;
    const key = `${wlanIdx}:${clientIdx}`;
    let c = byKey.get(key);
    if (!c) {
      c = { mac: null, band: bandOf(wlanIdx), rssi: null, txRate: null, rxRate: null };
      byKey.set(key, c);
    }
    if (/MACAddress/i.test(field)) c.mac = value || null;
    else if (/RSSI|SignalStrength/i.test(field)) c.rssi = numOrNull(value);
    else if (/TxRate/i.test(field)) c.txRate = numOrNull(value);
    else if (/RxRate/i.test(field)) c.rxRate = numOrNull(value);
  }
  // Só conta como cliente real se identificamos MAC ou RSSI.
  const clients = [...byKey.values()].filter((c) => c.mac !== null || c.rssi !== null);
  const rssis = clients.map((c) => c.rssi).filter((v): v is number => v !== null);
  const worstRssi = rssis.length ? Math.min(...rssis) : null;
  return { clients, worstRssi };
}

/** Extrai métricas de diagnóstico de uma ParameterList já achatada. */
export function extractDiagnostics(params: Record<string, string>): ExtractedDiagnostics {
  const { clients: wifiClients, worstRssi: wifiWorstRssi } = extractWifiClients(params);
  const rxPower = normalizePower(params[OPTICAL_PATHS.rxPower]);
  const txPower = normalizePower(params[OPTICAL_PATHS.txPower]);
  const temperature = numOrNull(params[OPTICAL_PATHS.temperature]);
  const voltage = normalizeVoltage(params[OPTICAL_PATHS.voltage]);
  const biasCurrent = numOrNull(params[OPTICAL_PATHS.biasCurrent]);

  const hasOptical =
    rxPower !== null ||
    txPower !== null ||
    temperature !== null ||
    voltage !== null ||
    biasCurrent !== null;

  return {
    rxPower,
    txPower,
    temperature,
    voltage,
    biasCurrent,
    opticalHealth: classifyRxPower(rxPower),
    gponStatus: params[STATS_PATHS.status] || null,
    fecErrors: intOrNull(params[STATS_PATHS.fecErrors]),
    hecErrors: intOrNull(params[STATS_PATHS.hecErrors]),
    dropRate: numOrNull(params[STATS_PATHS.dropRate]),
    errorRate: numOrNull(params[STATS_PATHS.errorRate]),
    wifiClients24: intOrNull(params[WIFI_PATHS.clients24]),
    wifiClients5: intOrNull(params[WIFI_PATHS.clients5]),
    wifiChannel24: intOrNull(params[WIFI_PATHS.channel24]),
    wifiChannel5: intOrNull(params[WIFI_PATHS.channel5]),
    wifiClients,
    wifiWorstRssi,
    raw: params,
    hasOptical,
  };
}

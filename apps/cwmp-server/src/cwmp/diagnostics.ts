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

const PPP_WAN_INDEX = process.env.HUAWEI_PPPOE_WAN_INDEX ?? '2';
const PPP_PREFIX = `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${PPP_WAN_INDEX}.WANPPPConnection.1`;
const PPP_PATHS = {
  status: `${PPP_PREFIX}.ConnectionStatus`,
  lastError: `${PPP_PREFIX}.LastConnectionError`,
  uptime: `${PPP_PREFIX}.Uptime`,
};
// Contadores de bytes da WAN PPPoE (base do throughput) — mesmos do core-service.
const WAN_STATS_PATHS = {
  rxBytes: `${PPP_PREFIX}.Stats.EthernetBytesReceived`,
  txBytes: `${PPP_PREFIX}.Stats.EthernetBytesSent`,
};

// ── Zyxel PX3321-T1 (espelha tr069-paths.zyxel.ts do core-service) ───────────
// Níveis ópticos da Zyxel já vêm em unidade humana (dBm/°C/V) — sem normalizar.
// PPPoE de internet na WAN 1 (não 2 como Huawei). Usados como FALLBACK quando os
// keys Huawei não estão presentes na ParameterList — Huawei segue intocado.
const ZYXEL_PPP_PREFIX =
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1';
const ZYXEL_PATHS = {
  rxPower: 'InternetGatewayDevice.X_ZYXEL_EXT.Optical.rxPower',
  txPower: 'InternetGatewayDevice.X_ZYXEL_EXT.Optical.txPower',
  temperature: 'InternetGatewayDevice.X_ZYXEL_EXT.Optical.temperature',
  voltage: 'InternetGatewayDevice.X_ZYXEL_EXT.Optical.voltage',
  pppStatus: `${ZYXEL_PPP_PREFIX}.ConnectionStatus`,
  pppLastError: `${ZYXEL_PPP_PREFIX}.LastConnectionError`,
  pppUptime: `${ZYXEL_PPP_PREFIX}.Uptime`,
  wanRxBytes: `${ZYXEL_PPP_PREFIX}.Stats.EthernetBytesReceived`,
  wanTxBytes: `${ZYXEL_PPP_PREFIX}.Stats.EthernetBytesSent`,
  cpuUsage: 'InternetGatewayDevice.DeviceInfo.ProcessStatus.CPUUsage',
};

// ── VSOL/Realtek (espelha tr069-paths.vsol.ts do core-service) ───────────────
// Óptico em X_CT-COM_GponInterfaceConfig (grafia correta "Interface" — não o
// typo Huawei) com valores CRUS estilo DDM SFF-8472: TX/RXPower em 0.1µW,
// SupplyVottage (typo do firmware VSOL!) em 100µV, BiasCurrent em 2µA,
// temperatura em 0.01°C — normalizados aqui. PPPoE/WAN stats usam os MESMOS
// paths padrão do Huawei (WAN 2), já cobertos pelos keys Huawei acima.
// ⚠️ Wi-Fi tem índices INVERTIDOS: WLAN 1 = rádio 5GHz, WLAN 5 = rádio 2.4GHz
// (confirmado por Standard/PossibleChannels e em bancada) — por isso os keys
// de Wi-Fi próprios abaixo. Usado como FALLBACK — Huawei/Zyxel intocados.
const VSOL_GPON_IFACE =
  process.env.VSOL_GPON_IFACE_PATH ??
  'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig';
const VSOL_PATHS = {
  rxPower: `${VSOL_GPON_IFACE}.RXPower`,
  txPower: `${VSOL_GPON_IFACE}.TXPower`,
  temperature: `${VSOL_GPON_IFACE}.TransceiverTemperature`,
  voltage: `${VSOL_GPON_IFACE}.SupplyVottage`,
  biasCurrent: `${VSOL_GPON_IFACE}.BiasCurrent`,
  status: `${VSOL_GPON_IFACE}.Status`,
  fecErrors: `${VSOL_GPON_IFACE}.Stats.FECError`,
  hecErrors: `${VSOL_GPON_IFACE}.Stats.HECError`,
};

// Wi-Fi VSOL — WLAN 5 é o rádio 2.4GHz e WLAN 1 é o 5GHz (inverso do Huawei).
const VSOL_WIFI_PATHS = {
  clients24: `${WLAN_50}.TotalAssociations`,
  clients5: `${WLAN_24}.TotalAssociations`,
  channel24: `${WLAN_50}.Channel`,
  channel5: `${WLAN_24}.Channel`,
};

// ── Parks Fiberlink (espelha tr069-paths.parks.ts do core-service) ───────────
// Duas famílias, layout de WLAN DIFERENTE (confirmado por dump completo, jul/
// 2026): 5xx (gSOAP/X_RTK) usa WLAN 1-5=5GHz e 6-10=2.4GHz; 6xx (easycwmp/
// X_SKYW) usa 1-4=2.4GHz e 5-8=5GHz (convenção Huawei). ⚠️ NENHUMA família expõe
// óptico via TR-069 — só Wi-Fi/PPPoE/recursos (TR-098 padrão). O agregado do
// 5xx sai na WLAN 6 (2.4G) e WLAN 1 (5G); o do 6xx na WLAN 1 (2.4G) e 5 (5G).
const WLAN_60 = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.6';
const PARKS_5XX_WIFI_PATHS = {
  clients24: `${WLAN_60}.TotalAssociations`,
  clients5: `${WLAN_24}.TotalAssociations`,
  channel24: `${WLAN_60}.Channel`,
  channel5: `${WLAN_24}.Channel`,
};

// ── Stavix / Datacom MP-X4410A (espelha tr069-paths.stavix.ts do core-service) ─
// Stavix e Datacom são o MESMO HW (chipset Realtek) rebrandado. ⚠️ Óptico no
// MESMO objeto (e typo) do Huawei — `X_GponInterafceConfig` — MAS com valores em
// unidade HUMANA direta (RXPower "-21" dBm, TXPower "2" dBm, SupplyVoltage "3298"
// mV, BiasCurrent "9" mA; grafia "SupplyVoltage" CORRETA, ≠ typo "Vottage" da
// VSOL). Como compartilha o prefixo óptico com o Huawei, o óptico já é lido pelo
// branch DEFAULT (normalizePower/normalizeVoltage) — NÃO precisa de leitor
// próprio. O que DIVERGE do Huawei é o layout de WLAN: INVERTIDO como VSOL/Parks-
// 5xx (1-5=5GHz, 6-10=2.4GHz), então detectamos a Stavix pra corrigir SÓ o mapa
// de banda e os paths de agregado Wi-Fi. Distingue-se da Parks-5xx (que NÃO tem
// óptico) pela presença do X_GponInterafceConfig; distingue-se do Huawei genuíno
// (layout 1/5) pela extensão X_CT-COM_ na WANPPPConnection (VLANMode/VLANIDMark).
// SEM RSSI por cliente (AssociatedDevice só traz MAC/IP) — cobertura por cliente
// null, como VSOL/Parks. Recursos TR-098 padrão. Fallback — demais intocados.
const STAVIX_CT_COM_MARKERS = [
  `${PPP_PREFIX}.X_CT-COM_VLANIDMark`,
  `${PPP_PREFIX}.X_CT-COM_VLANMode`,
  `${ZYXEL_PPP_PREFIX}.X_CT-COM_VLANIDMark`,
  `${ZYXEL_PPP_PREFIX}.X_CT-COM_VLANMode`,
];
// Stavix reusa o layout invertido da Parks-5xx (1=5G/6=2.4G) — mesmos paths de
// agregado. O óptico continua saindo pelo branch Huawei/default. (PARKS_5XX_WIFI_
// PATHS já está declarado acima; o mapa de banda vai junto do STAVIX_BAND_BY_WLAN
// abaixo, perto dos demais *_BAND_BY_WLAN.)
const STAVIX_WIFI_PATHS = PARKS_5XX_WIFI_PATHS;

// ── Nokia G-1426G-A / AX3000 (espelha tr069-paths.nokia.ts do core-service) ──
// Óptico no objeto GLOBAL X_ALU_OntOpticalParam (NÃO sob WANDevice). ⚠️
// "SupplyVottage" com o MESMO typo da VSOL. Unidades a normalizar (o dump de
// GetParameterNames não trouxe valores) — heurística sign-aware como a ZTE, com
// override fixo via NOKIA_OPTICAL_DIVISOR quando o probe ao vivo confirmar a
// escala. PPPoE/WAN stats usam os MESMOS paths padrão da WAN 1 (já cobertos
// pelos keys Zyxel — WANConnectionDevice.1). Wi-Fi segue a convenção 1/5 do
// Huawei (1-4=2.4G, 5-8=5G). RSSI/SignalStrength por cliente EXISTEM (como a
// Huawei) — a cobertura por cliente funciona. Fallback — demais vendors intocados.
const NOKIA_OPTICAL = {
  rxPower: 'InternetGatewayDevice.X_ALU_OntOpticalParam.RXPower',
  txPower: 'InternetGatewayDevice.X_ALU_OntOpticalParam.TXPower',
  temperature: 'InternetGatewayDevice.X_ALU_OntOpticalParam.TransceiverTemperature',
  voltage: 'InternetGatewayDevice.X_ALU_OntOpticalParam.SupplyVottage',
  biasCurrent: 'InternetGatewayDevice.X_ALU_OntOpticalParam.BiasCurrent',
  status: 'InternetGatewayDevice.X_ALU_OntOpticalParam.Status',
};

const NOKIA_WLAN5_IDX = process.env.NOKIA_WLAN_5G_INDEX ?? '5';
const NOKIA_WLAN_50 = `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${NOKIA_WLAN5_IDX}`;
const NOKIA_WIFI_PATHS = {
  clients24: `${WLAN_24}.TotalAssociations`,
  clients5: `${NOKIA_WLAN_50}.TotalAssociations`,
  channel24: `${WLAN_24}.Channel`,
  channel5: `${NOKIA_WLAN_50}.Channel`,
};

/** Banda por índice de WLAN, por vendor (VSOL e Parks-5xx são invertidos). */
const HUAWEI_BAND_BY_WLAN: Record<string, string> = { '1': '2.4GHz', '5': '5GHz' };
const VSOL_BAND_BY_WLAN: Record<string, string> = { '1': '5GHz', '5': '2.4GHz' };
// Parks 5xx: 1-5=5G, 6-10=2.4G. Parks 6xx segue a convenção Huawei (1/5).
const PARKS_5XX_BAND_BY_WLAN: Record<string, string> = { '1': '5GHz', '6': '2.4GHz' };
// Stavix/Datacom: MESMO layout invertido da Parks-5xx (1=5G, 6=2.4G).
const STAVIX_BAND_BY_WLAN = PARKS_5XX_BAND_BY_WLAN;
// Nokia: 1-4=2.4G, 5-8=5G (convenção Huawei). Índice 5G ajustável por env.
const NOKIA_BAND_BY_WLAN: Record<string, string> = { '1': '2.4GHz', [NOKIA_WLAN5_IDX]: '5GHz' };

/**
 * Potência DDM (unidade 0.1µW, SFF-8472) → dBm. Ex.: 19078 → +2.81 dBm.
 * Zero/negativo = sem leitura → null. ⚠️ O RX abaixo de -30 dBm com o enlace
 * Up é fisicamente impossível em GPON (sensibilidade classe C+ = -30) — esse
 * firmware às vezes devolve lixo no RXPower (ex.: raw 8 → -31 dBm); nesses
 * casos devolvemos null (saúde UNKNOWN) em vez de abrir alerta CRITICAL falso.
 */
function vsolDdmPowerToDbm(raw: string | undefined): number | null {
  const n = numOrNull(raw);
  if (n === null || n <= 0) return null;
  const dbm = round2(10 * Math.log10(n / 10000)); // n × 0.1µW → mW
  return dbm < -30 ? null : dbm;
}

/**
 * Potência óptica Nokia (X_ALU_OntOpticalParam) → dBm. ✅ CONFIRMADO AO VIVO
 * (dump GET com valores, G-1426G-A SW 3TN00383HJKK99, base ZUX-PR 2026-07-24):
 * RX/TX vêm em **dBm DIRETO** como float string ("-19.746941", "2.225604"). O
 * caminho normal é passar direto (round2). Mantemos um fallback de escala
 * (deci/centi/DDM) só como salvaguarda pra firmwares divergentes, atrás do
 * override NOKIA_OPTICAL_DIVISOR. RX abaixo de -30 dBm com enlace Up é lixo de
 * sensor → null (mesma guarda de VSOL/ZTE, evita alarme CRITICAL falso).
 */
function nokiaPowerToDbm(raw: string | undefined, kind: 'rx' | 'tx'): number | null {
  const n = numOrNull(raw);
  if (n === null || n === 0) return null;
  const forced = process.env.NOKIA_OPTICAL_DIVISOR;
  if (forced) {
    const d = Number(forced);
    return d > 0 ? round2(n / d) : round2(n);
  }
  if (kind === 'rx') {
    // dBm direto (confirmado): negativo na faixa física. Positivo só seria DDM cru.
    if (n > 0) {
      const dbm = round2(10 * Math.log10(n / 10000));
      return dbm < -30 ? null : dbm;
    }
    const abs = Math.abs(n);
    const dbm = abs <= 60 ? n : abs <= 600 ? n / 10 : n / 100;
    return dbm < -30 ? null : round2(dbm);
  }
  // TX: dBm direto (confirmado, 0..+7). Escalas maiores = salvaguarda.
  const abs = Math.abs(n);
  if (abs <= 10) return round2(n);
  if (abs <= 70) return round2(n / 10);
  if (abs <= 700) return round2(n / 100);
  return n > 0 ? round2(10 * Math.log10(n / 10000)) : null;
}

/**
 * Tensão de alimentação Nokia → V. ✅ CONFIRMADO: vem em **VOLT DIRETO**
 * ("3.289000"), NÃO em mV nem 100µV (ao contrário de VSOL/ZTE). Passa direto.
 */
function nokiaVoltage(raw: string | undefined): number | null {
  const n = numOrNull(raw);
  return n === null ? null : round2(n);
}

/**
 * Corrente de bias Nokia → mA. ✅ CONFIRMADO: vem em **µA** ("9000.000000" =
 * 9 mA), então ÷1000. ⚠️ NÃO reusar zteBiasCurrent (que divide por 500, dando
 * 18 mA errado). Valores já pequenos (<50) são tratados como mA direto —
 * salvaguarda pra firmware que reporte em mA.
 */
function nokiaBiasCurrent(raw: string | undefined): number | null {
  const n = numOrNull(raw);
  if (n === null) return null;
  return Math.abs(n) <= 50 ? round2(n) : round2(n / 1000);
}

// ── ZTE F670L (espelha tr069-paths.zte.ts do core-service) ───────────────────
// Óptico em X_ZTE-COM_WANPONInterfaceConfig. O GET de diagnóstico pede o
// OBJETO parcial (subárvore inteira), então as folhas são casadas por REGEX
// case-insensitive dentro do prefixo — tolera variação de grafia entre
// firmwares (RXPower vs RxPower) sem derrubar a coleta. PPPoE/WAN stats usam
// os MESMOS paths padrão da WAN 1 já cobertos pelos keys Zyxel. CPU/memória
// são extensões vendor com "%" no valor (X_ZTE-COM_CpuUsed = "4%;1%" POR
// CORE; X_ZTE-COM_MemUsed = "17%") — normalizadas em ztePercent(). Wi-Fi
// segue a convenção 1/5 do Huawei (NÃO a invertida da VSOL) — muda só o
// índice 5G se ZTE_WLAN_5G_INDEX for sobrescrito. Fallback — demais intocados.
const ZTE_PON_IFACE =
  process.env.ZTE_PON_IFACE_PATH ??
  'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig';

const ZTE_WLAN5_IDX = process.env.ZTE_WLAN_5G_INDEX ?? '5';
const ZTE_WLAN_50 = `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${ZTE_WLAN5_IDX}`;
const ZTE_WIFI_PATHS = {
  clients24: `${WLAN_24}.TotalAssociations`,
  clients5: `${ZTE_WLAN_50}.TotalAssociations`,
  channel24: `${WLAN_24}.Channel`,
  channel5: `${ZTE_WLAN_50}.Channel`,
};
const ZTE_BAND_BY_WLAN: Record<string, string> = { '1': '2.4GHz', [ZTE_WLAN5_IDX]: '5GHz' };

/** Valor de uma folha da interface PON ZTE, casada por regex no sufixo. */
function zteIfaceParam(params: Record<string, string>, leafRe: RegExp): string | undefined {
  const prefix = `${ZTE_PON_IFACE}.`;
  for (const [name, value] of Object.entries(params)) {
    if (name.startsWith(prefix) && leafRe.test(name.slice(prefix.length))) return value;
  }
  return undefined;
}

/**
 * Potência óptica ZTE → dBm. Firmwares da família F6xx divergem na unidade:
 * dBm direto ("-19.8"), deci-dBm ("-198"), centi-dBm ("-1980") ou DDM cru em
 * 0.1µW (sempre positivo). Heurística sign-aware pela faixa física de GPON
 * (RX -8..-30 dBm, TX 0..+7 dBm — por isso o `kind`); override fixo via
 * ZTE_OPTICAL_DIVISOR quando o firmware fugir. RX abaixo de -30 dBm com
 * enlace Up é lixo de sensor → null (mesma guarda da VSOL).
 */
function ztePowerToDbm(raw: string | undefined, kind: 'rx' | 'tx'): number | null {
  const n = numOrNull(raw);
  if (n === null || n === 0) return null;
  const forced = process.env.ZTE_OPTICAL_DIVISOR;
  if (forced) {
    const d = Number(forced);
    return d > 0 ? round2(n / d) : round2(n);
  }
  if (kind === 'rx') {
    // RX em dBm é sempre negativo em GPON; positivo só pode ser DDM cru.
    if (n > 0) {
      const dbm = round2(10 * Math.log10(n / 10000));
      return dbm < -30 ? null : dbm;
    }
    const abs = Math.abs(n);
    const dbm = abs <= 60 ? n : abs <= 600 ? n / 10 : n / 100;
    return dbm < -30 ? null : round2(dbm);
  }
  // TX: 0..+7 dBm nas 3 escalas; acima de 700 só sobra DDM cru.
  const abs = Math.abs(n);
  if (abs <= 10) return round2(n);
  if (abs <= 70) return round2(n / 10);
  if (abs <= 700) return round2(n / 100);
  return n > 0 ? round2(10 * Math.log10(n / 10000)) : null;
}

/** Temperatura ZTE → °C (°C direto ou centi-°C — 4880 = 48.8°C). */
function zteTemperature(raw: string | undefined): number | null {
  const n = numOrNull(raw);
  if (n === null) return null;
  return Math.abs(n) <= 150 ? round2(n) : round2(n / 100);
}

/** Tensão ZTE → V (V direto, mV ou 100µV — 3300 = 33000 = 3.3V). */
function zteVoltage(raw: string | undefined): number | null {
  const n = numOrNull(raw);
  if (n === null) return null;
  const round3 = (v: number) => Math.round(v * 1000) / 1000;
  if (n < 10) return round3(n);
  return n < 10000 ? round3(n / 1000) : round3(n / 10000);
}

/** Corrente de bias ZTE → mA (mA direto ou 2µA — 5975 = 11.95mA). */
function zteBiasCurrent(raw: string | undefined): number | null {
  const n = numOrNull(raw);
  if (n === null) return null;
  return Math.abs(n) <= 100 ? round2(n) : round2(n / 500);
}

// Recursos do CPE ZTE — X_ZTE-COM_CpuUsed/MemUsed (valores com "%"; CPU vem
// um valor por core separado por ";"). Confirmado no walk ao vivo (jul/2026).
const ZTE_RESOURCE_PATHS = {
  cpuUsed: 'InternetGatewayDevice.DeviceInfo.X_ZTE-COM_CpuUsed',
  memUsed: 'InternetGatewayDevice.DeviceInfo.X_ZTE-COM_MemUsed',
};

/**
 * "4%;1%" → 4 (pior core) / "17%" → 17. Usamos o PIOR core, não a média —
 * é o que interessa pra alerta (um core saturado já degrada o CPE).
 */
function ztePercent(raw: string | undefined): number | null {
  if (raw == null || raw === '') return null;
  const values = raw
    .split(';')
    .map((part) => Number(part.replace('%', '').trim()))
    .filter((v) => !Number.isNaN(v));
  return values.length ? Math.round(Math.max(...values)) : null;
}

// Paths padrão TR-098 de memória (VSOL/Zyxel) — % calculado de Total/Free.
const MEMORY_STATUS_PATHS = {
  total: 'InternetGatewayDevice.DeviceInfo.MemoryStatus.Total',
  free: 'InternetGatewayDevice.DeviceInfo.MemoryStatus.Free',
};

/** % de memória usada a partir de MemoryStatus.Total/Free (padrão TR-098). */
function memUsageFromStatus(params: Record<string, string>): number | null {
  const total = numOrNull(params[MEMORY_STATUS_PATHS.total]);
  const free = numOrNull(params[MEMORY_STATUS_PATHS.free]);
  if (total === null || free === null || total <= 0) return null;
  return Math.round((1 - free / total) * 100);
}

// Regex de host da LAN: ...Hosts.Host.{i}.{campo}
const HOST_RE = /Hosts\.Host\.(\d+)\.(.+)$/;

// ── TR-143 (speed test / ping) — nomes padrão TR-098 ─────────────────────────
const TR143 = {
  dlState: 'InternetGatewayDevice.DownloadDiagnostics.DiagnosticsState',
  dlTestBytes: 'InternetGatewayDevice.DownloadDiagnostics.TestBytesReceived',
  dlTotalBytes: 'InternetGatewayDevice.DownloadDiagnostics.TotalBytesReceived',
  dlBom: 'InternetGatewayDevice.DownloadDiagnostics.BOMTime',
  dlEom: 'InternetGatewayDevice.DownloadDiagnostics.EOMTime',
  ulState: 'InternetGatewayDevice.UploadDiagnostics.DiagnosticsState',
  ulTotalBytes: 'InternetGatewayDevice.UploadDiagnostics.TotalBytesSent',
  ulTestLen: 'InternetGatewayDevice.UploadDiagnostics.TestFileLength',
  ulBom: 'InternetGatewayDevice.UploadDiagnostics.BOMTime',
  ulEom: 'InternetGatewayDevice.UploadDiagnostics.EOMTime',
  pingState: 'InternetGatewayDevice.IPPingDiagnostics.DiagnosticsState',
  pingSuccess: 'InternetGatewayDevice.IPPingDiagnostics.SuccessCount',
  pingFailure: 'InternetGatewayDevice.IPPingDiagnostics.FailureCount',
  pingAvg: 'InternetGatewayDevice.IPPingDiagnostics.AverageResponseTime',
  pingMin: 'InternetGatewayDevice.IPPingDiagnostics.MinimumResponseTime',
  pingMax: 'InternetGatewayDevice.IPPingDiagnostics.MaximumResponseTime',
};

/** Nomes lidos no GET de resultado após "8 DIAGNOSTICS COMPLETE". */
export const TR143_RESULT_NAMES: string[] = [
  TR143.dlState, TR143.dlTestBytes, TR143.dlTotalBytes, TR143.dlBom, TR143.dlEom,
  TR143.ulState, TR143.ulTotalBytes, TR143.ulTestLen, TR143.ulBom, TR143.ulEom,
  TR143.pingState, TR143.pingSuccess, TR143.pingFailure, TR143.pingAvg, TR143.pingMin, TR143.pingMax,
];

export interface Tr143Download {
  state: string;
  throughputKbps: number | null;
}
export interface Tr143Ping {
  state: string;
  success: number | null;
  failure: number | null;
  avgMs: number | null;
  minMs: number | null;
  maxMs: number | null;
}

/** Vazão de download em kbps a partir de bytes + janela BOM/EOM (ISO 8601). */
function throughputKbps(testBytes: string | undefined, bom: string | undefined, eom: string | undefined): number | null {
  const bytes = numOrNull(testBytes ?? '');
  if (bytes === null || !bom || !eom) return null;
  const t0 = Date.parse(bom);
  const t1 = Date.parse(eom);
  if (Number.isNaN(t0) || Number.isNaN(t1) || t1 <= t0) return null;
  const sec = (t1 - t0) / 1000;
  return Math.round((bytes * 8) / sec / 1000);
}

/**
 * Extrai resultados TR-143 de um GetParameterValues. Retorna apenas as partes
 * presentes (download e/ou ping) com DiagnosticsState != None/Requested.
 */
export function parseTr143Result(params: Record<string, string>): {
  download: Tr143Download | null;
  upload: Tr143Download | null;
  ping: Tr143Ping | null;
} {
  const dlState = params[TR143.dlState];
  const download: Tr143Download | null =
    dlState && dlState !== 'None' && dlState !== 'Requested'
      ? { state: dlState, throughputKbps: throughputKbps(params[TR143.dlTestBytes], params[TR143.dlBom], params[TR143.dlEom]) }
      : null;

  const ulState = params[TR143.ulState];
  const upload: Tr143Download | null =
    ulState && ulState !== 'None' && ulState !== 'Requested'
      ? {
          state: ulState,
          throughputKbps: throughputKbps(
            params[TR143.ulTotalBytes] ?? params[TR143.ulTestLen],
            params[TR143.ulBom],
            params[TR143.ulEom],
          ),
        }
      : null;

  const pingState = params[TR143.pingState];
  const ping: Tr143Ping | null =
    pingState && pingState !== 'None' && pingState !== 'Requested'
      ? {
          state: pingState,
          success: intOrNull(params[TR143.pingSuccess]),
          failure: intOrNull(params[TR143.pingFailure]),
          avgMs: numOrNull(params[TR143.pingAvg]),
          minMs: numOrNull(params[TR143.pingMin]),
          maxMs: numOrNull(params[TR143.pingMax]),
        }
      : null;

  return { download, upload, ping };
}

const WIFI_PATHS = {
  clients24: `${WLAN_24}.TotalAssociations`,
  clients5: `${WLAN_50}.TotalAssociations`,
  channel24: `${WLAN_24}.Channel`,
  channel5: `${WLAN_50}.Channel`,
};

// Recursos do CPE (DeviceInfo) — % CPU/mem + temperatura da placa. Mesmos paths
// escalares do core-service (tr069-paths.huawei.ts).
const RESOURCE_PATHS = {
  cpuUsed: 'InternetGatewayDevice.DeviceInfo.X_HW_CpuUsed',
  memUsed: 'InternetGatewayDevice.DeviceInfo.X_HW_MemUsed',
  deviceTemp: 'InternetGatewayDevice.DeviceInfo.TemperatureStatus.TemperatureSensor.1.Value',
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

export interface LanHost {
  mac: string | null;
  ip: string | null;
  hostname: string | null;
  active: boolean | null;
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
  pppStatus: string | null;
  pppLastError: string | null;
  wanUptime: number | null;
  hosts: LanHost[];
  wifiClients24: number | null;
  wifiClients5: number | null;
  wifiChannel24: number | null;
  wifiChannel5: number | null;
  wifiClients: WifiClient[];
  wifiWorstRssi: number | null;
  wifiAvgRssi: number | null;
  cpuUsage: number | null;
  memUsage: number | null;
  deviceTemp: number | null;
  wanRxBytes: number | null;
  wanTxBytes: number | null;
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

/** Divide por `divisor` e arredonda a 2 casas, propagando null. */
function round2Null(n: number | null, divisor: number): number | null {
  return n === null ? null : round2(n / divisor);
}

const ASSOC_RE = /WLANConfiguration\.(\d+)\.AssociatedDevice\.(\d+)\.(.+)$/;

/**
 * Reconstrói a lista de clientes Wi-Fi a partir dos params da subárvore
 * AssociatedDevice. Tolerante a variações de firmware: casa MAC/RSSI/taxas
 * por substring no nome do campo. `bandByWlan` mapeia índice de WLAN → banda
 * (na VSOL os índices são invertidos vs Huawei).
 */
export function extractWifiClients(
  params: Record<string, string>,
  bandByWlan: Record<string, string> = HUAWEI_BAND_BY_WLAN,
): {
  clients: WifiClient[];
  worstRssi: number | null;
  avgRssi: number | null;
} {
  const byKey = new Map<string, WifiClient>();
  for (const [name, value] of Object.entries(params)) {
    const m = ASSOC_RE.exec(name);
    if (!m) continue;
    const [, wlanIdx, clientIdx, field] = m;
    const key = `${wlanIdx}:${clientIdx}`;
    let c = byKey.get(key);
    if (!c) {
      c = {
        mac: null,
        band: bandByWlan[wlanIdx] ?? `WLAN${wlanIdx}`,
        rssi: null,
        txRate: null,
        rxRate: null,
      };
      byKey.set(key, c);
    }
    if (/MACAddress/i.test(field)) c.mac = value || null;
    // RSSI Wi-Fi é SEMPRE negativo em dBm; 0 (ou positivo) = "não medido" — vários
    // firmwares (ex.: Nokia G-1426G-A) expõem o campo mas o zeram. Tratar como
    // null pra não poluir worst/avg com uma cobertura "0 dBm" fisicamente irreal.
    else if (/RSSI|SignalStrength/i.test(field)) {
      const r = numOrNull(value);
      c.rssi = r !== null && r < 0 ? r : null;
    } else if (/TxRate/i.test(field)) c.txRate = numOrNull(value);
    else if (/RxRate/i.test(field)) c.rxRate = numOrNull(value);
  }
  // Só conta como cliente real se identificamos MAC ou RSSI.
  const clients = [...byKey.values()].filter((c) => c.mac !== null || c.rssi !== null);
  const rssis = clients.map((c) => c.rssi).filter((v): v is number => v !== null);
  const worstRssi = rssis.length ? Math.min(...rssis) : null;
  const avgRssi = rssis.length ? Math.round(rssis.reduce((a, b) => a + b, 0) / rssis.length) : null;
  return { clients, worstRssi, avgRssi };
}

/** Reconstrói a tabela de hosts da LAN a partir da subárvore Hosts.Host. */
export function extractLanHosts(params: Record<string, string>): LanHost[] {
  const byIdx = new Map<string, LanHost>();
  for (const [name, value] of Object.entries(params)) {
    const m = HOST_RE.exec(name);
    if (!m) continue;
    const [, idx, field] = m;
    let h = byIdx.get(idx);
    if (!h) {
      h = { mac: null, ip: null, hostname: null, active: null };
      byIdx.set(idx, h);
    }
    if (/MACAddress/i.test(field)) h.mac = value || null;
    else if (/IPAddress/i.test(field)) h.ip = value || null;
    else if (/HostName/i.test(field)) h.hostname = value || null;
    else if (/^Active$/i.test(field)) h.active = value === '1' || /true/i.test(value);
  }
  return [...byIdx.values()].filter((h) => h.mac !== null || h.ip !== null);
}

/** Extrai métricas de diagnóstico de uma ParameterList já achatada. */
export function extractDiagnostics(params: Record<string, string>): ExtractedDiagnostics {
  // Óptico: Huawei (com normalização de unidade) tem prioridade; se os keys
  // Huawei não vierem, cai no Zyxel (valores já em dBm/°C/V — sem normalizar)
  // e depois no VSOL/Realtek (valores DDM crus — convertidos aqui).
  const zyxelOptical = OPTICAL_PATHS.rxPower in params ? false : ZYXEL_PATHS.rxPower in params;
  // Qualquer key óptico VSOL ativa o branch — Inform de notificação passiva
  // ("4 VALUE CHANGE") traz SÓ os params que mudaram (ex.: RXPower sem
  // TXPower); exigir um key específico descartaria a leitura.
  const vsolOptical =
    !zyxelOptical &&
    !(OPTICAL_PATHS.rxPower in params) &&
    [
      VSOL_PATHS.rxPower,
      VSOL_PATHS.txPower,
      VSOL_PATHS.temperature,
      VSOL_PATHS.voltage,
      VSOL_PATHS.biasCurrent,
    ].some((k) => k in params);
  // ZTE: QUALQUER folha sob o prefixo X_ZTE-COM_WANPONInterfaceConfig ativa o
  // branch (o GET pede o objeto parcial; as folhas são casadas por regex).
  const zteOptical =
    !zyxelOptical &&
    !vsolOptical &&
    !(OPTICAL_PATHS.rxPower in params) &&
    Object.keys(params).some((k) => k.startsWith(`${ZTE_PON_IFACE}.`));
  // Parks 5xx (gSOAP/X_RTK): SEM óptico, WLAN 1-5=5G e 6-10=2.4G (invertido vs
  // Huawei). Detecta pela extensão Realtek (X_RTK_ na WAN) OU pela agregação da
  // WLAN 6 (rádio 2.4G do 5xx). A Parks 6xx (X_SKYW) segue a convenção Huawei
  // 1/5 — cai no default sem tratamento especial. NÃO mexe nos vendors ópticos.
  const parks5xx =
    !zyxelOptical &&
    !vsolOptical &&
    !zteOptical &&
    !(OPTICAL_PATHS.rxPower in params) &&
    (Object.keys(params).some((k) => /\.X_RTK_Vlan/.test(k)) ||
      PARKS_5XX_WIFI_PATHS.clients24 in params ||
      PARKS_5XX_WIFI_PATHS.channel24 in params);
  // Nokia (X_ALU_OntOpticalParam): QUALQUER folha óptica ALU ativa o branch — o
  // Inform passivo ("4 VALUE CHANGE") traz só o que mudou (ex.: RXPower sem
  // TXPower); exigir um key específico descartaria a leitura. Óptico Nokia é o
  // objeto GLOBAL X_ALU_OntOpticalParam (não conflita com os prefixos dos outros
  // vendors). Precede nenhum vendor óptico anterior (todos mutuamente exclusivos).
  const nokiaOptical =
    !zyxelOptical &&
    !vsolOptical &&
    !zteOptical &&
    !(OPTICAL_PATHS.rxPower in params) &&
    [
      NOKIA_OPTICAL.rxPower,
      NOKIA_OPTICAL.txPower,
      NOKIA_OPTICAL.temperature,
      NOKIA_OPTICAL.voltage,
      NOKIA_OPTICAL.biasCurrent,
    ].some((k) => k in params);
  // Stavix/Datacom: compartilha o objeto óptico X_GponInterafceConfig com o
  // Huawei (por isso o óptico é lido pelo branch DEFAULT — NÃO é um branch óptico
  // próprio), mas o layout de WLAN é INVERTIDO (1=5G/6=2.4G). Detectamos SÓ pra
  // trocar o mapa de banda/agregado Wi-Fi. Sinais: extensão X_CT-COM_ na
  // WANPPPConnection (VLANMode/VLANIDMark — o Huawei genuíno não tem) OU o
  // agregado da WLAN 6 (rádio 2.4G do layout invertido). Precede parks5xx só na
  // presença do óptico Huawei (que zera parks5xx), então são exclusivos. NÃO
  // afeta rxPower/txPower/etc. — esses seguem o default (normalizePower).
  const stavix =
    !zyxelOptical &&
    !vsolOptical &&
    !zteOptical &&
    !nokiaOptical &&
    (STAVIX_CT_COM_MARKERS.some((k) => k in params) ||
      (OPTICAL_PATHS.rxPower in params &&
        (STAVIX_WIFI_PATHS.clients24 in params || STAVIX_WIFI_PATHS.channel24 in params)));
  // Wi-Fi: na VSOL o mapa índice→banda é invertido (WLAN 1=5G, 5=2.4G); a ZTE
  // segue a convenção 1/5 do Huawei (índice 5G ajustável por env); a Parks 5xx e
  // a Stavix/Datacom são 1=5G/6=2.4G.
  const { clients: wifiClients, worstRssi: wifiWorstRssi, avgRssi: wifiAvgRssi } =
    extractWifiClients(
      params,
      vsolOptical
        ? VSOL_BAND_BY_WLAN
        : zteOptical
          ? ZTE_BAND_BY_WLAN
          : parks5xx
            ? PARKS_5XX_BAND_BY_WLAN
            : nokiaOptical
              ? NOKIA_BAND_BY_WLAN
              : stavix
                ? STAVIX_BAND_BY_WLAN
                : HUAWEI_BAND_BY_WLAN,
    );
  const wifiPaths = vsolOptical
    ? VSOL_WIFI_PATHS
    : zteOptical
      ? ZTE_WIFI_PATHS
      : parks5xx
        ? PARKS_5XX_WIFI_PATHS
        : nokiaOptical
          ? NOKIA_WIFI_PATHS
          : stavix
            ? STAVIX_WIFI_PATHS
            : WIFI_PATHS;
  const hosts = extractLanHosts(params);
  const rxPower = vsolOptical
    ? vsolDdmPowerToDbm(params[VSOL_PATHS.rxPower])
    : zteOptical
      ? ztePowerToDbm(zteIfaceParam(params, /^rxpower$/i), 'rx')
      : nokiaOptical
        ? nokiaPowerToDbm(params[NOKIA_OPTICAL.rxPower], 'rx')
        : zyxelOptical
          ? numOrNull(params[ZYXEL_PATHS.rxPower])
          : normalizePower(params[OPTICAL_PATHS.rxPower]);
  const txPower = vsolOptical
    ? vsolDdmPowerToDbm(params[VSOL_PATHS.txPower])
    : zteOptical
      ? ztePowerToDbm(zteIfaceParam(params, /^txpower$/i), 'tx')
      : nokiaOptical
        ? nokiaPowerToDbm(params[NOKIA_OPTICAL.txPower], 'tx')
        : zyxelOptical
          ? numOrNull(params[ZYXEL_PATHS.txPower])
          : normalizePower(params[OPTICAL_PATHS.txPower]);
  const temperature = vsolOptical
    ? round2Null(numOrNull(params[VSOL_PATHS.temperature]), 100) // 0.01°C → °C
    : zteOptical
      ? zteTemperature(zteIfaceParam(params, /^transceivertemperature$/i))
      : nokiaOptical
        ? zteTemperature(params[NOKIA_OPTICAL.temperature]) // °C direto ou centi-°C
        : numOrNull(params[OPTICAL_PATHS.temperature] ?? params[ZYXEL_PATHS.temperature]);
  const voltage = vsolOptical
    ? round2Null(numOrNull(params[VSOL_PATHS.voltage]), 10000) // 100µV → V
    : zteOptical
      ? zteVoltage(zteIfaceParam(params, /^supply(voltage|vottage)$/i))
      : nokiaOptical
        ? nokiaVoltage(params[NOKIA_OPTICAL.voltage]) // V direto (confirmado)
        : zyxelOptical
          ? numOrNull(params[ZYXEL_PATHS.voltage])
          : normalizeVoltage(params[OPTICAL_PATHS.voltage]);
  const biasCurrent = vsolOptical
    ? round2Null(numOrNull(params[VSOL_PATHS.biasCurrent]), 500) // 2µA → mA
    : zteOptical
      ? zteBiasCurrent(zteIfaceParam(params, /^biascurrent$/i))
      : nokiaOptical
        ? nokiaBiasCurrent(params[NOKIA_OPTICAL.biasCurrent]) // µA → mA (confirmado)
        : numOrNull(params[OPTICAL_PATHS.biasCurrent]);

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
    gponStatus:
      params[STATS_PATHS.status] ||
      params[VSOL_PATHS.status] ||
      zteIfaceParam(params, /^status$/i) ||
      params[NOKIA_OPTICAL.status] ||
      null,
    fecErrors: intOrNull(
      params[STATS_PATHS.fecErrors] ??
        params[VSOL_PATHS.fecErrors] ??
        zteIfaceParam(params, /^stats\.fecerrors?$/i),
    ),
    hecErrors: intOrNull(
      params[STATS_PATHS.hecErrors] ??
        params[VSOL_PATHS.hecErrors] ??
        zteIfaceParam(params, /^stats\.hecerrors?$/i),
    ),
    dropRate: numOrNull(params[STATS_PATHS.dropRate]),
    errorRate: numOrNull(params[STATS_PATHS.errorRate]),
    pppStatus: params[PPP_PATHS.status] ?? params[ZYXEL_PATHS.pppStatus] ?? null,
    pppLastError: params[PPP_PATHS.lastError] ?? params[ZYXEL_PATHS.pppLastError] ?? null,
    wanUptime: intOrNull(params[PPP_PATHS.uptime] ?? params[ZYXEL_PATHS.pppUptime]),
    hosts,
    wifiClients24: intOrNull(params[wifiPaths.clients24]),
    wifiClients5: intOrNull(params[wifiPaths.clients5]),
    wifiChannel24: intOrNull(params[wifiPaths.channel24]),
    wifiChannel5: intOrNull(params[wifiPaths.channel5]),
    wifiClients,
    wifiWorstRssi,
    wifiAvgRssi,
    cpuUsage:
      intOrNull(params[RESOURCE_PATHS.cpuUsed] ?? params[ZYXEL_PATHS.cpuUsage]) ??
      ztePercent(params[ZTE_RESOURCE_PATHS.cpuUsed]),
    // X_HW_MemUsed (Huawei), % derivado de MemoryStatus.Total/Free (padrão
    // TR-098 — VSOL/Zyxel) ou X_ZTE-COM_MemUsed ("17%" — ZTE).
    memUsage:
      intOrNull(params[RESOURCE_PATHS.memUsed]) ??
      memUsageFromStatus(params) ??
      ztePercent(params[ZTE_RESOURCE_PATHS.memUsed]),
    deviceTemp: intOrNull(params[RESOURCE_PATHS.deviceTemp]),
    wanRxBytes: intOrNull(params[WAN_STATS_PATHS.rxBytes] ?? params[ZYXEL_PATHS.wanRxBytes]),
    wanTxBytes: intOrNull(params[WAN_STATS_PATHS.txBytes] ?? params[ZYXEL_PATHS.wanTxBytes]),
    raw: params,
    hasOptical,
  };
}

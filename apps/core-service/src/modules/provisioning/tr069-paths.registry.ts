/**
 * Resolver de paths TR-069 por fabricante.
 *
 * Hoje os fluxos de diagnóstico/notificação eram hardcoded Huawei — numa Zyxel
 * isso enfileirava paths inexistentes e o CPE devolvia Fault 9005 a cada ciclo.
 * Este registry escolhe a família de paths certa por `manufacturer`; fallback é
 * Huawei (comportamento atual, sem regressão).
 *
 * VSOL/Realtek entra pela mesma porta: o CPE reporta manufacturer "Realtek",
 * e ANTES do primeiro Inform (ZTP) o vendor é inferido pelo PREFIXO do SN GPON
 * ("GPON..." = VSOL, "HWTC..." = Huawei) — assim o placeholder e os params de
 * provisionamento já nascem com os paths certos.
 *
 * As REGRAS de conformidade (Tr069Profile) seguem genéricas (usam o `param` da
 * regra), então este resolver cobre só os fluxos imperativos: GET de
 * diagnóstico, SetParameterAttributes (arme de notificação) e provisionamento
 * (ZTP Wi-Fi/PPPoE + troca de Wi-Fi pós-instalação).
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import {
  HUAWEI_EG8145_PATHS,
  huaweiDiagnosticParamNames,
  huaweiNotificationAttributes,
} from './tr069-paths.huawei';
import {
  VSOL_PATHS,
  vsolDiagnosticParamNames,
  vsolNotificationAttributes,
} from './tr069-paths.vsol';
import {
  zyxelDiagnosticParamNames,
  zyxelNotificationAttributes,
} from './tr069-paths.zyxel';

export type Tr069Vendor = 'HUAWEI' | 'ZYXEL' | 'VSOL';

/** Casa fabricante por substring case-insensitive (device reporta "ZYXEL"). */
export function isZyxel(manufacturer?: string | null): boolean {
  return (manufacturer ?? '').toLowerCase().includes('zyxel');
}

/** VSOL reporta manufacturer "Realtek" (stack do chipset) — casa ambos. */
export function isVsol(manufacturer?: string | null): boolean {
  return /realtek|v-?sol/i.test(manufacturer ?? '');
}

/**
 * Vendor efetivo do device. `manufacturer` (reportado no Inform) tem
 * prioridade; sem ele (placeholder pré-Inform), infere pelo prefixo do SN
 * GPON. Fallback Huawei — comportamento histórico, sem regressão.
 */
export function vendorFor(
  manufacturer?: string | null,
  snGpon?: string | null,
): Tr069Vendor {
  if (isZyxel(manufacturer)) return 'ZYXEL';
  if (isVsol(manufacturer)) return 'VSOL';
  if (manufacturer) return 'HUAWEI';
  const sn = (snGpon ?? '').toUpperCase();
  if (sn.startsWith('GPON')) return 'VSOL';
  return 'HUAWEI';
}

/**
 * Identidade do placeholder Tr069Device criado ANTES do primeiro Inform
 * (ativação/troca de Wi-Fi). O deviceId real chega no Inform e o ACS regrava;
 * aqui só precisamos de uma chave estável + manufacturer coerente pro registry
 * escolher os paths certos até lá. OUIs: 00259E=Huawei, 006D61=VSOL/Realtek.
 */
export function placeholderIdentityFor(
  snGpon: string,
): { deviceId: string; manufacturer: string; oui: string; vendor: Tr069Vendor } {
  const vendor = vendorFor(null, snGpon);
  if (vendor === 'VSOL') {
    return {
      deviceId: `006D61-${snGpon.toUpperCase()}`,
      manufacturer: 'Realtek',
      oui: '006D61',
      vendor,
    };
  }
  return {
    deviceId: `00259E-${snGpon.toUpperCase()}`,
    manufacturer: 'Huawei',
    oui: '00259E',
    vendor,
  };
}

/**
 * Paths de provisionamento (ZTP + troca de Wi-Fi). Chaves comuns aos vendors
 * suportados; Zyxel não passa por esse fluxo (CPE varejo, sem ZTP GPON).
 */
export interface ProvisioningPaths {
  ssid24: string;
  ssid50: string;
  pwd24: string;
  pwd50: string;
  informInterval: string;
  connReqUsername: string;
  connReqPassword: string;
  pppoeUsername: string;
  pppoePassword: string;
  pppoeEnable: string;
  pppoeVlan: string;
}

export function provisioningPathsFor(vendor: Tr069Vendor): ProvisioningPaths {
  if (vendor === 'VSOL') {
    return {
      ssid24: VSOL_PATHS.ssid24,
      ssid50: VSOL_PATHS.ssid50,
      pwd24: VSOL_PATHS.pwd24,
      pwd50: VSOL_PATHS.pwd50,
      informInterval: VSOL_PATHS.informInterval,
      connReqUsername: VSOL_PATHS.connReqUsername,
      connReqPassword: VSOL_PATHS.connReqPassword,
      pppoeUsername: VSOL_PATHS.pppoeUsername,
      pppoePassword: VSOL_PATHS.pppoePassword,
      pppoeEnable: VSOL_PATHS.pppoeEnable,
      pppoeVlan: VSOL_PATHS.pppoeVlan,
    };
  }
  return {
    ssid24: HUAWEI_EG8145_PATHS.ssid24,
    ssid50: HUAWEI_EG8145_PATHS.ssid50,
    pwd24: HUAWEI_EG8145_PATHS.pwd24,
    pwd50: HUAWEI_EG8145_PATHS.pwd50,
    informInterval: HUAWEI_EG8145_PATHS.informInterval,
    connReqUsername: HUAWEI_EG8145_PATHS.connReqUsername,
    connReqPassword: HUAWEI_EG8145_PATHS.connReqPassword,
    pppoeUsername: HUAWEI_EG8145_PATHS.pppoeUsername,
    pppoePassword: HUAWEI_EG8145_PATHS.pppoePassword,
    pppoeEnable: HUAWEI_EG8145_PATHS.pppoeEnable,
    pppoeVlan: HUAWEI_EG8145_PATHS.pppoeVlan,
  };
}

/**
 * Lista de params do GET_PARAMS de diagnóstico para o fabricante.
 * `productClass` refina por MODELO dentro do vendor (Huawei: temperatura só
 * existe no X6/X10 — ver huaweiDiagnosticParamNames).
 */
export function diagnosticParamNamesFor(
  manufacturer?: string | null,
  productClass?: string | null,
): string[] {
  if (isZyxel(manufacturer)) return zyxelDiagnosticParamNames();
  if (isVsol(manufacturer)) return vsolDiagnosticParamNames();
  return huaweiDiagnosticParamNames(productClass);
}

/** Atributos de notificação (SetParameterAttributes) para o fabricante. */
export function notificationAttributesFor(
  manufacturer?: string | null,
): Array<{ name: string; notification: 0 | 1 | 2 }> {
  if (isZyxel(manufacturer)) return zyxelNotificationAttributes();
  if (isVsol(manufacturer)) return vsolNotificationAttributes();
  return huaweiNotificationAttributes();
}

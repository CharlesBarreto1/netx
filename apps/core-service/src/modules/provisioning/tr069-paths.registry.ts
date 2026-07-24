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
  ZTE_F670L_PATHS,
  zteDiagnosticParamNames,
  zteNotificationAttributes,
} from './tr069-paths.zte';
import {
  zyxelDiagnosticParamNames,
  zyxelNotificationAttributes,
} from './tr069-paths.zyxel';
import {
  parksDiagnosticParamNames,
  parksFamilyFor,
  parksNotificationAttributes,
  parksProvisioningPaths,
} from './tr069-paths.parks';
import {
  nokiaDiagnosticParamNames,
  nokiaNotificationAttributes,
  nokiaProvisioningPaths,
} from './tr069-paths.nokia';
import {
  stavixDiagnosticParamNames,
  stavixNotificationAttributes,
  stavixProvisioningPaths,
} from './tr069-paths.stavix';

export type Tr069Vendor = 'HUAWEI' | 'ZYXEL' | 'VSOL' | 'ZTE' | 'PARKS' | 'NOKIA' | 'STAVIX';

/** Casa fabricante por substring case-insensitive (device reporta "ZYXEL"). */
export function isZyxel(manufacturer?: string | null): boolean {
  return (manufacturer ?? '').toLowerCase().includes('zyxel');
}

/** VSOL reporta manufacturer "Realtek" (stack do chipset) — casa ambos. */
export function isVsol(manufacturer?: string | null): boolean {
  return /realtek|v-?sol/i.test(manufacturer ?? '');
}

/** ZTE genuína reporta manufacturer "ZTE" (F670L: confirmado no piloto PY). */
export function isZte(manufacturer?: string | null): boolean {
  return /zte/i.test(manufacturer ?? '');
}

/**
 * Parks reporta manufacturer "PARKS" (ou "PRKS"), OUI 000416, modelos
 * Fiberlink*. ⚠️ NÃO confundir com Stavix: o serial "MKPG"/manufacturer
 * "MKTECH" (MP-X4410A) NÃO é Parks apesar do "MK". A família (5xx gSOAP vs 6xx
 * easycwmp) é discriminada por productClass em parksFamilyFor().
 */
export function isParks(manufacturer?: string | null): boolean {
  return /^p(a)?rks$/i.test((manufacturer ?? '').trim());
}

/**
 * Nokia reporta manufacturer "Nokia" (às vezes "Alcatel-Lucent" ou o OUI/ID
 * "ALCL") — casa os três. Modelo base G-1426G-A (AX3000), extensões X_ALU-COM_.
 * O serial GPON Nokia começa com "ALCL" (OUI 414C434C). ⚠️ Ancorado no INÍCIO
 * (como isParks) pra "ALCL"/"Alcatel" não casar como substring no meio de outro
 * nome (ex.: "…alcl…") e roubar o device pro vendor errado.
 */
export function isNokia(manufacturer?: string | null): boolean {
  return /^(nokia|alcatel|alcl)/i.test((manufacturer ?? '').trim());
}

/**
 * Stavix e Datacom são o MESMO hardware (MP-X4410A / DM986-416 AX30, chipset
 * Realtek) rebrandado — um único perfil de paths. Distingue-se pelo manufacturer
 * do Inform:
 *   • Stavix  → "MKTECH" (OUI 0CF0B4, serial "MKPG…")
 *   • Datacom → "Datacom" (OUI 1881ED, serial "DACM…")
 * ⚠️ O chipset é Realtek, mas o manufacturer reportado é "MKTECH"/"Datacom" (NÃO
 * "Realtek"), então NÃO colide com isVsol. Ancorado no INÍCIO (como isParks/
 * isNokia) pra não casar como substring no meio de outro nome.
 */
export function isStavix(manufacturer?: string | null): boolean {
  return /^mktech/i.test((manufacturer ?? '').trim());
}

export function isDatacom(manufacturer?: string | null): boolean {
  return /^datacom/i.test((manufacturer ?? '').trim());
}

/** Stavix OU Datacom — mesmo perfil de paths (`tr069-paths.stavix.ts`). */
export function isStavixFamily(manufacturer?: string | null): boolean {
  return isStavix(manufacturer) || isDatacom(manufacturer);
}

/**
 * Vendor efetivo do device. `manufacturer` (reportado no Inform) tem
 * prioridade; sem ele (placeholder pré-Inform), infere pelo prefixo do SN
 * GPON ("ZTEG..." = ZTE, "GPON..." = VSOL, "HWTC..." = Huawei). Fallback
 * Huawei — comportamento histórico, sem regressão.
 */
export function vendorFor(
  manufacturer?: string | null,
  snGpon?: string | null,
): Tr069Vendor {
  if (isZyxel(manufacturer)) return 'ZYXEL';
  if (isVsol(manufacturer)) return 'VSOL';
  if (isZte(manufacturer)) return 'ZTE';
  if (isParks(manufacturer)) return 'PARKS';
  if (isNokia(manufacturer)) return 'NOKIA';
  if (isStavixFamily(manufacturer)) return 'STAVIX';
  if (manufacturer) return 'HUAWEI';
  const sn = (snGpon ?? '').toUpperCase();
  if (sn.startsWith('GPON')) return 'VSOL';
  if (sn.startsWith('ZTEG')) return 'ZTE';
  if (sn.startsWith('PRKS')) return 'PARKS';
  if (sn.startsWith('ALCL')) return 'NOKIA';
  // Stavix (MKPG…) e Datacom (DACM…): mesmo HW, mesmo perfil STAVIX.
  if (sn.startsWith('MKPG') || sn.startsWith('DACM')) return 'STAVIX';
  return 'HUAWEI';
}

/**
 * Identidade do placeholder Tr069Device criado ANTES do primeiro Inform
 * (ativação/troca de Wi-Fi). O deviceId real chega no Inform e o ACS regrava;
 * aqui só precisamos de uma chave estável + manufacturer coerente pro registry
 * escolher os paths certos até lá. OUIs: 00259E=Huawei, 006D61=VSOL/Realtek,
 * 6CD2A2=ZTE (a ZTE tem dezenas de OUIs — este é chute estável; o real chega
 * no Inform e o matching é por SN, que na ZTE é o próprio SN GPON "ZTEG...").
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
  if (vendor === 'ZTE') {
    return {
      deviceId: `6CD2A2-${snGpon.toUpperCase()}`,
      manufacturer: 'ZTE',
      oui: '6CD2A2',
      vendor,
    };
  }
  if (vendor === 'PARKS') {
    // OUI Parks = 000416, mas o Inform reporta "416" (sem zero-pad) → o
    // deviceId real é "416-<serial>". O ACS regrava no primeiro Inform e casa
    // por sufixo de serial (como VSOL/Realtek).
    return {
      deviceId: `416-${snGpon.toUpperCase()}`,
      manufacturer: 'PARKS',
      oui: '416',
      vendor,
    };
  }
  if (vendor === 'NOKIA') {
    // Nokia/Alcatel-Lucent têm várias OUIs (D89EF3 é comum nas G-14xx); este é
    // chute estável — o real chega no Inform e o matching é por SUFIXO de serial
    // (o snGpon Nokia é "ALCL<hex>", como a ZTE é "ZTEG..."). manufacturer
    // "Nokia" resolve o registry até lá.
    return {
      deviceId: `D89EF3-${snGpon.toUpperCase()}`,
      manufacturer: 'Nokia',
      oui: 'D89EF3',
      vendor,
    };
  }
  if (vendor === 'STAVIX') {
    // Stavix e Datacom são o MESMO perfil, distintos pelo prefixo do serial:
    // "MKPG…"=Stavix (manufacturer "MKTECH", OUI 0CF0B4) e "DACM…"=Datacom
    // (manufacturer "Datacom", OUI 1881ED). manufacturer coerente resolve o
    // registry pré-Inform; o real chega no Inform e casa por SUFIXO de serial.
    const isDatacomSn = snGpon.toUpperCase().startsWith('DACM');
    return {
      deviceId: `${isDatacomSn ? '1881ED' : '0CF0B4'}-${snGpon.toUpperCase()}`,
      manufacturer: isDatacomSn ? 'Datacom' : 'MKTECH',
      oui: isDatacomSn ? '1881ED' : '0CF0B4',
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

export function provisioningPathsFor(
  vendor: Tr069Vendor,
  productClass?: string | null,
): ProvisioningPaths {
  if (vendor === 'PARKS') {
    // A família (5xx X_RTK vs 6xx X_SKYW) muda WAN, VLAN e índices de WLAN — o
    // productClass discrimina. pppoeVlan vem "" no 6xx (VLAN é do preset OLT).
    return parksProvisioningPaths(parksFamilyFor(productClass));
  }
  if (vendor === 'NOKIA') {
    // G-1426G-A (AX3000): PPPoE na WAN 1, VLAN em X_CT-COM_WANGponLinkConfig,
    // WLAN 1=2.4G/5=5G. Modelo único (por ora) — sem discriminação por productClass.
    return nokiaProvisioningPaths();
  }
  if (vendor === 'STAVIX') {
    // Stavix/Datacom (MP-X4410A): PPPoE na WAN 1, VLAN em X_CT-COM_VLANIDMark na
    // própria WANPPPConnection, WLAN INVERTIDO 1=5G/6=2.4G. Mesmo HW rebrandado —
    // sem discriminação por productClass.
    return stavixProvisioningPaths();
  }
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
  if (vendor === 'ZTE') {
    return {
      ssid24: ZTE_F670L_PATHS.ssid24,
      ssid50: ZTE_F670L_PATHS.ssid50,
      pwd24: ZTE_F670L_PATHS.pwd24,
      pwd50: ZTE_F670L_PATHS.pwd50,
      informInterval: ZTE_F670L_PATHS.informInterval,
      connReqUsername: ZTE_F670L_PATHS.connReqUsername,
      connReqPassword: ZTE_F670L_PATHS.connReqPassword,
      pppoeUsername: ZTE_F670L_PATHS.pppoeUsername,
      pppoePassword: ZTE_F670L_PATHS.pppoePassword,
      pppoeEnable: ZTE_F670L_PATHS.pppoeEnable,
      pppoeVlan: ZTE_F670L_PATHS.pppoeVlan,
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
  if (isZte(manufacturer)) return zteDiagnosticParamNames();
  if (isParks(manufacturer)) return parksDiagnosticParamNames(parksFamilyFor(productClass));
  if (isNokia(manufacturer)) return nokiaDiagnosticParamNames();
  if (isStavixFamily(manufacturer)) return stavixDiagnosticParamNames();
  return huaweiDiagnosticParamNames(productClass);
}

/** Atributos de notificação (SetParameterAttributes) para o fabricante. */
export function notificationAttributesFor(
  manufacturer?: string | null,
  productClass?: string | null,
): Array<{ name: string; notification: 0 | 1 | 2 }> {
  if (isZyxel(manufacturer)) return zyxelNotificationAttributes();
  if (isVsol(manufacturer)) return vsolNotificationAttributes();
  if (isZte(manufacturer)) return zteNotificationAttributes();
  if (isParks(manufacturer)) return parksNotificationAttributes(parksFamilyFor(productClass));
  if (isNokia(manufacturer)) return nokiaNotificationAttributes();
  if (isStavixFamily(manufacturer)) return stavixNotificationAttributes();
  return huaweiNotificationAttributes();
}

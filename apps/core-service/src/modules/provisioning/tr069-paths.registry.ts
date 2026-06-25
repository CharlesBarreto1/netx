/**
 * Resolver de paths TR-069 por fabricante.
 *
 * Hoje os fluxos de diagnóstico/notificação eram hardcoded Huawei — numa Zyxel
 * isso enfileirava paths inexistentes e o CPE devolvia Fault 9005 a cada ciclo.
 * Este registry escolhe a família de paths certa por `manufacturer`; fallback é
 * Huawei (comportamento atual, sem regressão).
 *
 * As REGRAS de conformidade (Tr069Profile) seguem genéricas (usam o `param` da
 * regra), então este resolver cobre só os fluxos imperativos: GET de
 * diagnóstico e SetParameterAttributes (arme de notificação).
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import {
  huaweiDiagnosticParamNames,
  huaweiNotificationAttributes,
} from './tr069-paths.huawei';
import {
  zyxelDiagnosticParamNames,
  zyxelNotificationAttributes,
} from './tr069-paths.zyxel';

/** Casa fabricante por substring case-insensitive (device reporta "ZYXEL"). */
export function isZyxel(manufacturer?: string | null): boolean {
  return (manufacturer ?? '').toLowerCase().includes('zyxel');
}

/** Lista de params do GET_PARAMS de diagnóstico para o fabricante. */
export function diagnosticParamNamesFor(manufacturer?: string | null): string[] {
  return isZyxel(manufacturer) ? zyxelDiagnosticParamNames() : huaweiDiagnosticParamNames();
}

/** Atributos de notificação (SetParameterAttributes) para o fabricante. */
export function notificationAttributesFor(
  manufacturer?: string | null,
): Array<{ name: string; notification: 0 | 1 | 2 }> {
  return isZyxel(manufacturer) ? zyxelNotificationAttributes() : huaweiNotificationAttributes();
}

/**
 * Fachada de licenciamento/entitlement do Core.
 *
 * O `@netx/core-sdk` é o ponto único de import dos primitivos de Core. O
 * licensing REAL continua morando em `@netx/shared/licensing` (verificador
 * Ed25519, catálogo de módulos, decisão de licença) — aqui apenas o
 * reexportamos para que módulos dependam de `@netx/core-sdk` e não fiquem
 * acoplados a `@netx/shared` direto. Comportamento idêntico; é empacotamento.
 *
 * Ver docs/ecosystem/ECOSYSTEM-MODULAR-PLAN.md (Fase 2).
 */

export {
  // catálogo de módulos (fonte única dos códigos)
  MODULE_CODES,
  ALL_MODULE_CODES,
  MODULE_CATALOG,
  isModuleCode,
  // entitlement
  entitledModules,
  isModuleEntitled,
  // token / decisão de licença
  verifyLicenseToken,
  licenseDecision,
  LICENSE_TOKEN_TYP,
  LICENSE_TOKEN_ISS,
  LICENSE_TOKEN_TTL_DAYS,
} from '@netx/shared';

export type {
  ModuleCode,
  ModuleDescriptor,
  LicenseClaims,
  LicenseStatus,
  LicenseBlockMode,
  LicenseEffect,
  LicenseDecision,
  LicenseVerifyResult,
  LicenseVerifyOk,
  LicenseVerifyErr,
} from '@netx/shared';

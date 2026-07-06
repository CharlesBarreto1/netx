/**
 * Catálogo canônico de módulos do ecossistema NetX — a FONTE ÚNICA de verdade
 * dos códigos de módulo, consumida pelos dois lados do contrato de licença:
 *   - o NeX-Hub valida contra esta lista o que vende e carimba no token;
 *   - o Core/NetX valida contra esta lista o que o token habilita (entitlement).
 *
 * Nenhum dos lados inventa código de módulo solto: ambos derivam daqui.
 * Ver docs/ecosystem/ECOSYSTEM-MODULAR-PLAN.md.
 *
 * Dependências entre módulos:
 *   - DURA (hardDeps): o módulo NÃO funciona sem o outro habilitado. Minimizada
 *                      de propósito — hoje nenhum módulo tem dep dura.
 *   - MOLE (softDeps): funciona sozinho; integra mais fundo se o outro estiver
 *                      presente. É onde vive o acoplamento (via eventos).
 */

export const MODULE_CODES = [
  'netx-erp',
  'netx-nms',
  'netx-monitor',
  'netx-cpe',
  'netx-ai',
  'netx-rh',
  'netx-maps',
  'netx-call',
  'netx-fibermap',
] as const;

export type ModuleCode = (typeof MODULE_CODES)[number];

/** Todos os códigos do catálogo. */
export const ALL_MODULE_CODES: readonly ModuleCode[] = MODULE_CODES;

export interface ModuleDescriptor {
  code: ModuleCode;
  /** Nome legível pro painel do Hub e telas internas. */
  name: string;
  /** Dep DURA: precisa estar habilitada+presente. Hoje sempre vazio. */
  hardDeps: ModuleCode[];
  /** Dep MOLE: integra mais fundo se presente; funciona sem. */
  softDeps: ModuleCode[];
}

export const MODULE_CATALOG: Record<ModuleCode, ModuleDescriptor> = {
  'netx-erp': { code: 'netx-erp', name: 'ERP base', hardDeps: [], softDeps: [] },
  'netx-nms': { code: 'netx-nms', name: 'NMS', hardDeps: [], softDeps: ['netx-erp'] },
  'netx-monitor': {
    code: 'netx-monitor',
    name: 'Monitoramento',
    hardDeps: [],
    softDeps: ['netx-nms'],
  },
  'netx-cpe': {
    code: 'netx-cpe',
    name: 'TR-069 + OLTs',
    hardDeps: [],
    softDeps: ['netx-erp', 'netx-nms'],
  },
  'netx-ai': {
    code: 'netx-ai',
    name: 'Motor de IA',
    hardDeps: [],
    // "todos" os demais módulos
    softDeps: ['netx-erp', 'netx-nms', 'netx-monitor', 'netx-cpe', 'netx-rh', 'netx-maps', 'netx-call'],
  },
  'netx-rh': { code: 'netx-rh', name: 'RH/portal', hardDeps: [], softDeps: ['netx-erp'] },
  'netx-maps': { code: 'netx-maps', name: 'Mapa de clientes', hardDeps: [], softDeps: ['netx-nms'] },
  'netx-call': {
    code: 'netx-call',
    name: 'Callcenter',
    hardDeps: [],
    softDeps: ['netx-erp', 'netx-ai'],
  },
  // FiberMap — documentação de planta externa (OSP v2, FIBERMAP-SPEC.md).
  // Sucessor do OSP embutido em netx-maps; integra mais fundo com CPE (OLTs).
  'netx-fibermap': {
    code: 'netx-fibermap',
    name: 'FiberMap — planta externa',
    hardDeps: [],
    softDeps: ['netx-erp', 'netx-cpe', 'netx-maps'],
  },
};

export function isModuleCode(v: unknown): v is ModuleCode {
  return typeof v === 'string' && (MODULE_CODES as readonly string[]).includes(v);
}

/**
 * Módulos que o token habilita. Regra de COMPATIBILIDADE (lockstep):
 *
 * token SEM o claim `modules` (ou vazio) ⇒ catálogo INTEIRO habilitado. É o
 * comportamento da instância legada (monolito tudo-ligado) e o que mantém a
 * produção intacta enquanto o Hub ainda não carimba módulos.
 *
 * Códigos desconhecidos são filtrados (defensivo contra drift de catálogo): se
 * um token lista só códigos que este cliente não conhece (cliente atrás do
 * Hub), preferimos liberar tudo a bloquear um cliente pagante.
 */
export function entitledModules(
  claims: { modules?: readonly string[] } | null | undefined,
): ModuleCode[] {
  const list = claims?.modules;
  if (!list || list.length === 0) return [...ALL_MODULE_CODES];
  const valid = list.filter(isModuleCode);
  return valid.length ? valid : [...ALL_MODULE_CODES];
}

export function isModuleEntitled(
  claims: { modules?: readonly string[] } | null | undefined,
  code: ModuleCode,
): boolean {
  return entitledModules(claims).includes(code);
}

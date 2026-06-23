/**
 * Manifesto de módulo — o descritor de catálogo (`code`/`name`/deps) ENRIQUECIDO
 * com os metadados de runtime que os invariantes exigem:
 *   - `apiPrefix`  → por onde o módulo expõe HTTP (invariante 2d);
 *   - `ownedTables`→ tabelas Postgres das quais é DONO exclusivo (invariante 3);
 *   - `emits`/`consumes` → seu contrato de eventos no bus (invariante 2c / Fase 3).
 *
 * É ADITIVO e no-op em runtime: por default todo módulo do catálogo tem um
 * manifesto "vazio" (sem prefixo/tabelas/eventos declarados). Cada módulo pode
 * registrar o seu via `defineModule()` à medida que as costuras forem
 * formalizadas. Nada aqui liga/desliga código — é metadado declarativo,
 * consumido por tooling, guards e pelo bus.
 *
 * Ver docs/ecosystem/ECOSYSTEM-MODULAR-PLAN.md (Fase 2).
 */

import { MODULE_CATALOG, MODULE_CODES, type ModuleCode, type ModuleDescriptor } from '@netx/shared';

/** Metadados de runtime de um módulo, somados ao descritor de catálogo. */
export interface ModuleRuntimeMeta {
  /**
   * Prefixos HTTP sob os quais as rotas do módulo vivem (invariante 2d).
   * `undefined`/vazio = sem rotas próprias. Um módulo pode expor mais de um
   * prefixo (ex.: netx-cpe → olts, provisioning, tr069).
   */
  apiPrefixes?: string[];
  /** Tabelas Postgres das quais este módulo é DONO exclusivo (sem escrita cross-módulo). */
  ownedTables?: string[];
  /** Tipos de evento que o módulo PUBLICA no bus (convenção `<módulo>.<entidade>.<ação>`). */
  emits?: string[];
  /** Tipos de evento que o módulo CONSOME do bus. */
  consumes?: string[];
}

export type ModuleManifest = ModuleDescriptor & ModuleRuntimeMeta;

/** Metadados de runtime declarados por módulo (sobrepostos ao catálogo). */
const RUNTIME_META: Partial<Record<ModuleCode, ModuleRuntimeMeta>> = {};

/**
 * Declara (ou redeclara) os metadados de runtime de um módulo. Aditivo: o
 * descritor de catálogo (code/name/deps) é a base imutável; aqui só anexamos
 * prefixo HTTP, tabelas próprias e contrato de eventos. Retorna o manifesto
 * efetivo resultante.
 */
export function defineModule(code: ModuleCode, meta: ModuleRuntimeMeta): ModuleManifest {
  RUNTIME_META[code] = { ...RUNTIME_META[code], ...meta };
  return getManifest(code);
}

/** Manifesto efetivo: descritor do catálogo + metadados de runtime declarados (ou vazios). */
export function getManifest(code: ModuleCode): ModuleManifest {
  return { ...MODULE_CATALOG[code], ...(RUNTIME_META[code] ?? {}) };
}

/** Todos os manifestos efetivos, na ordem do catálogo. */
export function allManifests(): ModuleManifest[] {
  return MODULE_CODES.map(getManifest);
}

/**
 * Ordem de inicialização respeitando deps DURAS (um módulo sobe depois das suas
 * `hardDeps`). Hoje todas vazias ⇒ ordem do catálogo. Topológica; lança em ciclo.
 */
export function resolveLoadOrder(codes: readonly ModuleCode[] = MODULE_CODES): ModuleCode[] {
  const order: ModuleCode[] = [];
  const done = new Set<ModuleCode>();
  const visiting = new Set<ModuleCode>();

  const visit = (code: ModuleCode): void => {
    if (done.has(code)) return;
    if (visiting.has(code)) throw new Error(`ciclo de hardDeps detectado em "${code}"`);
    visiting.add(code);
    for (const dep of MODULE_CATALOG[code].hardDeps) {
      if (codes.includes(dep)) visit(dep);
    }
    visiting.delete(code);
    done.add(code);
    order.push(code);
  };

  for (const code of codes) visit(code);
  return order;
}

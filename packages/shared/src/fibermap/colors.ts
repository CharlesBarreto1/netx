/**
 * FiberMap — padrões de cor de fibra/tubo (ABNT NBR 14700 e EIA/TIA-598).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Spec: FIBERMAP-SPEC.md §2. Este arquivo é a FONTE ÚNICA da lógica de cores:
 * o backend a usa pra instanciar tubos/fibras de um cabo a partir do modelo do
 * catálogo; o frontend a usa pro preview do corte transversal (Tela 3) e pro
 * editor de emendas renderizar a cor real de cada fibra.
 *
 * Regras (spec §2):
 *  - As FIBRAS dentro de cada tubo seguem SEMPRE o ciclo de 12 cores do padrão
 *    do modelo, truncado em fibersPerTube (6 fibras ABNT → Verde…Violeta).
 *  - Os TUBOS dependem do esquema:
 *      STANDARD_CYCLE    → ciclo de 12 cores do padrão;
 *      PILOT_DIRECTIONAL → tubo 1 Verde (piloto), tubo 2 Amarela (direcional),
 *                          demais Branca/Natural — EM AMBOS os padrões
 *                          (convenção de campo, spec §3.2 notas do seed);
 *      CUSTOM            → lista explícita, validada.
 *  - Tubos brancos são ambíguos por cor ⇒ a UI SEMPRE exibe o número do tubo.
 */

// =============================================================================
// Códigos de cor (estáveis — persistidos no banco como texto)
// =============================================================================
export const FIBERMAP_COLOR_CODES = [
  'VERDE',
  'AMARELA',
  'BRANCA',
  'AZUL',
  'VERMELHA',
  'VIOLETA',
  'MARROM',
  'ROSA',
  'PRETA',
  'CINZA',
  'LARANJA',
  'AGUA_MARINHA',
] as const;
export type FibermapColorCode = (typeof FIBERMAP_COLOR_CODES)[number];

export const FIBERMAP_COLOR_STANDARDS = ['ABNT', 'EIA598'] as const;
export type FibermapColorStandard = (typeof FIBERMAP_COLOR_STANDARDS)[number];

export const FIBERMAP_TUBE_SCHEMES = [
  'STANDARD_CYCLE',
  'PILOT_DIRECTIONAL',
  'CUSTOM',
] as const;
export type FibermapTubeScheme = (typeof FIBERMAP_TUBE_SCHEMES)[number];

// -----------------------------------------------------------------------------
// Ciclos de 12 cores por padrão (spec §2)
// -----------------------------------------------------------------------------
/** ABNT NBR 14700: 1 Verde, 2 Amarela, 3 Branca, 4 Azul, 5 Vermelha, 6 Violeta,
 *  7 Marrom, 8 Rosa, 9 Preta, 10 Cinza, 11 Laranja, 12 Água-marinha. */
export const ABNT_COLOR_CYCLE: readonly FibermapColorCode[] = [
  'VERDE',
  'AMARELA',
  'BRANCA',
  'AZUL',
  'VERMELHA',
  'VIOLETA',
  'MARROM',
  'ROSA',
  'PRETA',
  'CINZA',
  'LARANJA',
  'AGUA_MARINHA',
];

/** EIA/TIA-598: 1 Azul, 2 Laranja, 3 Verde, 4 Marrom, 5 Cinza, 6 Branca,
 *  7 Vermelha, 8 Preta, 9 Amarela, 10 Violeta, 11 Rosa, 12 Água-marinha. */
export const EIA598_COLOR_CYCLE: readonly FibermapColorCode[] = [
  'AZUL',
  'LARANJA',
  'VERDE',
  'MARROM',
  'CINZA',
  'BRANCA',
  'VERMELHA',
  'PRETA',
  'AMARELA',
  'VIOLETA',
  'ROSA',
  'AGUA_MARINHA',
];

export function fibermapColorCycle(
  standard: FibermapColorStandard,
): readonly FibermapColorCode[] {
  return standard === 'ABNT' ? ABNT_COLOR_CYCLE : EIA598_COLOR_CYCLE;
}

// -----------------------------------------------------------------------------
// Apresentação (UI) — hex de render + rótulos PT (campo fala português)
// -----------------------------------------------------------------------------
/** Hex aproximado pra render. BRANCA se renderiza com contorno (spec §2). */
export const FIBERMAP_COLOR_HEX: Record<FibermapColorCode, string> = {
  VERDE: '#16a34a',
  AMARELA: '#eab308',
  BRANCA: '#f8fafc',
  AZUL: '#2563eb',
  VERMELHA: '#dc2626',
  VIOLETA: '#7c3aed',
  MARROM: '#92400e',
  ROSA: '#ec4899',
  PRETA: '#171717',
  CINZA: '#6b7280',
  LARANJA: '#ea580c',
  AGUA_MARINHA: '#2dd4bf',
};

export const FIBERMAP_COLOR_LABELS_PT: Record<FibermapColorCode, string> = {
  VERDE: 'Verde',
  AMARELA: 'Amarela',
  BRANCA: 'Branca',
  AZUL: 'Azul',
  VERMELHA: 'Vermelha',
  VIOLETA: 'Violeta',
  MARROM: 'Marrom',
  ROSA: 'Rosa',
  PRETA: 'Preta',
  CINZA: 'Cinza',
  LARANJA: 'Laranja',
  AGUA_MARINHA: 'Água-marinha',
};

// =============================================================================
// Estrutura do cabo
// =============================================================================
export interface FibermapCableStructure {
  fiberCount: number;
  tubeCount: number;
  fibersPerTube: number;
}

/** Valida a invariante do catálogo: fiberCount = tubeCount × fibersPerTube. */
export function isValidCableStructure(s: FibermapCableStructure): boolean {
  return (
    Number.isInteger(s.fiberCount) &&
    Number.isInteger(s.tubeCount) &&
    Number.isInteger(s.fibersPerTube) &&
    s.tubeCount >= 1 &&
    s.fibersPerTube >= 1 &&
    s.fiberCount >= 1 &&
    s.fiberCount === s.tubeCount * s.fibersPerTube
  );
}

/** Cor da fibra pela posição DENTRO do tubo (1-based), ciclo do padrão. */
export function fiberColorAt(
  standard: FibermapColorStandard,
  fiberInTube: number,
): FibermapColorCode {
  const cycle = fibermapColorCycle(standard);
  return cycle[(fiberInTube - 1) % cycle.length];
}

export interface BuildTubeColorsInput {
  scheme: FibermapTubeScheme;
  standard: FibermapColorStandard;
  tubeCount: number;
  /** Obrigatório (e só usado) quando scheme=CUSTOM: uma cor por tubo. */
  customColors?: FibermapColorCode[];
}

/**
 * Cores dos tubos 1..tubeCount conforme o esquema (spec §2).
 * Lança em CUSTOM inválido — o service converte pra erro 400.
 */
export function buildTubeColors(input: BuildTubeColorsInput): FibermapColorCode[] {
  const { scheme, standard, tubeCount } = input;
  if (!Number.isInteger(tubeCount) || tubeCount < 1) {
    throw new Error(`tubeCount inválido: ${tubeCount}`);
  }
  if (scheme === 'CUSTOM') {
    const list = input.customColors ?? [];
    if (list.length !== tubeCount) {
      throw new Error(
        `CUSTOM exige exatamente ${tubeCount} cores de tubo (recebeu ${list.length})`,
      );
    }
    for (const c of list) {
      if (!FIBERMAP_COLOR_CODES.includes(c)) {
        throw new Error(`cor de tubo desconhecida: ${c}`);
      }
    }
    return [...list];
  }
  if (scheme === 'PILOT_DIRECTIONAL') {
    // Piloto/direcional: verde, amarela, demais brancas — nos DOIS padrões.
    return Array.from({ length: tubeCount }, (_, i) =>
      i === 0 ? 'VERDE' : i === 1 ? 'AMARELA' : 'BRANCA',
    );
  }
  const cycle = fibermapColorCycle(standard);
  return Array.from({ length: tubeCount }, (_, i) => cycle[i % cycle.length]);
}

export interface FibermapFiberLayoutItem {
  /** Número do tubo, 1-based. */
  tubeNumber: number;
  /** Número GLOBAL da fibra no cabo, 1-based (imutável — spec §14.3). */
  fiberNumber: number;
  /** Posição da fibra dentro do tubo, 1-based. */
  fiberInTube: number;
  color: FibermapColorCode;
}

/**
 * Layout completo das fibras de um cabo instanciado a partir do modelo:
 * numeração global sequencial (tubo 1 fibras 1..N, tubo 2 fibras N+1..2N, …)
 * e cor pelo ciclo do padrão truncado em fibersPerTube.
 */
export function buildCableFiberLayout(
  structure: FibermapCableStructure,
  standard: FibermapColorStandard,
): FibermapFiberLayoutItem[] {
  if (!isValidCableStructure(structure)) {
    throw new Error(
      `estrutura inválida: ${structure.fiberCount} ≠ ${structure.tubeCount} × ${structure.fibersPerTube}`,
    );
  }
  const out: FibermapFiberLayoutItem[] = [];
  for (let tube = 1; tube <= structure.tubeCount; tube++) {
    for (let f = 1; f <= structure.fibersPerTube; f++) {
      out.push({
        tubeNumber: tube,
        fiberNumber: (tube - 1) * structure.fibersPerTube + f,
        fiberInTube: f,
        color: fiberColorAt(standard, f),
      });
    }
  }
  return out;
}

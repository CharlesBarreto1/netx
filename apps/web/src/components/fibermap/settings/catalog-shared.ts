/**
 * Helpers e constantes compartilhados da Tela 3 do FiberMap (FM-1) —
 * Configurações do Mapa (catálogo de produtos + parâmetros).
 *
 * Puro TS (sem React) — consumido por CatalogTab / forms / preview.
 * Fonte de dados: apps/web/src/lib/fibermap-api.ts (único client do módulo).
 */
import {
  FIBERMAP_COLOR_HEX,
  type FibermapColorCode,
  type FibermapProductType,
} from '@/lib/fibermap-api';

/** Ordem canônica das sub-abas do catálogo (spec §10). */
export const FIBERMAP_CATEGORIES: readonly FibermapProductType[] = [
  'CABLE',
  'SPLICE_CLOSURE',
  'TERMINATION_BOX',
  'DIO',
  'CABINET',
  'INDOOR_RACK',
  'SPLITTER',
] as const;

export type FibermapNonCableType = Exclude<FibermapProductType, 'CABLE'>;

export type CatalogFormMode = 'create' | 'edit' | 'duplicate';

export const SPLITTER_RATIOS = [
  '1x2',
  '1x4',
  '1x8',
  '1x16',
  '1x32',
  '1x64',
] as const;

/** Limites de sanidade da estrutura de cabo (validação + preview SVG). */
export const CABLE_LIMITS = {
  maxTubes: 36,
  maxFibersPerTube: 24,
} as const;

// ─── Parse seguro de inputs controlados (strings → números) ────────────────

/** Inteiro não-negativo estrito ('12' → 12; '12.5' | '' | 'abc' → null). */
export function toInt(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/** Decimal finito; aceita vírgula como separador ('1,02' → 1.02). */
export function toDecimal(raw: string): number | null {
  const s = raw.trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Valida um código de cor persistido (cable_model_tube.color é string). */
export function asColorCode(raw: string): FibermapColorCode | null {
  return Object.prototype.hasOwnProperty.call(FIBERMAP_COLOR_HEX, raw)
    ? (raw as FibermapColorCode)
    : null;
}

// ─── Leitores de `specs` (jsonb — validação leve, spec §3.2) ────────────────

export function specInt(
  specs: Record<string, unknown>,
  key: string,
): number | null {
  const v = specs[key];
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

export function specStr(
  specs: Record<string, unknown>,
  key: string,
): string | null {
  const v = specs[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function specBool(
  specs: Record<string, unknown>,
  key: string,
): boolean | null {
  const v = specs[key];
  return typeof v === 'boolean' ? v : null;
}

// ─── Config declarativa dos forms das categorias não-cabo (spec §3.2) ───────

export type SpecFormValues = Record<string, string | boolean>;

interface SpecFieldBase {
  /** Chave dentro de `product.specs` (snake_case — contrato do backend). */
  key: string;
  /** Chave i18n do label (namespace `fibermap`). */
  labelKey: string;
  helpKey?: string;
  /** Campo condicional (ex.: tap_percent só quando UNBALANCED). */
  visibleIf?: (values: SpecFormValues) => boolean;
}

export type SpecFieldDef =
  | (SpecFieldBase & { kind: 'int'; min: number; max: number })
  | (SpecFieldBase & { kind: 'text'; placeholder?: string })
  | (SpecFieldBase & { kind: 'bool' })
  | (SpecFieldBase & {
      kind: 'select';
      options: ReadonlyArray<{
        value: string;
        /** Label traduzido… */
        labelKey?: string;
        /** …ou literal (ex.: razões de splitter '1x8'). */
        label?: string;
      }>;
    });

export const SPEC_FIELDS: Record<FibermapNonCableType, readonly SpecFieldDef[]> = {
  SPLICE_CLOSURE: [
    { kind: 'int', key: 'trays', labelKey: 'settings.specs.trays', min: 1, max: 48 },
    { kind: 'int', key: 'splices_per_tray', labelKey: 'settings.specs.splicesPerTray', min: 1, max: 144 },
    { kind: 'int', key: 'cable_entries', labelKey: 'settings.specs.cableEntries', min: 1, max: 64 },
    {
      kind: 'select',
      key: 'mount',
      labelKey: 'settings.specs.mountLabel',
      options: [
        { value: 'AEREA', labelKey: 'settings.specs.mountOptions.AEREA' },
        { value: 'SUBTERRANEA', labelKey: 'settings.specs.mountOptions.SUBTERRANEA' },
      ],
    },
  ],
  TERMINATION_BOX: [
    { kind: 'int', key: 'drop_ports', labelKey: 'settings.specs.dropPorts', min: 1, max: 256 },
    { kind: 'text', key: 'connector', labelKey: 'settings.specs.connector', placeholder: 'SC/APC' },
    { kind: 'bool', key: 'supports_splitter', labelKey: 'settings.specs.supportsSplitter' },
    { kind: 'int', key: 'splice_capacity', labelKey: 'settings.specs.spliceCapacity', min: 0, max: 288 },
  ],
  DIO: [
    { kind: 'int', key: 'ports', labelKey: 'settings.specs.ports', min: 1, max: 576 },
    { kind: 'text', key: 'connector', labelKey: 'settings.specs.connector', placeholder: 'SC/APC' },
    { kind: 'int', key: 'trays', labelKey: 'settings.specs.trays', min: 1, max: 48 },
    { kind: 'int', key: 'rack_units', labelKey: 'settings.specs.rackUnits', min: 1, max: 48 },
  ],
  CABINET: [
    { kind: 'int', key: 'rack_units', labelKey: 'settings.specs.rackUnits', min: 1, max: 60 },
    { kind: 'bool', key: 'outdoor', labelKey: 'settings.specs.outdoor' },
  ],
  INDOOR_RACK: [
    { kind: 'int', key: 'rack_units', labelKey: 'settings.specs.rackUnits', min: 1, max: 60 },
  ],
  SPLITTER: [
    {
      kind: 'select',
      key: 'ratio',
      labelKey: 'settings.specs.ratio',
      options: SPLITTER_RATIOS.map((r) => ({ value: r, label: r })),
    },
    {
      kind: 'select',
      key: 'topology',
      labelKey: 'settings.specs.topology',
      options: [
        { value: 'BALANCED', labelKey: 'settings.specs.topologyOptions.BALANCED' },
        { value: 'UNBALANCED', labelKey: 'settings.specs.topologyOptions.UNBALANCED' },
      ],
    },
    {
      kind: 'int',
      key: 'tap_percent',
      labelKey: 'settings.specs.tapPercent',
      min: 1,
      max: 50,
      helpKey: 'settings.specs.tapPercentHelp',
      visibleIf: (values) => values['topology'] === 'UNBALANCED',
    },
    { kind: 'bool', key: 'connectorized', labelKey: 'settings.specs.connectorized' },
  ],
};

/** Defaults sensatos pro modo "criar" (espelham a fixture FM-0). */
export const SPEC_DEFAULTS: Record<FibermapNonCableType, SpecFormValues> = {
  SPLICE_CLOSURE: { trays: '4', splices_per_tray: '12', cable_entries: '8', mount: 'AEREA' },
  TERMINATION_BOX: { drop_ports: '16', connector: 'SC/APC', supports_splitter: true, splice_capacity: '12' },
  DIO: { ports: '24', connector: 'SC/APC', trays: '2', rack_units: '1' },
  CABINET: { rack_units: '12', outdoor: true },
  INDOOR_RACK: { rack_units: '44' },
  SPLITTER: { ratio: '1x8', topology: 'BALANCED', tap_percent: '10', connectorized: true },
};

/** Converte `product.specs` (jsonb) nos valores controlados do form. */
export function specsToFormValues(
  type: FibermapNonCableType,
  specs: Record<string, unknown>,
): SpecFormValues {
  const out: SpecFormValues = {};
  for (const field of SPEC_FIELDS[type]) {
    const fallback = SPEC_DEFAULTS[type][field.key];
    if (field.kind === 'bool') {
      out[field.key] = specBool(specs, field.key) ?? fallback === true;
      continue;
    }
    if (field.kind === 'int') {
      const n = specInt(specs, field.key);
      out[field.key] = n !== null ? String(n) : typeof fallback === 'string' ? fallback : '';
      continue;
    }
    // text | select
    const s = specStr(specs, field.key);
    out[field.key] = s ?? (typeof fallback === 'string' ? fallback : '');
  }
  return out;
}

/**
 * Seed do catálogo FiberMap (FM-0) — lineup oficial de cabos + demais
 * categorias + defaults de atenuação (FIBERMAP-SPEC.md §3.2, §5.3).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Idempotente por tenant: produto identificado por (type, manufacturer, name);
 * se já existe, NÃO é tocado (instâncias dependem do snapshot). Atenuação:
 * create-if-missing, nunca sobrescreve edição do tenant.
 *
 * ATENÇÃO: importa @netx/shared (resolve pra packages/shared/dist) — o build
 * do shared precisa rodar antes do seed (`npx tsc -p packages/shared`).
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  FIBERMAP_ATTENUATION_DEFAULTS,
  FIBERMAP_ATTENUATION_KEYS,
  buildTubeColors,
  type FibermapColorStandard,
  type FibermapTubeScheme,
} from '@netx/shared';

const MANUFACTURER = 'Padrão';

interface CableSeed {
  baseName: string;
  fiberCount: number;
  tubeCount: number;
  fibersPerTube: number;
  tubeScheme: FibermapTubeScheme;
  cableClass: string;
}

// Lineup oficial (spec §3.2) — cada modelo vira 2 produtos: (ABNT) e (EIA/TIA).
const CABLE_LINEUP: CableSeed[] = [
  { baseName: 'ASU 2FO', fiberCount: 2, tubeCount: 1, fibersPerTube: 2, tubeScheme: 'STANDARD_CYCLE', cableClass: 'ASU' },
  { baseName: 'ASU 4FO', fiberCount: 4, tubeCount: 1, fibersPerTube: 4, tubeScheme: 'STANDARD_CYCLE', cableClass: 'ASU' },
  { baseName: 'ASU 6FO', fiberCount: 6, tubeCount: 1, fibersPerTube: 6, tubeScheme: 'STANDARD_CYCLE', cableClass: 'ASU' },
  { baseName: 'ASU 12FO', fiberCount: 12, tubeCount: 1, fibersPerTube: 12, tubeScheme: 'STANDARD_CYCLE', cableClass: 'ASU' },
  // ASU 24FO seedado como 2×12 (construção usual; ajustável no catálogo).
  { baseName: 'ASU 24FO', fiberCount: 24, tubeCount: 2, fibersPerTube: 12, tubeScheme: 'PILOT_DIRECTIONAL', cableClass: 'ASU' },
  { baseName: 'AS 24FO', fiberCount: 24, tubeCount: 4, fibersPerTube: 6, tubeScheme: 'PILOT_DIRECTIONAL', cableClass: 'AS' },
  { baseName: 'AS 36FO', fiberCount: 36, tubeCount: 6, fibersPerTube: 6, tubeScheme: 'PILOT_DIRECTIONAL', cableClass: 'AS' },
  { baseName: 'AS 48FO', fiberCount: 48, tubeCount: 4, fibersPerTube: 12, tubeScheme: 'PILOT_DIRECTIONAL', cableClass: 'AS' },
  { baseName: 'AS 72FO', fiberCount: 72, tubeCount: 6, fibersPerTube: 12, tubeScheme: 'PILOT_DIRECTIONAL', cableClass: 'AS' },
  { baseName: 'AS 144FO', fiberCount: 144, tubeCount: 12, fibersPerTube: 12, tubeScheme: 'PILOT_DIRECTIONAL', cableClass: 'AS' },
  { baseName: 'DROP 1FO', fiberCount: 1, tubeCount: 1, fibersPerTube: 1, tubeScheme: 'STANDARD_CYCLE', cableClass: 'DROP' },
];

const STANDARD_SUFFIX: Record<FibermapColorStandard, string> = {
  ABNT: '(ABNT)',
  EIA598: '(EIA/TIA)',
};

// Demais categorias — 1 produto de cada pra fixture (spec §3.2 notas).
const OTHER_PRODUCTS: Array<{
  type: 'SPLICE_CLOSURE' | 'TERMINATION_BOX' | 'DIO' | 'CABINET' | 'INDOOR_RACK' | 'SPLITTER';
  name: string;
  specs: Record<string, unknown>;
}> = [
  {
    type: 'SPLICE_CLOSURE',
    name: 'CEO 24 fusões',
    specs: { trays: 2, splices_per_tray: 12, cable_entries: 4, mount: 'AEREA' },
  },
  {
    type: 'TERMINATION_BOX',
    name: 'CTO 16 portas',
    specs: { drop_ports: 16, connector: 'SC/APC', supports_splitter: true, splice_capacity: 12 },
  },
  {
    type: 'DIO',
    name: 'DIO 24 portas',
    specs: { ports: 24, connector: 'SC/APC', trays: 2, rack_units: 1 },
  },
  {
    type: 'CABINET',
    name: 'Armário de rua 12U',
    specs: { rack_units: 12, outdoor: true },
  },
  {
    type: 'INDOOR_RACK',
    name: 'Rack interno 44U',
    specs: { rack_units: 44 },
  },
  {
    type: 'SPLITTER',
    name: 'Splitter 1x8 conectorizado',
    specs: { ratio: '1x8', topology: 'BALANCED', connectorized: true },
  },
  {
    type: 'SPLITTER',
    name: 'Splitter 1x16 conectorizado',
    specs: { ratio: '1x16', topology: 'BALANCED', connectorized: true },
  },
];

export interface FibermapCatalogSeedSummary {
  productsCreated: number;
  attenuationCreated: number;
}

export async function seedFibermapCatalog(
  prisma: PrismaClient,
  tenantId: string,
): Promise<FibermapCatalogSeedSummary> {
  let productsCreated = 0;

  // ── Cabos: 11 modelos × 2 padrões de cor ─────────────────────────────────
  for (const model of CABLE_LINEUP) {
    for (const standard of ['ABNT', 'EIA598'] as const) {
      const name = `${model.baseName} ${STANDARD_SUFFIX[standard]}`;
      const existing = await prisma.fibermapProduct.findUnique({
        where: {
          tenantId_type_manufacturer_name: {
            tenantId,
            type: 'CABLE',
            manufacturer: MANUFACTURER,
            name,
          },
        },
        select: { id: true },
      });
      if (existing) continue;

      const tubeColors = buildTubeColors({
        scheme: model.tubeScheme,
        standard,
        tubeCount: model.tubeCount,
      });

      await prisma.$transaction(async (tx) => {
        const product = await tx.fibermapProduct.create({
          data: {
            tenantId,
            type: 'CABLE',
            manufacturer: MANUFACTURER,
            name,
            description: `${model.cableClass} ${model.fiberCount}FO — ${model.tubeCount} tubo(s) × ${model.fibersPerTube} fibras (seed FM-0)`,
          },
        });
        await tx.fibermapCableModel.create({
          data: {
            productId: product.id,
            tenantId,
            fiberCount: model.fiberCount,
            tubeCount: model.tubeCount,
            fibersPerTube: model.fibersPerTube,
            colorStandard: standard,
            tubeScheme: model.tubeScheme,
            excessFactor: new Prisma.Decimal('1.0200'),
            cableClass: model.cableClass,
          },
        });
        await tx.fibermapCableModelTube.createMany({
          data: tubeColors.map((color, i) => ({
            cableModelId: product.id,
            tubeNumber: i + 1,
            color,
          })),
        });
      });
      productsCreated++;
    }
  }

  // ── Demais categorias ────────────────────────────────────────────────────
  for (const p of OTHER_PRODUCTS) {
    const res = await prisma.fibermapProduct.createMany({
      data: [
        {
          tenantId,
          type: p.type,
          manufacturer: MANUFACTURER,
          name: p.name,
          specs: p.specs as Prisma.InputJsonValue,
        },
      ],
      skipDuplicates: true,
    });
    productsCreated += res.count;
  }

  // ── Defaults de atenuação (pinados por tenant; nunca sobrescreve) ────────
  let attenuationCreated = 0;
  for (const itemKey of FIBERMAP_ATTENUATION_KEYS) {
    const res = await prisma.fibermapAttenuationDefault.createMany({
      data: [
        {
          tenantId,
          itemKey,
          valueDb: new Prisma.Decimal(FIBERMAP_ATTENUATION_DEFAULTS[itemKey]),
        },
      ],
      skipDuplicates: true,
    });
    attenuationCreated += res.count;
  }

  return { productsCreated, attenuationCreated };
}

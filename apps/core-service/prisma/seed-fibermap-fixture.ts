/**
 * Fixture de demonstração FiberMap (FM-0) — FIBERMAP-SPEC.md §13.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Carrega no tenant `default` uma mini-planta:
 *   1 POP (rack 44U + DIO 24p + OLT 16 PONs), 3 CEOs, 4 CTOs, 1 poste,
 *   3 cabos instanciados do seed — ASU 12FO (ABNT), AS 36FO (ABNT) e
 *   AS 48FO (EIA/TIA) —, fusões OLT→DIO→cabo→cabo→splitter 1x8, 1 corte
 *   (tesoura) e 2 reservas técnicas.
 *
 * É a base de todos os testes das fases FM-1..FM-6 e do dev do frontend.
 * Idempotente: se a pasta da fixture já existe, pula a criação — mas SEMPRE
 * roda as asserções de aceite do FM-0 no que está no banco:
 *   - AS 36FO (ABNT) → 6 tubos (Verde, Amarela, 4× Branca), fibras Verde…Violeta
 *   - AS 48FO (EIA/TIA) → 4 tubos, 12 fibras/tubo Azul…Água-marinha
 *   - constraint impede fusão duplicada na mesma ponta (P2002)
 *   - triggers PostGIS preencheram geom + geometric_length_m
 *
 * Run:  npm run -w apps/core-service db:seed:fibermap
 */
import { Prisma, PrismaClient } from '@prisma/client';
import {
  fibermapCutEndKey,
  fibermapFiberEndKey,
  fibermapPortKey,
} from '@netx/shared';

import { instantiateCableFromModel } from '../src/modules/fibermap/instantiate-cable';

const prisma = new PrismaClient();

const FOLDER_NAME = 'FiberMap — Fixture';

// Coordenadas plausíveis (Campo Mourão/PR) — só demonstração.
const COORDS = {
  pop: { lat: -24.0460, lng: -52.3780 },
  ceo11: { lat: -24.0490, lng: -52.3745 },
  ceo12: { lat: -24.0525, lng: -52.3710 },
  ceo13: { lat: -24.0560, lng: -52.3672 },
  cto01: { lat: -24.0585, lng: -52.3650 },
  cto02: { lat: -24.0505, lng: -52.3690 },
  cto03: { lat: -24.0575, lng: -52.3620 },
  cto04: { lat: -24.0545, lng: -52.3745 },
  poste118: { lat: -24.0472, lng: -52.3764 },
} as const;

type LatLng = { lat: number; lng: number };
/** GeoJSON coordinates: [[lng, lat], ...] — mesma convenção do repo. */
function pathOf(...points: LatLng[]): number[][] {
  return points.map((p) => [p.lng, p.lat]);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ACEITE FM-0 FALHOU: ${msg}`);
}

async function findProduct(tenantId: string, type: string, name: string) {
  const p = await prisma.fibermapProduct.findFirst({
    where: { tenantId, type: type as never, name, deletedAt: null },
    select: { id: true },
  });
  if (!p) {
    throw new Error(
      `Produto do seed não encontrado: ${type} "${name}" — rode npm run db:seed antes`,
    );
  }
  return p.id;
}

async function loadFixture(tenantId: string, actorId: string | null) {
  const ceoProd = await findProduct(tenantId, 'SPLICE_CLOSURE', 'CEO 24 fusões');
  const ctoProd = await findProduct(tenantId, 'TERMINATION_BOX', 'CTO 16 portas');
  const dioProd = await findProduct(tenantId, 'DIO', 'DIO 24 portas');
  const rackProd = await findProduct(tenantId, 'INDOOR_RACK', 'Rack interno 44U');
  const sp8Prod = await findProduct(tenantId, 'SPLITTER', 'Splitter 1x8 conectorizado');
  const asu12Abnt = await findProduct(tenantId, 'CABLE', 'ASU 12FO (ABNT)');
  const as36Abnt = await findProduct(tenantId, 'CABLE', 'AS 36FO (ABNT)');
  const as48Eia = await findProduct(tenantId, 'CABLE', 'AS 48FO (EIA/TIA)');

  const folder = await prisma.fibermapFolder.create({
    data: { tenantId, name: FOLDER_NAME, createdById: actorId },
  });

  // ── Elementos ────────────────────────────────────────────────────────────
  const el = async (
    type: 'POP' | 'CEO' | 'CTO' | 'POLE',
    name: string,
    c: LatLng,
    productId: string | null,
  ) =>
    prisma.fibermapElement.create({
      data: {
        tenantId,
        folderId: folder.id,
        type,
        name,
        latitude: new Prisma.Decimal(c.lat),
        longitude: new Prisma.Decimal(c.lng),
        productId,
        createdById: actorId,
      },
      select: { id: true, name: true },
    });

  const pop = await el('POP', 'POP-CPM', COORDS.pop, null);
  const ceo11 = await el('CEO', 'CPN-011', COORDS.ceo11, ceoProd);
  const ceo12 = await el('CEO', 'CPN-012', COORDS.ceo12, ceoProd);
  const ceo13 = await el('CEO', 'CPN-013', COORDS.ceo13, ceoProd);
  const cto01 = await el('CTO', 'CTO-CPM-01', COORDS.cto01, ctoProd);
  const cto02 = await el('CTO', 'CTO-CPM-02', COORDS.cto02, ctoProd);
  await el('CTO', 'CTO-CPM-03', COORDS.cto03, ctoProd);
  await el('CTO', 'CTO-CPM-04', COORDS.cto04, ctoProd);
  await el('POLE', 'POSTE-118', COORDS.poste118, null);

  // ── Devices no POP: rack → DIO + OLT ────────────────────────────────────
  const rack = await prisma.fibermapDevice.create({
    data: {
      tenantId,
      elementId: pop.id,
      type: 'RACK',
      name: 'Rack 01',
      productId: rackProd,
      metadata: { rack_units: 44 },
      createdById: actorId,
    },
  });
  const dio = await prisma.fibermapDevice.create({
    data: {
      tenantId,
      elementId: pop.id,
      parentDeviceId: rack.id,
      type: 'DIO',
      name: 'DIO-01',
      productId: dioProd,
      metadata: { ports: 24, connector: 'SC/APC', rack_position: 'U40' },
      createdById: actorId,
      ports: {
        create: Array.from({ length: 24 }, (_, i) => ({
          tenantId,
          role: 'BIDI' as const,
          portNumber: i + 1,
          label: `Bandeja ${i < 12 ? 1 : 2} Porta ${String(i + 1).padStart(2, '0')}`,
        })),
      },
    },
    include: { ports: true },
  });
  const olt = await prisma.fibermapDevice.create({
    data: {
      tenantId,
      elementId: pop.id,
      parentDeviceId: rack.id,
      type: 'OLT',
      name: 'OLT-CPM-01',
      metadata: { pon_ports: 16, rack_position: 'U36-U37' },
      createdById: actorId,
      ports: {
        create: Array.from({ length: 16 }, (_, i) => ({
          tenantId,
          role: 'BIDI' as const,
          portNumber: i + 1,
          label: `PON 0/1/${i + 1}`,
        })),
      },
    },
    include: { ports: true },
  });
  const splitter = await prisma.fibermapDevice.create({
    data: {
      tenantId,
      elementId: cto01.id,
      type: 'SPLITTER',
      name: 'SP-CPM 1x8',
      productId: sp8Prod,
      metadata: { ratio: '1x8', topology: 'BALANCED', connectorized: true },
      createdById: actorId,
      ports: {
        create: [
          { tenantId, role: 'IN' as const, portNumber: 1, label: 'IN' },
          ...Array.from({ length: 8 }, (_, i) => ({
            tenantId,
            role: 'OUT' as const,
            portNumber: i + 1,
            label: `OUT ${i + 1}`,
          })),
        ],
      },
    },
    include: { ports: true },
  });

  // ── Cabos instanciados do catálogo (tubos+fibras automáticos) ───────────
  const cable1 = await instantiateCableFromModel(prisma, {
    tenantId,
    actorUserId: actorId,
    folderId: folder.id,
    name: 'BB-CPM-R1',
    productId: asu12Abnt,
  });
  const cable2 = await instantiateCableFromModel(prisma, {
    tenantId,
    actorUserId: actorId,
    folderId: folder.id,
    name: 'DIST-GUA-R2',
    productId: as36Abnt,
  });
  const cable3 = await instantiateCableFromModel(prisma, {
    tenantId,
    actorUserId: actorId,
    folderId: folder.id,
    name: 'DIST-CPM-R3',
    productId: as48Eia,
  });

  // ── Segmentos (trigger calcula geom + comprimento) ───────────────────────
  const seg = (
    cableId: string,
    seq: number,
    fromId: string,
    toId: string,
    path: number[][],
  ) =>
    prisma.fibermapCableSegment.create({
      data: {
        tenantId,
        cableId,
        seq,
        fromElementId: fromId,
        toElementId: toId,
        path: path as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

  const seg11 = await seg(cable1.cableId, 1, pop.id, ceo11.id, pathOf(COORDS.pop, COORDS.poste118, COORDS.ceo11));
  await seg(cable1.cableId, 2, ceo11.id, ceo12.id, pathOf(COORDS.ceo11, COORDS.ceo12));
  const seg21 = await seg(cable2.cableId, 1, ceo12.id, ceo13.id, pathOf(COORDS.ceo12, COORDS.ceo13));
  await seg(cable2.cableId, 2, ceo13.id, cto01.id, pathOf(COORDS.ceo13, COORDS.cto01));
  await seg(cable3.cableId, 1, ceo11.id, cto02.id, pathOf(COORDS.ceo11, COORDS.cto02));

  // ── Reservas técnicas ────────────────────────────────────────────────────
  await prisma.fibermapCableSlack.createMany({
    data: [
      { tenantId, cableId: cable1.cableId, elementId: ceo11.id, segmentId: seg11.id, lengthM: new Prisma.Decimal(30) },
      { tenantId, cableId: cable2.cableId, elementId: ceo13.id, segmentId: seg21.id, lengthM: new Prisma.Decimal(25) },
    ],
  });

  // ── Corte (tesoura): fibra 2 do DIST-GUA-R2 aberta na CPN-013 ───────────
  const fiber2c2 = await prisma.fibermapFiber.findFirstOrThrow({
    where: { cableId: cable2.cableId, fiberNumber: 2 },
    select: { id: true },
  });
  await prisma.fibermapFiberCut.create({
    data: { tenantId, fiberId: fiber2c2.id, elementId: ceo13.id, createdById: actorId },
  });

  // ── Conexões (com linhas de ocupação de endpoint) ────────────────────────
  const fiber1c1 = await prisma.fibermapFiber.findFirstOrThrow({
    where: { cableId: cable1.cableId, fiberNumber: 1 },
    select: { id: true },
  });
  const fiber1c2 = await prisma.fibermapFiber.findFirstOrThrow({
    where: { cableId: cable2.cableId, fiberNumber: 1 },
    select: { id: true },
  });
  const oltPon1 = olt.ports.find((p) => p.role === 'BIDI' && p.portNumber === 1)!;
  const dioP1 = dio.ports.find((p) => p.portNumber === 1)!;
  const spIn = splitter.ports.find((p) => p.role === 'IN')!;

  // 1. Patch frontal: OLT PON 1 →conector→ DIO porta 1 (faces C).
  await prisma.fibermapOpticalConnection.create({
    data: {
      tenantId,
      elementId: pop.id,
      kind: 'CONNECTOR',
      aType: 'PORT',
      aPortId: oltPon1.id,
      bType: 'PORT',
      bPortId: dioP1.id,
      createdById: actorId,
      endpoints: {
        create: [
          { tenantId, endpointKey: fibermapPortKey(oltPon1.id, 'CONNECTOR') },
          { tenantId, endpointKey: fibermapPortKey(dioP1.id, 'CONNECTOR') },
        ],
      },
    },
  });
  // 2. Pigtail traseiro: DIO porta 1 →fusão→ BB-CPM-R1 fibra 1 lado A (face F).
  await prisma.fibermapOpticalConnection.create({
    data: {
      tenantId,
      elementId: pop.id,
      kind: 'FUSION',
      aType: 'PORT',
      aPortId: dioP1.id,
      bType: 'FIBER_END',
      bFiberId: fiber1c1.id,
      bFiberSide: 'A',
      lossDb: new Prisma.Decimal('0.10'),
      createdById: actorId,
      endpoints: {
        create: [
          { tenantId, endpointKey: fibermapPortKey(dioP1.id, 'FUSION') },
          { tenantId, endpointKey: fibermapFiberEndKey(fiber1c1.id, 'A') },
        ],
      },
    },
  });
  // 3. Emenda na CPN-012: BB-CPM-R1 f1 lado B ↔ DIST-GUA-R2 f1 lado A.
  await prisma.fibermapOpticalConnection.create({
    data: {
      tenantId,
      elementId: ceo12.id,
      kind: 'FUSION',
      aType: 'FIBER_END',
      aFiberId: fiber1c1.id,
      aFiberSide: 'B',
      bType: 'FIBER_END',
      bFiberId: fiber1c2.id,
      bFiberSide: 'A',
      lossDb: new Prisma.Decimal('0.05'),
      createdById: actorId,
      endpoints: {
        create: [
          { tenantId, endpointKey: fibermapFiberEndKey(fiber1c1.id, 'B') },
          { tenantId, endpointKey: fibermapFiberEndKey(fiber1c2.id, 'A') },
        ],
      },
    },
  });
  // 4. Na CTO-CPM-01: DIST-GUA-R2 f1 lado B →fusão→ splitter IN.
  await prisma.fibermapOpticalConnection.create({
    data: {
      tenantId,
      elementId: cto01.id,
      kind: 'FUSION',
      aType: 'FIBER_END',
      aFiberId: fiber1c2.id,
      aFiberSide: 'B',
      bType: 'PORT',
      bPortId: spIn.id,
      lossDb: new Prisma.Decimal('0.08'),
      createdById: actorId,
      endpoints: {
        create: [
          { tenantId, endpointKey: fibermapFiberEndKey(fiber1c2.id, 'B') },
          { tenantId, endpointKey: fibermapPortKey(spIn.id, 'FUSION') },
        ],
      },
    },
  });

  // Marca fibras ativas no caminho iluminado.
  await prisma.fibermapFiber.updateMany({
    where: { id: { in: [fiber1c1.id, fiber1c2.id] } },
    data: { status: 'ACTIVE' },
  });

  console.log('  ✓ fixture criada:', {
    folder: folder.id,
    cabos: [cable1, cable2, cable3].map((c) => c.cableId),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Asserções de aceite FM-0 — rodam SEMPRE (fixture nova ou pré-existente)
// ─────────────────────────────────────────────────────────────────────────────
async function runAcceptance(tenantId: string) {
  console.log('  → Asserções de aceite FM-0');

  // (a) AS 36FO (ABNT): 6 tubos Verde, Amarela, 4× Branca; fibras Verde…Violeta.
  const c2 = await prisma.fibermapCable.findFirstOrThrow({
    where: { tenantId, name: 'DIST-GUA-R2', deletedAt: null },
    include: {
      tubes: { orderBy: { tubeNumber: 'asc' } },
      fibers: { orderBy: { fiberNumber: 'asc' } },
    },
  });
  assert(c2.tubes.length === 6, `AS 36FO: esperava 6 tubos, veio ${c2.tubes.length}`);
  assert(
    JSON.stringify(c2.tubes.map((t) => t.color)) ===
      JSON.stringify(['VERDE', 'AMARELA', 'BRANCA', 'BRANCA', 'BRANCA', 'BRANCA']),
    `AS 36FO tubos: ${c2.tubes.map((t) => t.color).join(',')}`,
  );
  assert(c2.fibers.length === 36, `AS 36FO: esperava 36 fibras, veio ${c2.fibers.length}`);
  const tube1Colors = c2.fibers.filter((f) => f.tubeNumber === 1).map((f) => f.color);
  assert(
    JSON.stringify(tube1Colors) ===
      JSON.stringify(['VERDE', 'AMARELA', 'BRANCA', 'AZUL', 'VERMELHA', 'VIOLETA']),
    `AS 36FO fibras do tubo 1 (Verde…Violeta): ${tube1Colors.join(',')}`,
  );

  // (b) AS 48FO (EIA/TIA): 4 tubos (Verde, Amarela, 2× Branca); 12 fibras
  //     Azul…Água-marinha em cada tubo.
  const c3 = await prisma.fibermapCable.findFirstOrThrow({
    where: { tenantId, name: 'DIST-CPM-R3', deletedAt: null },
    include: {
      tubes: { orderBy: { tubeNumber: 'asc' } },
      fibers: { orderBy: { fiberNumber: 'asc' } },
    },
  });
  assert(c3.tubes.length === 4, `AS 48FO: esperava 4 tubos, veio ${c3.tubes.length}`);
  assert(
    JSON.stringify(c3.tubes.map((t) => t.color)) ===
      JSON.stringify(['VERDE', 'AMARELA', 'BRANCA', 'BRANCA']),
    `AS 48FO tubos: ${c3.tubes.map((t) => t.color).join(',')}`,
  );
  const EIA = ['AZUL', 'LARANJA', 'VERDE', 'MARROM', 'CINZA', 'BRANCA', 'VERMELHA', 'PRETA', 'AMARELA', 'VIOLETA', 'ROSA', 'AGUA_MARINHA'];
  for (let tube = 1; tube <= 4; tube++) {
    const colors = c3.fibers.filter((f) => f.tubeNumber === tube).map((f) => f.color);
    assert(
      JSON.stringify(colors) === JSON.stringify(EIA),
      `AS 48FO tubo ${tube} (Azul…Água-marinha): ${colors.join(',')}`,
    );
  }

  // (c) Constraint impede fusão duplicada na mesma ponta: reusar uma chave de
  //     endpoint ocupada tem que estourar P2002.
  const usedEndpoint = await prisma.fibermapConnectionEndpoint.findFirstOrThrow({
    where: { tenantId },
  });
  const anyElement = await prisma.fibermapElement.findFirstOrThrow({
    where: { tenantId, deletedAt: null },
    select: { id: true },
  });
  const dupFiber = await prisma.fibermapFiber.findFirstOrThrow({
    where: { tenantId },
    select: { id: true },
  });
  let blocked = false;
  try {
    await prisma.fibermapOpticalConnection.create({
      data: {
        tenantId,
        elementId: anyElement.id,
        kind: 'FUSION',
        aType: 'FIBER_END',
        aFiberId: dupFiber.id,
        aFiberSide: 'B',
        bType: 'FIBER_END',
        bFiberId: dupFiber.id,
        bFiberSide: 'A',
        endpoints: { create: [{ tenantId, endpointKey: usedEndpoint.endpointKey }] },
      },
    });
  } catch (err) {
    blocked =
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
    if (!blocked) throw err;
  }
  assert(blocked, 'inserir endpoint duplicado NÃO estourou P2002');
  // A transação implícita reverteu a conexão órfã; garante que não vazou:
  const orphan = await prisma.fibermapOpticalConnection.count({
    where: { tenantId, aFiberId: dupFiber.id, bFiberId: dupFiber.id },
  });
  assert(orphan === 0, 'conexão órfã vazou apesar do P2002');

  // (d) Triggers PostGIS: geom preenchido e comprimento > 0 em todo segmento.
  const [geomCheck] = await prisma.$queryRaw<
    { total: bigint; with_geom: bigint; with_len: bigint }[]
  >`SELECT count(*) AS total,
           count(geom) AS with_geom,
           count(*) FILTER (WHERE geometric_length_m > 0) AS with_len
      FROM fibermap_cable_segments s
      JOIN fibermap_cables c ON c.id = s.cable_id
     WHERE c.tenant_id = ${tenantId}::uuid`;
  assert(Number(geomCheck.total) >= 5, `esperava ≥5 segmentos, veio ${geomCheck.total}`);
  assert(
    Number(geomCheck.with_geom) === Number(geomCheck.total),
    `trigger não preencheu geom em ${Number(geomCheck.total) - Number(geomCheck.with_geom)} segmento(s)`,
  );
  assert(
    Number(geomCheck.with_len) === Number(geomCheck.total),
    'trigger não calculou geometric_length_m em algum segmento',
  );

  console.log('  ✓ aceite FM-0 OK (cores ABNT/EIA, piloto/direcional, unique de ponta, triggers PostGIS)');
}

async function main() {
  console.log('🧪 FiberMap — fixture FM-0');
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { slug: 'default' },
    select: { id: true },
  });
  const admin = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email: 'admin@netx.local' },
    select: { id: true },
  });

  const existing = await prisma.fibermapFolder.findFirst({
    where: { tenantId: tenant.id, name: FOLDER_NAME, deletedAt: null },
  });
  if (existing) {
    console.log('  → fixture já carregada — pulando criação');
  } else {
    await loadFixture(tenant.id, admin?.id ?? null);
  }
  await runAcceptance(tenant.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

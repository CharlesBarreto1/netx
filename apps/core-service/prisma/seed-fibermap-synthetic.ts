/**
 * Seed sintético FiberMap — 5.000 elementos pro aceite de performance do
 * FM-1 (spec §13: "60 fps de pan com 5 mil elementos" / §16: p95 < 200ms).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Espalha CEOs/CTOs/postes numa grade ruidosa de ~20×20 km em volta de
 * Campo Mourão/PR, numa pasta própria — fácil de apagar depois (deletar a
 * pasta é bloqueado com conteúdo; use o SQL de limpeza no fim deste header):
 *   DELETE FROM fibermap_elements WHERE folder_id = (SELECT id FROM
 *     fibermap_folders WHERE name = 'FiberMap — Sintético 5k');
 *   DELETE FROM fibermap_folders WHERE name = 'FiberMap — Sintético 5k';
 *
 * Run:  npm run -w apps/core-service db:seed:fibermap:synthetic
 */
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const FOLDER_NAME = 'FiberMap — Sintético 5k';
const CENTER = { lat: -24.0525, lng: -52.371 };
const TOTAL = 5000;

// Determinístico (LCG) — mesma planta a cada run, sem depender de Math.random
// com seed externa.
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

async function main() {
  console.log(`🧪 FiberMap — seed sintético (${TOTAL} elementos)`);
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { slug: 'default' },
    select: { id: true },
  });

  const existing = await prisma.fibermapFolder.findFirst({
    where: { tenantId: tenant.id, name: FOLDER_NAME, deletedAt: null },
    select: { id: true, _count: { select: { elements: true } } },
  });
  if (existing && existing._count.elements >= TOTAL) {
    console.log(`  → já existem ${existing._count.elements} elementos — nada a fazer`);
    return;
  }
  const folder =
    existing ??
    (await prisma.fibermapFolder.create({
      data: { tenantId: tenant.id, name: FOLDER_NAME },
      select: { id: true },
    }));

  const rnd = lcg(20260705);
  const types = ['CTO', 'CTO', 'CTO', 'CEO', 'POLE', 'POLE'] as const; // mix realista
  const batch: Prisma.FibermapElementCreateManyInput[] = [];
  for (let i = 0; i < TOTAL; i++) {
    const type = types[Math.floor(rnd() * types.length)];
    // ~±0.09° ≈ ±10 km em cada eixo
    const lat = CENTER.lat + (rnd() - 0.5) * 0.18;
    const lng = CENTER.lng + (rnd() - 0.5) * 0.18;
    batch.push({
      tenantId: tenant.id,
      folderId: folder.id,
      type,
      name: `SYN-${type}-${String(i + 1).padStart(4, '0')}`,
      latitude: new Prisma.Decimal(lat.toFixed(6)),
      longitude: new Prisma.Decimal(lng.toFixed(6)),
    });
  }

  // createMany não dispara a trigger? Dispara — trigger é do Postgres, vale
  // pra qualquer INSERT. skipDuplicates cobre re-runs parciais (unique
  // folder+name).
  const CHUNK = 500;
  let created = 0;
  for (let i = 0; i < batch.length; i += CHUNK) {
    const res = await prisma.fibermapElement.createMany({
      data: batch.slice(i, i + CHUNK),
      skipDuplicates: true,
    });
    created += res.count;
  }
  console.log(`  ✓ ${created} elementos sintéticos criados na pasta "${FOLDER_NAME}"`);

  // Sanity da consulta de mapa: bbox de ~4×4 km no centro via GiST.
  const t0 = Date.now();
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM fibermap_elements
     WHERE tenant_id = ${tenant.id}::uuid AND deleted_at IS NULL
       AND geom && ST_MakeEnvelope(${CENTER.lng - 0.02}, ${CENTER.lat - 0.02}, ${CENTER.lng + 0.02}, ${CENTER.lat + 0.02}, 4326)`;
  console.log(
    `  ✓ bbox 4×4km → ${rows[0].n} elementos em ${Date.now() - t0}ms (aceite §16: <200ms)`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

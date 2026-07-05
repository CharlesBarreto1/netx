/**
 * FiberMap — instanciação de cabo a partir de um modelo do catálogo.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Função PURA de orquestração (recebe o client/tx do Prisma) pra ser usada
 * tanto pelo service de cabos (FM-2) quanto pela fixture FM-0 — a criação
 * automática de tubos/fibras é um critério de aceite do FM-0.
 *
 * Snapshot (spec §3.4): as colunas estruturais do cabo copiam o cable_model
 * no momento da criação; editar/desativar o produto depois não altera cabos
 * existentes. Cores: tubos ← fibermap_cable_model_tubes (snapshot); fibras ←
 * ciclo do padrão truncado em fibersPerTube (buildCableFiberLayout).
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { buildCableFiberLayout } from '@netx/shared';

/** Aceita tanto o client raiz quanto um transaction client. */
export type PrismaDb = PrismaClient | Prisma.TransactionClient;

/** Paleta pro display_color default (derivado do nome — estável). */
const CABLE_COLOR_PALETTE = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#64748b',
  '#f59e0b',
] as const;

export function defaultCableDisplayColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i)) % 997;
  return CABLE_COLOR_PALETTE[h % CABLE_COLOR_PALETTE.length];
}

export interface InstantiateCableInput {
  tenantId: string;
  actorUserId: string | null;
  folderId: string;
  name: string;
  /** Produto type=CABLE com cable_model — validado aqui. */
  productId: string;
  displayColor?: string | null;
  notes?: string | null;
}

export class FibermapCatalogError extends Error {}

/**
 * Cria cabo + tubos + fibras numa única transação (se `db` for o client raiz,
 * abre a transação; se já for um tx, participa dela).
 */
export async function instantiateCableFromModel(
  db: PrismaDb,
  input: InstantiateCableInput,
): Promise<{ cableId: string; tubesCreated: number; fibersCreated: number }> {
  const product = await db.fibermapProduct.findFirst({
    where: {
      id: input.productId,
      tenantId: input.tenantId,
      type: 'CABLE',
      deletedAt: null,
    },
    include: { cableModel: { include: { tubes: true } } },
  });
  if (!product || !product.cableModel) {
    throw new FibermapCatalogError(
      'Produto de cabo não encontrado (ou não é um modelo de cabo)',
    );
  }
  if (!product.isActive) {
    throw new FibermapCatalogError(
      'Modelo de cabo desativado — reative no catálogo ou escolha outro',
    );
  }
  const model = product.cableModel;
  if (model.tubes.length !== model.tubeCount) {
    throw new FibermapCatalogError(
      `Modelo inconsistente: ${model.tubes.length} cores de tubo para ${model.tubeCount} tubos`,
    );
  }

  const structure = {
    fiberCount: model.fiberCount,
    tubeCount: model.tubeCount,
    fibersPerTube: model.fibersPerTube,
  };
  const layout = buildCableFiberLayout(structure, model.colorStandard);

  const run = async (tx: Prisma.TransactionClient) => {
    const cable = await tx.fibermapCable.create({
      data: {
        tenantId: input.tenantId,
        folderId: input.folderId,
        name: input.name.trim(),
        productId: product.id,
        fiberCount: model.fiberCount,
        tubeCount: model.tubeCount,
        fibersPerTube: model.fibersPerTube,
        colorStandard: model.colorStandard,
        excessFactor: model.excessFactor,
        displayColor:
          input.displayColor ?? defaultCableDisplayColor(input.name),
        notes: input.notes ?? null,
        createdById: input.actorUserId,
      },
      select: { id: true },
    });
    await tx.fibermapCableTube.createMany({
      data: model.tubes.map((t) => ({
        cableId: cable.id,
        tubeNumber: t.tubeNumber,
        color: t.color,
      })),
    });
    await tx.fibermapFiber.createMany({
      data: layout.map((f) => ({
        tenantId: input.tenantId,
        cableId: cable.id,
        tubeNumber: f.tubeNumber,
        fiberNumber: f.fiberNumber,
        color: f.color,
      })),
    });
    return {
      cableId: cable.id,
      tubesCreated: model.tubes.length,
      fibersCreated: layout.length,
    };
  };

  // Client raiz tem $transaction; um TransactionClient não.
  if ('$transaction' in db) {
    return db.$transaction(run);
  }
  return run(db);
}

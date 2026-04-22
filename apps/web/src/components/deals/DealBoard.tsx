'use client';

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/lib/api';
import { dealsApi } from '@/lib/crm-sales-api';
import type { Deal, DealBoard as DealBoardType } from '@/lib/crm-sales-types';
import { toast } from '@/components/ui/sonner';

import { DealCard } from './DealCard';
import { DealColumn } from './DealColumn';

/**
 * DealBoard — container do Kanban.
 *
 * Estratégia de DnD:
 *   1. Mantemos o board em state local ("optimistic") além do que o SWR dá.
 *      Isso evita flicker enquanto a API confirma e permite rollback rápido.
 *   2. Quando um card é arrastado, calculamos a coluna destino via `over.data`.
 *      - Se for um card (same-column OU cross-column), usamos o índice do card-alvo.
 *      - Se for a própria coluna (droppable vazia), pomos no final.
 *   3. Despacha backend:
 *      - Mesma coluna → POST /deals/reorder
 *      - Coluna diferente → POST /deals/:id/move { stageId, position }
 *   4. Em qualquer erro, revertemos para o snapshot anterior e mostramos toast.
 */
export function DealBoard({
  board,
  onOpenDeal,
  onAddDeal,
  onMutated,
}: {
  board: DealBoardType;
  onOpenDeal: (dealId: string) => void;
  onAddDeal: (stageId: string) => void;
  /** Chamado após um move/reorder bem-sucedido para o caller revalidar o SWR. */
  onMutated: () => void;
}) {
  const [columns, setColumns] = useState(board.columns);
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);

  // Mantém sync com os dados novos do servidor quando o board for revalidado.
  // (Trocamos toda a estrutura por referência; o DndKit reanexa os itens.)
  useEffect(() => {
    setColumns(board.columns);
  }, [board]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const findDeal = useCallback(
    (dealId: string) => {
      for (const col of columns) {
        const d = col.deals.find((x) => x.id === dealId);
        if (d) return { deal: d, stageId: col.stage.id };
      }
      return null;
    },
    [columns],
  );

  function handleDragStart(ev: DragStartEvent) {
    const id = String(ev.active.id);
    const hit = findDeal(id);
    if (hit) setActiveDeal(hit.deal);
  }

  async function handleDragEnd(ev: DragEndEvent) {
    const { active, over } = ev;
    setActiveDeal(null);
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const snapshot = columns;
    const src = findDeal(activeId);
    if (!src) return;

    // Determine destino:
    const overData = over.data?.current as
      | { type?: string; stageId?: string; deal?: Deal }
      | undefined;
    let targetStageId: string | undefined;
    let targetIndex: number | undefined;

    if (overData?.type === 'stage' && overData.stageId) {
      targetStageId = overData.stageId;
      // Solto numa coluna vazia ou na "sobra" — vai para o final.
      const tgt = columns.find((c) => c.stage.id === targetStageId);
      targetIndex = tgt ? tgt.deals.length : 0;
    } else if (overData?.type === 'deal') {
      const overDeal = findDeal(overId);
      if (!overDeal) return;
      targetStageId = overDeal.stageId;
      const col = columns.find((c) => c.stage.id === targetStageId);
      targetIndex = col ? col.deals.findIndex((d) => d.id === overId) : 0;
    } else {
      return;
    }

    if (!targetStageId || targetIndex === undefined) return;

    // Movimento local (otimista)
    const next = structuredClone(columns) as typeof columns;
    const srcCol = next.find((c) => c.stage.id === src.stageId)!;
    const dstCol = next.find((c) => c.stage.id === targetStageId)!;
    const srcIndex = srcCol.deals.findIndex((d) => d.id === activeId);
    if (srcIndex < 0) return;
    const [moved] = srcCol.deals.splice(srcIndex, 1);

    // Se arrastando para baixo na mesma coluna, o `targetIndex` já reflete o
    // estado pré-remoção do item — precisamos compensar.
    let insertIndex = targetIndex;
    if (src.stageId === targetStageId && srcIndex < targetIndex) {
      insertIndex = targetIndex - 1;
    }
    dstCol.deals.splice(insertIndex, 0, {
      ...moved,
      stageId: targetStageId,
    });

    // Recalcula contadores/total local para UI imediata.
    for (const col of [srcCol, dstCol]) {
      col.totalCount = col.deals.length;
      col.totalValue = col.deals.reduce((s, d) => s + (d.value ?? 0), 0);
    }

    setColumns(next);

    // Backend
    try {
      if (src.stageId === targetStageId) {
        await dealsApi.reorderInStage(
          targetStageId,
          dstCol.deals.map((d) => d.id),
        );
      } else {
        await dealsApi.move(activeId, {
          stageId: targetStageId,
          position: insertIndex,
        });
      }
      onMutated();
    } catch (err) {
      // Rollback
      setColumns(snapshot);
      const msg =
        err instanceof ApiError
          ? err.friendlyMessage
          : 'Não foi possível mover o deal';
      toast.error(msg);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveDeal(null)}
    >
      <div className="flex h-full min-h-0 gap-3 overflow-x-auto pb-3">
        {columns.map((col) => (
          <DealColumn
            key={col.stage.id}
            column={col}
            onAddDeal={onAddDeal}
            onOpenDeal={onOpenDeal}
            activeDealId={activeDeal?.id}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeDeal ? <DealCard deal={activeDeal} isOverlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

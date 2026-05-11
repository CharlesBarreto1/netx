'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import type { DealBoardColumn } from '@/lib/crm-sales-types';
import { useFormatMoney } from '@/lib/use-money';

import { DealCard } from './DealCard';

/**
 * DealColumn — coluna (estágio) do Kanban.
 *
 * Mesmo se estiver vazia, precisa funcionar como droppable (DnD-kit cria um
 * over-target zero-sized se não tiver nenhum item). Resolvo renderizando
 * `useDroppable` na div interna e deixando o SortableContext envolver só os
 * items — assim a coluna inteira vira hit-area mesmo vazia.
 */
export function DealColumn({
  column,
  onAddDeal,
  onOpenDeal,
  activeDealId,
}: {
  column: DealBoardColumn;
  onAddDeal: (stageId: string) => void;
  onOpenDeal: (dealId: string) => void;
  activeDealId?: string | null;
}) {
  const formatMoney = useFormatMoney();
  const { setNodeRef, isOver } = useDroppable({
    id: `stage:${column.stage.id}`,
    data: { type: 'stage', stageId: column.stage.id },
  });

  const stageColor = column.stage.color ?? undefined;
  const dealIds = column.deals.map((d) => d.id);

  return (
    <div
      className={cn(
        'flex h-full min-h-0 w-72 shrink-0 flex-col rounded-lg border border-border bg-surface-muted/60',
        isOver && 'bg-accent-muted/40 outline outline-1 outline-accent/40',
      )}
    >
      {/* Header */}
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span
          aria-hidden
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: stageColor ?? 'hsl(var(--text-subtle))' }}
        />
        <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-text">
          {column.stage.name}
        </h3>
        <span className="tabular rounded-full bg-surface px-1.5 py-0.5 text-2xs font-medium text-text-muted">
          {column.totalCount}
        </span>

        <SimpleTooltip label="Novo deal neste estágio" shortcut="N">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => onAddDeal(column.stage.id)}
            aria-label="Novo deal"
            className="ml-auto"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </SimpleTooltip>
      </header>

      {/* Soma + probabilidade */}
      <div className="flex items-center justify-between gap-2 px-3 pb-2 text-2xs text-text-muted">
        <span className="tabular">
          {formatMoney(column.totalValue, undefined, { short: true })}
        </span>
        <span className="tabular">{column.stage.probability}% prob.</span>
      </div>

      {/* Cards */}
      <div
        ref={setNodeRef}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2"
      >
        <SortableContext items={dealIds} strategy={verticalListSortingStrategy}>
          {column.deals.map((deal) => (
            <DealCard
              key={deal.id}
              deal={deal}
              onClick={() => onOpenDeal(deal.id)}
              isDragging={activeDealId === deal.id}
            />
          ))}
        </SortableContext>

        {column.deals.length === 0 && (
          <button
            type="button"
            onClick={() => onAddDeal(column.stage.id)}
            className={cn(
              'mt-1 flex min-h-[72px] items-center justify-center rounded-md',
              'border border-dashed border-border text-2xs text-text-subtle',
              'transition-colors hover:border-border-strong hover:text-text-muted',
              'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            Arraste um deal aqui ou clique para criar
          </button>
        )}

        {column.hasMore && (
          <div className="py-2 text-center text-2xs text-text-subtle">
            + mais deals (aumente o limite)
          </div>
        )}
      </div>
    </div>
  );
}

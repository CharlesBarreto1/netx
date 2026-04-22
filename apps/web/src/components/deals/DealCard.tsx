'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Calendar, GripVertical, MessageSquare } from 'lucide-react';
import type { CSSProperties, MouseEventHandler } from 'react';

import { Avatar, AvatarFallback, initialsFromName } from '@/components/ui/avatar';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import type { Deal } from '@/lib/crm-sales-types';
import { formatDate, formatMoney, relativeTime } from '@/lib/format';

/**
 * DealCard — cartão do Kanban.
 *
 * - Usa @dnd-kit/sortable para suportar arrastar.
 * - O card inteiro é o "handle" (hit area grande), mas o indicador visual
 *   `GripVertical` aparece no hover p/ deixar claro que é arrastável.
 * - Evento onClick é propagado só quando NÃO estamos arrastando.
 */
export function DealCard({
  deal,
  onClick,
  isOverlay = false,
  isDragging = false,
}: {
  deal: Deal;
  onClick?: MouseEventHandler<HTMLDivElement>;
  isOverlay?: boolean;
  isDragging?: boolean;
}) {
  const sortable = useSortable({
    id: deal.id,
    data: { type: 'deal', deal },
    disabled: isOverlay,
  });
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging: localDragging,
  } = sortable;

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const overdue =
    deal.expectedCloseAt && new Date(deal.expectedCloseAt).getTime() < Date.now();

  const ghost = localDragging && !isOverlay;

  return (
    <div
      ref={isOverlay ? undefined : setNodeRef}
      style={isOverlay ? undefined : style}
      {...(isOverlay ? {} : attributes)}
      {...(isOverlay ? {} : listeners)}
      onClick={ghost ? undefined : onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cn(
        'group relative flex flex-col gap-2 rounded-md border border-border bg-surface p-3 text-left',
        'shadow-xs transition-[box-shadow,border-color,transform] will-change-transform',
        'hover:border-border-strong hover:shadow-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        ghost && 'pointer-events-none opacity-40',
        isOverlay && 'rotate-[0.5deg] scale-[1.02] shadow-lg ring-1 ring-border-strong',
        isDragging && !isOverlay && 'shadow-md',
      )}
    >
      {/* Grip — só aparece no hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute right-2 top-2 text-text-subtle opacity-0 transition-opacity group-hover:opacity-100"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>

      {/* Título + descrição curta */}
      <div className="pr-5">
        <h4 className="line-clamp-2 text-sm font-medium leading-snug text-text">
          {deal.title}
        </h4>
        {deal.customer?.displayName && (
          <p className="mt-0.5 truncate text-xs text-text-muted">
            {deal.customer.displayName}
          </p>
        )}
      </div>

      {/* Valor */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="tabular text-sm font-semibold text-text">
          {formatMoney(deal.value, deal.currency, { short: true })}
        </span>
        {deal.probability !== null && deal.probability !== undefined && (
          <span className="tabular text-2xs font-medium text-text-subtle">
            {deal.probability}%
          </span>
        )}
      </div>

      {/* Footer: data esperada, atividades, owner */}
      <div className="flex items-center gap-2 text-2xs text-text-subtle">
        {deal.expectedCloseAt && (
          <SimpleTooltip label={formatDate(deal.expectedCloseAt)}>
            <span
              className={cn(
                'inline-flex items-center gap-1 tabular',
                overdue && deal.status === 'OPEN' && 'text-danger',
              )}
            >
              <Calendar className="h-3 w-3" />
              {relativeTime(deal.expectedCloseAt)}
            </span>
          </SimpleTooltip>
        )}
        {!!deal.activityCount && (
          <SimpleTooltip label={`${deal.activityCount} atividade(s)`}>
            <span className="inline-flex items-center gap-1 tabular">
              <MessageSquare className="h-3 w-3" />
              {deal.activityCount}
            </span>
          </SimpleTooltip>
        )}

        <span className="ml-auto flex items-center">
          {deal.owner?.name && (
            <SimpleTooltip label={deal.owner.name}>
              <Avatar className="h-5 w-5">
                <AvatarFallback className="text-[9px]">
                  {initialsFromName(deal.owner.name)}
                </AvatarFallback>
              </Avatar>
            </SimpleTooltip>
          )}
        </span>
      </div>
    </div>
  );
}

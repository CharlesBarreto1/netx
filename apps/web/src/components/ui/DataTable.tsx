/**
 * DataTable — wrapper opinativo pra listagens da NetX.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Encapsula o padrão:
 *   • Container `<section>` com borda + shadow-xs + rounded
 *   • Loading state via `<SkeletonRow />` (configurável)
 *   • Empty state via `<EmptyState />` quando data = []
 *   • Error state via toast simples
 *   • Container query (`@container/datatable`) — header colapsa em containers estreitos
 *   • Density variants: linhas têm height controlada por data-density
 *   • Row hover sutil + transition
 *
 * Não substitui `<table>` direto — fica genérico. Você passa `columns` e `data`:
 *
 *   <DataTable
 *     columns={[
 *       { key: 'name', label: 'Nome', cell: (c) => c.displayName },
 *       { key: 'email', label: 'Email', cell: (c) => c.email, hideOnNarrow: true },
 *     ]}
 *     data={data}
 *     isLoading={isLoading}
 *     empty={{ title: 'Sem clientes', description: '...', icon: Users }}
 *   />
 */
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { EmptyState } from './EmptyState';
import { SkeletonRow } from './Skeleton';

export interface DataTableColumn<T> {
  key: string;
  label: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  /** Esconde em containers estreitos (`@md` e abaixo). */
  hideOnNarrow?: boolean;
  /** Align: 'left' (default), 'right', 'center'. */
  align?: 'left' | 'right' | 'center';
  /** Largura fixa opcional (px ou %). */
  width?: string | number;
  /** className extra no <th> e <td>. */
  className?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[] | undefined;
  isLoading?: boolean;
  /** Callback de click numa linha — toda a row vira clicável. */
  onRowClick?: (row: T) => void;
  /** Empty state customizável. */
  empty?: {
    icon?: LucideIcon;
    title: ReactNode;
    description?: ReactNode;
    action?: { label: ReactNode; href?: string; onClick?: () => void };
  };
  /** Função pra extrair key estável de cada linha. Default = `row.id`. */
  getRowKey?: (row: T, index: number) => string | number;
  /** Skeleton rows count enquanto carrega. */
  skeletonRows?: number;
  className?: string;
}

const ALIGN_CLS: Record<NonNullable<DataTableColumn<unknown>['align']>, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

export function DataTable<T extends { id?: string | number }>({
  columns,
  data,
  isLoading,
  onRowClick,
  empty,
  getRowKey,
  skeletonRows = 5,
  className,
}: DataTableProps<T>) {
  const hasData = data && data.length > 0;
  const showEmpty = !isLoading && !hasData && empty;

  return (
    <section
      className={cn(
        '@container/datatable overflow-hidden rounded-lg border border-border bg-surface shadow-xs',
        className,
      )}
    >
      {showEmpty ? (
        <EmptyState
          icon={empty.icon}
          title={empty.title}
          description={empty.description}
          action={empty.action}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-muted/60">
              <tr className="text-left text-2xs font-semibold uppercase tracking-wider text-text-subtle">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    style={col.width ? { width: col.width } : undefined}
                    className={cn(
                      'border-b border-border px-3',
                      'compact:py-1.5 cozy:py-2.5 comfortable:py-3 py-2.5',
                      col.align && ALIGN_CLS[col.align],
                      col.hideOnNarrow && 'hidden @md/datatable:table-cell',
                      col.className,
                    )}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading &&
                Array.from({ length: skeletonRows }).map((_, i) => (
                  <SkeletonRow key={`s-${i}`} cols={columns.length} />
                ))}
              {!isLoading &&
                data?.map((row, i) => {
                  const key = getRowKey ? getRowKey(row, i) : (row.id ?? i);
                  return (
                    <tr
                      key={key}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={cn(
                        'group transition-colors',
                        onRowClick && 'cursor-pointer',
                        'hover:bg-surface-hover',
                      )}
                    >
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={cn(
                            'px-3 align-middle text-text',
                            'compact:py-1.5 cozy:py-2.5 comfortable:py-3 py-2.5',
                            col.align && ALIGN_CLS[col.align],
                            col.hideOnNarrow && 'hidden @md/datatable:table-cell',
                            col.className,
                          )}
                        >
                          {col.cell(row, i)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

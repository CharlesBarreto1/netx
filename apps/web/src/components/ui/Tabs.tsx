'use client';

import { cn } from '@/lib/cn';

export interface TabItem<T extends string = string> {
  value: T;
  label: React.ReactNode;
  badge?: React.ReactNode;
  disabled?: boolean;
}

/**
 * Tabs controladas: o pai é dono do estado `value` e do handler `onChange`.
 * Renderização do conteúdo fica a cargo de quem usa (via switch no value).
 */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T;
  onChange: (next: T) => void;
  items: TabItem<T>[];
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className={cn(
        'flex flex-wrap items-center gap-1 border-b border-slate-200 dark:border-slate-700',
        className,
      )}
    >
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={it.disabled}
            onClick={() => !it.disabled && onChange(it.value)}
            className={cn(
              'inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 rounded-t-md',
              active
                ? 'border-brand-600 text-brand-700 dark:text-brand-300'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100',
              it.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {it.label}
            {it.badge !== undefined && (
              <span
                className={cn(
                  'inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold',
                  active
                    ? 'bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-100'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200',
                )}
              >
                {it.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

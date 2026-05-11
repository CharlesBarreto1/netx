/**
 * Breadcrumb — trilho de navegação pra páginas profundas.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Uso:
 *   <Breadcrumb items={[
 *     { label: 'Clientes', href: '/customers' },
 *     { label: 'Ana Silva', href: '/customers/123' },
 *     { label: 'Fatura #42' },          // último sem href = página atual
 *   ]} />
 *
 * - Truncate automático: se label > 24 chars, vira ellipsis com tooltip.
 * - Separator: ChevronRight (Lucide) sutil em text-subtle.
 */
'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { SimpleTooltip } from './tooltip';

export interface BreadcrumbItem {
  label: ReactNode;
  href?: string;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
  /** Max chars antes de truncar com ellipsis (default 24). */
  maxLabelChars?: number;
}

function trunc(label: ReactNode, max: number): { display: ReactNode; truncated: boolean } {
  if (typeof label !== 'string') return { display: label, truncated: false };
  if (label.length <= max) return { display: label, truncated: false };
  return { display: `${label.slice(0, max - 1)}…`, truncated: true };
}

export function Breadcrumb({ items, className, maxLabelChars = 24 }: BreadcrumbProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn(
        'flex items-center gap-1.5 text-sm text-text-muted',
        'overflow-x-auto whitespace-nowrap mask-fade-r',
        className,
      )}
    >
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        const { display, truncated } = trunc(item.label, maxLabelChars);
        const content = truncated && typeof item.label === 'string' ? (
          <SimpleTooltip label={item.label} side="bottom">
            <span>{display}</span>
          </SimpleTooltip>
        ) : (
          <span>{display}</span>
        );

        return (
          <Fragment key={i}>
            {i > 0 && (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-subtle" />
            )}
            {item.href && !isLast ? (
              <Link
                href={item.href}
                className="rounded px-1 py-0.5 transition-colors hover:bg-surface-hover hover:text-text focus-visible:bg-surface-hover focus-visible:text-text"
              >
                {content}
              </Link>
            ) : (
              <span
                className={cn(
                  'px-1 py-0.5',
                  isLast && 'font-medium text-text',
                )}
                aria-current={isLast ? 'page' : undefined}
              >
                {content}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

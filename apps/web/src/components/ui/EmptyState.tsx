/**
 * EmptyState — placeholder unificado pra listagens vazias / busca sem resultado.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Padrão Linear-style:
 *   - Ícone Lucide (32px, color text-subtle)
 *   - Título (text-md, semibold)
 *   - Descrição (text-sm, text-muted, 1-2 frases)
 *   - CTA opcional (Button primário)
 *
 * Uso:
 *   <EmptyState
 *     icon={Inbox}
 *     title="Nenhum cliente ainda"
 *     description="Cadastre o primeiro cliente pra começar a operar."
 *     action={{ label: 'Novo cliente', onClick: () => router.push('/customers/new') }}
 *   />
 */
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Button } from './Button';
import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: {
    label: ReactNode;
    onClick?: () => void;
    href?: string;
  };
  /** Decorativo: vector de fundo (grid sutil) — bom pra páginas inteiras vazias. */
  withGrid?: boolean;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  withGrid = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'relative flex flex-col items-center justify-center text-center',
        'px-6 py-12 sm:py-16',
        'animate-fade-in-up',
        withGrid && 'grid-dense-16 rounded-lg border border-border',
        className,
      )}
    >
      {Icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-text-subtle">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <h3 className="text-md font-semibold text-text">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-md text-sm text-text-muted">{description}</p>
      )}
      {action && (
        <div className="mt-5">
          {action.href ? (
            // Button NetX não suporta `asChild` (não usa Radix Slot). Envolvendo
            // o Button num <Link> mantém navegação client-side do Next sem
            // perder o estilo do Button.
            <Link href={action.href}>
              <Button>{action.label}</Button>
            </Link>
          ) : (
            <Button onClick={action.onClick}>{action.label}</Button>
          )}
        </div>
      )}
    </div>
  );
}

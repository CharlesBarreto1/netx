/**
 * StatusBadge — pílula de status com bolinha colorida (e pulse opcional pra "online").
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Os 4 estados semânticos cobrem os casos mais comuns:
 *   online  → verde (radius_active, sessão ativa)
 *   warn    → amarelo (sessão antiga, latência alta)
 *   offline → cinza (sem sessão, equipamento desligado)
 *   error   → vermelho (auth_failed, falha hardware)
 *
 * Uso:
 *   <StatusBadge status="online" label="Online" />
 *   <StatusBadge status="offline" label="Última sessão: 2h" subtle />
 *   <StatusBadge status="warn">Latência alta</StatusBadge>
 */
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export type StatusVariant = 'online' | 'warn' | 'offline' | 'error';

export interface StatusBadgeProps {
  status: StatusVariant;
  /** Texto do badge. Se children for fornecido, prevalece. */
  label?: ReactNode;
  children?: ReactNode;
  /** Variante "sem fundo" — só a bolinha + texto. Bom dentro de tabelas densas. */
  subtle?: boolean;
  className?: string;
}

const VARIANT_BG: Record<StatusVariant, string> = {
  online:  'bg-success-muted text-success',
  warn:    'bg-warning-muted text-warning',
  offline: 'bg-surface-muted text-text-muted',
  error:   'bg-danger-muted text-danger',
};

export function StatusBadge({
  status,
  label,
  children,
  subtle = false,
  className,
}: StatusBadgeProps) {
  const text = children ?? label;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium',
        subtle
          ? 'text-text-muted'
          : `rounded-md px-1.5 py-0.5 ${VARIANT_BG[status]}`,
        className,
      )}
    >
      <span className="dot-status" data-status={status} aria-hidden />
      {text}
    </span>
  );
}

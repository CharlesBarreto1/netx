'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/cn';

/**
 * Tooltip — Radix Tooltip com skin NetX: texto denso, borda + shadow-pop,
 * delay curto padrão (150ms). Em aplicações keyboard-first (Linear-style),
 * um delay muito longo prejudica a descoberta.
 */
export const TooltipProvider = ({
  delayDuration = 150,
  ...props
}: ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>) => (
  <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />
);
TooltipProvider.displayName = 'TooltipProvider';

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = forwardRef<
  ElementRef<typeof TooltipPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent({ className, sideOffset = 4, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'z-50 overflow-hidden rounded-md border border-border bg-surface px-2 py-1 text-xs text-text shadow-pop',
          'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out',
          'data-[state=delayed-open]:fade-in-0 data-[state=closed]:fade-out-0',
          'data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1',
          'data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});

/**
 * Helper para o caso mais comum: um trigger + texto simples.
 *
 *   <SimpleTooltip label="Arrastar"><button>…</button></SimpleTooltip>
 *
 * Auto-provido: embute o próprio `TooltipProvider`, então funciona em
 * QUALQUER lugar sem depender de um Provider ancestral. Radix permite
 * Providers aninhados — usar `SimpleTooltip` dentro de uma árvore que já
 * tem um Provider é inofensivo (o mais próximo vence).
 */
export function SimpleTooltip({
  label,
  children,
  side,
  shortcut,
}: {
  label: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  shortcut?: string;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>
          <span className="inline-flex items-center gap-2">
            {label}
            {shortcut && (
              <span className="text-text-subtle" style={{ fontFamily: 'var(--font-mono)' }}>
                {shortcut}
              </span>
            )}
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

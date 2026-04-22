import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

/**
 * Kbd — exibe um atalho de teclado (⌘K, ↵, esc...). Escolhi não reutilizar a
 * classe `.kbd` global para poder compor múltiplos `<Kbd>` na mesma linha com
 * `gap-1`:
 *
 *   <span className="inline-flex items-center gap-1">
 *     <Kbd>⌘</Kbd><Kbd>K</Kbd>
 *   </span>
 */
export const Kbd = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
  function Kbd({ className, ...props }, ref) {
    return (
      <kbd
        ref={ref}
        className={cn(
          'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded',
          'border border-border-strong bg-surface-muted px-1 text-2xs font-medium',
          'text-text-muted shadow-xs',
          className,
        )}
        style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
        {...props}
      />
    );
  },
);

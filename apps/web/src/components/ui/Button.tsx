import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant =
  | 'primary' // accent (azul) sólido
  | 'secondary' // surface-muted neutro
  | 'ghost' // sem fundo, hover leve
  | 'danger' // ações destrutivas
  | 'outline' // borda visível, fundo transparente
  | 'subtle'; // texto accent sobre accent-muted
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

/**
 * Botão base NetX (estilo Linear).
 *
 * - Altura padrão `md` = 32px (denso).
 * - Usa tokens semânticos (`accent`, `surface`, `border`...), compatível com
 *   dark mode via CSS vars em `globals.css`.
 * - `size="icon"` assume 32×32; use `icon-sm` (26×26) em toolbars muito densas.
 */
const variantClass: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-foreground shadow-xs ' +
    'hover:bg-accent/90 focus-visible:ring-ring ' +
    'disabled:bg-accent/50 disabled:text-accent-foreground/80',
  secondary:
    'bg-surface-muted text-text hover:bg-surface-hover border border-border ' +
    'focus-visible:ring-ring',
  ghost: 'bg-transparent text-text-muted hover:bg-surface-hover hover:text-text',
  danger:
    'bg-danger text-danger-foreground hover:bg-danger/90 focus-visible:ring-danger ' +
    'disabled:bg-danger/50',
  outline:
    'border border-border bg-surface text-text hover:bg-surface-hover ' +
    'focus-visible:ring-ring',
  subtle:
    'bg-accent-muted text-accent hover:bg-accent-muted/70 focus-visible:ring-ring',
};

const sizeClass: Record<Size, string> = {
  xs: 'h-6 px-2 text-xs gap-1',
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-8 px-3 text-sm gap-1.5',
  lg: 'h-10 px-4 text-sm gap-2',
  icon: 'h-8 w-8',
  'icon-sm': 'h-6 w-6',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0',
        'disabled:cursor-not-allowed',
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...props}
    >
      {loading && (
        <svg
          className="h-3.5 w-3.5 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          aria-hidden
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" />
          <path className="opacity-75" d="M4 12a8 8 0 018-8" />
        </svg>
      )}
      {children}
    </button>
  );
});

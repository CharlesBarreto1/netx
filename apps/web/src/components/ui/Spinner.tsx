import { cn } from '@/lib/cn';

/** Spinner simples baseado em SVG, tamanho controlado via className. */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-5 w-5 animate-spin text-brand-600', className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" />
      <path className="opacity-75" d="M4 12a8 8 0 018-8" />
    </svg>
  );
}

export function PageLoader({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500 dark:text-slate-400">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function InlineLoader({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
      <Spinner className="h-4 w-4" />
      {label}
    </span>
  );
}

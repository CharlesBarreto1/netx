import { useTranslations } from 'next-intl';

import { cn } from '@/lib/cn';

type Tone =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'brand'
  | 'purple';

const toneClass: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  danger: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  info: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  brand: 'bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-100',
  // Roxo — usado no status "Em Execução" das O.S.
  purple:
    'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  dot,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
  dot?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        toneClass[tone],
        className,
      )}
    >
      {dot && (
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: dot }}
        />
      )}
      {children}
    </span>
  );
}

/** Mapeia status de cliente para tom da Badge. */
export function statusTone(status: string): Tone {
  switch (status) {
    case 'ACTIVE':
      return 'success';
    case 'SUSPENDED':
    case 'INACTIVE':
      return 'warning';
    case 'CHURNED':
      return 'danger';
    case 'LEAD':
    case 'PROSPECT':
      return 'info';
    default:
      return 'neutral';
  }
}

const STATUS_KEYS = [
  'LEAD',
  'PROSPECT',
  'ACTIVE',
  'SUSPENDED',
  'INACTIVE',
  'CHURNED',
] as const;

/**
 * Mapa de status de cliente -> label traduzido.
 * Hook (client-only): resolve via i18n no namespace `components.badge`.
 */
export function useStatusLabel(): Record<string, string> {
  const t = useTranslations('components.badge');
  return Object.fromEntries(
    STATUS_KEYS.map((key) => [key, t(`status.${key}`)]),
  );
}

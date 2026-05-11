/**
 * Skeleton — loading placeholder com shimmer animado.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Substitui o `Spinner` em listagens — UX percebida é melhor (usuário vê o
 * "esqueleto" da página) que um spinner genérico no centro.
 *
 * Uso:
 *   <Skeleton className="h-8 w-32" />
 *   <SkeletonText lines={3} />
 *   <SkeletonRow cols={5} />     ← linha de tabela
 *   <SkeletonCard />
 */
import { cn } from '@/lib/cn';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('skeleton', className)} {...props} />;
}

/** Bloco de texto com N linhas; a última fica 60% da largura (mais natural). */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn('h-3.5', i === lines - 1 ? 'w-3/5' : 'w-full')}
        />
      ))}
    </div>
  );
}

/** Uma linha de tabela com N células — usado em listagens enquanto SWR carrega. */
export function SkeletonRow({ cols = 4, className }: { cols?: number; className?: string }) {
  return (
    <tr className={className}>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-3 py-2.5">
          <Skeleton className={cn('h-3.5', i === 0 ? 'w-32' : 'w-20')} />
        </td>
      ))}
    </tr>
  );
}

/** Card placeholder — pra dashboard, métricas, etc. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('card p-4', className)}>
      <Skeleton className="mb-3 h-4 w-24" />
      <Skeleton className="mb-2 h-8 w-32" />
      <Skeleton className="h-3 w-40" />
    </div>
  );
}

/** Avatar circular skeleton. */
export function SkeletonAvatar({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <Skeleton
      className={cn('rounded-full', className)}
      style={{ width: size, height: size }}
    />
  );
}

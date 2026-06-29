'use client';

/**
 * Placeholder de "Em breve" pras subtelas do módulo Mapeamento que ainda
 * não foram implementadas. Mantém visual consistente + linka pra tela
 * Clientes (única funcional na v1).
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ComponentType } from 'react';

import { Button } from '@/components/ui/Button';

export function ComingSoonPlaceholder({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  const t = useTranslations('comingSoon');
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      </header>

      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border bg-surface p-12 text-center">
        <div className="rounded-full bg-accent-muted p-4">
          <Icon className="h-10 w-10 text-accent" />
        </div>
        <div>
          <div className="text-lg font-semibold text-text">{t('badge')}</div>
          <p className="mx-auto mt-2 max-w-md text-sm text-text-muted">
            {description}
          </p>
        </div>
        <div className="flex gap-2 pt-2">
          <Link href="/mapping/customers">
            <Button variant="outline">{t('viewCustomerMap')}</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

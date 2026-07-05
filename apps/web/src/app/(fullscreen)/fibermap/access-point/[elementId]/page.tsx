'use client';

/**
 * /fibermap/access-point/[elementId] — Ponto de Acesso (Tela 2 · FM-3, §8).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Página fina no route group (fullscreen): header com volta pro estúdio +
 * nome do elemento, e o AccessPointEditor (SVG) ocupando o resto.
 */
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { AccessPointEditor } from '@/components/fibermap/access-point/AccessPointEditor';
import type { FibermapElement } from '@/lib/fibermap-api';

export default function AccessPointPage() {
  const t = useTranslations('fibermap');
  const params = useParams<{ elementId: string }>();
  const elementId = params.elementId;
  // Só pro título/deep-link de volta — o editor tem o próprio SWR.
  const { data: element } = useSWR<FibermapElement>(
    elementId ? `/v1/fibermap/elements/${elementId}` : null,
  );

  const backHref = element
    ? (`/fibermap?lat=${element.latitude}&lng=${element.longitude}&z=17` as const)
    : ('/fibermap' as const);

  return (
    <div className="flex h-screen w-screen flex-col bg-bg text-text">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-2 shadow-sm print:hidden">
        <Link
          href={backHref}
          className="flex h-8 items-center gap-1 rounded-md px-2 text-sm font-medium text-text-muted hover:bg-surface-hover hover:text-text"
        >
          <ChevronLeft className="h-4 w-4" />
          {t('ap.backToMap')}
        </Link>
        <div className="mx-1 h-6 w-px bg-border" />
        <h1 className="truncate text-sm font-semibold text-text">
          {t('ap.title', { name: element?.name ?? '…' })}
        </h1>
      </header>
      <main className="min-h-0 flex-1">
        {elementId && <AccessPointEditor elementId={elementId} />}
      </main>
    </div>
  );
}

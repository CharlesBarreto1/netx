'use client';

/**
 * /fibermap/access-point/[elementId] — Ponto de Acesso (Tela 2 · FM-3, §8).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Página fina no route group (fullscreen): header com volta pro estúdio +
 * nome do elemento, e o AccessPointEditor (SVG) ocupando o resto.
 */
import { ChevronLeft, LocateFixed } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import { AccessPointEditor } from '@/components/fibermap/access-point/AccessPointEditor';
import { OtdrModal } from '@/components/fibermap/otdr/OtdrModal';
import type { FibermapOtdrOverlay } from '@/components/fibermap/studio/FibermapMap';
import { Button } from '@/components/ui/Button';
import { FIBERMAP_OTDR_STORAGE_KEY, type FibermapElement } from '@/lib/fibermap-api';

export default function AccessPointPage() {
  const t = useTranslations('fibermap');
  const params = useParams<{ elementId: string }>();
  const router = useRouter();
  const elementId = params.elementId;
  const [otdrOpen, setOtdrOpen] = useState(false);
  // Só pro título/deep-link de volta — o editor tem o próprio SWR.
  const { data: element } = useSWR<FibermapElement>(
    elementId ? `/v1/fibermap/elements/${elementId}` : null,
  );

  // "Ver no mapa" do OTDR: persiste o overlay e volta pro estúdio (FM-5).
  function showOtdrOnMap(overlay: FibermapOtdrOverlay) {
    window.sessionStorage.setItem(FIBERMAP_OTDR_STORAGE_KEY, JSON.stringify(overlay));
    router.push('/fibermap');
  }

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
        <Button
          size="xs"
          variant="outline"
          className="ml-auto"
          onClick={() => setOtdrOpen(true)}
        >
          <LocateFixed className="mr-1 h-3.5 w-3.5" />
          {t('otdr.open')}
        </Button>
      </header>
      <main className="min-h-0 flex-1">
        {elementId && <AccessPointEditor elementId={elementId} />}
      </main>
      {otdrOpen && elementId && (
        <OtdrModal
          elementId={elementId}
          onClose={() => setOtdrOpen(false)}
          onShowOnMap={showOtdrOnMap}
        />
      )}
    </div>
  );
}

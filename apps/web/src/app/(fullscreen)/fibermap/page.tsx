'use client';

/**
 * /fibermap — Estúdio FiberMap (Tela 1 · FM-1, FIBERMAP-SPEC §7).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Página fina: resolve o viewport inicial da querystring (?lat&lng&z —
 * deep-link gerado pelo próprio estúdio a cada moveend) e delega tudo pro
 * FibermapStudio. Route group (fullscreen) = sessão garantida, sem AppShell.
 */
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { FibermapStudio } from '@/components/fibermap/studio/FibermapStudio';
import type { StudioView } from '@/components/fibermap/studio/constants';

// Fixture FM-0 (Campo Mourão-PR). Default até o operador navegar — depois o
// viewport vive na querystring e o refresh/link volta pro mesmo lugar.
const DEFAULT_VIEW: StudioView = { latitude: -24.052, longitude: -52.37, zoom: 14 };

function parseNum(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function FibermapPageInner() {
  const sp = useSearchParams();
  const lat = parseNum(sp.get('lat'));
  const lng = parseNum(sp.get('lng'));
  const zoom = parseNum(sp.get('z'));

  const initialView: StudioView =
    lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
      ? { latitude: lat, longitude: lng, zoom: zoom ?? DEFAULT_VIEW.zoom }
      : DEFAULT_VIEW;

  return <FibermapStudio initialView={initialView} />;
}

export default function FibermapPage() {
  // useSearchParams exige boundary de Suspense fora de render dinâmico.
  return (
    <Suspense fallback={null}>
      <FibermapPageInner />
    </Suspense>
  );
}

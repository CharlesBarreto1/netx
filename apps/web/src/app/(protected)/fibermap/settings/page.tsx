'use client';

/**
 * /fibermap/settings — Tela 3 do FiberMap: Configurações do Mapa (spec §10).
 *
 * Hub de configuração do módulo em duas abas:
 *   • Catálogo de produtos — cabos (com preview vivo do corte transversal),
 *     CEOs, CTOs, DIOs, armários, racks e splitters;
 *   • Parâmetros — defaults de atenuação (spec §5.3).
 *
 * Página fina (client component): estado de aba/categoria vive na query
 * string (convention §7 — link compartilhável, back/forward funciona);
 * a lógica mora em components/fibermap/settings/*.
 *
 * Permissão: mutações exigem `fibermap.admin` (gating de UX — a autoridade
 * é o backend). Sem ela, a tela fica somente leitura.
 */
import { Package, SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';

import { AttenuationTab } from '@/components/fibermap/settings/AttenuationTab';
import { CatalogTab } from '@/components/fibermap/settings/CatalogTab';
import { Tabs } from '@/components/ui/Tabs';
import { hasPermission } from '@/lib/session';

type SettingsTab = 'catalog' | 'parameters';

export default function FibermapSettingsPage() {
  const t = useTranslations('fibermap');
  const router = useRouter();
  const sp = useSearchParams();

  const tab: SettingsTab = sp?.get('tab') === 'parameters' ? 'parameters' : 'catalog';
  const canAdmin = hasPermission('fibermap.admin');

  function setTab(next: SettingsTab) {
    const params = new URLSearchParams(sp?.toString() ?? '');
    params.set('tab', next);
    // `cat` (sub-aba de categoria) só faz sentido dentro do catálogo.
    if (next !== 'catalog') params.delete('cat');
    router.replace(`/fibermap/settings?${params.toString()}`);
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-text">
          {t('settings.title')}
        </h1>
        <p className="text-sm text-text-muted">{t('settings.subtitle')}</p>
        {!canAdmin && (
          <p className="mt-1 text-xs text-text-subtle">{t('settings.readOnly')}</p>
        )}
      </header>

      <Tabs<SettingsTab>
        value={tab}
        onChange={setTab}
        items={[
          {
            value: 'catalog',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Package className="h-4 w-4" />
                {t('settings.tabs.catalog')}
              </span>
            ),
          },
          {
            value: 'parameters',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <SlidersHorizontal className="h-4 w-4" />
                {t('settings.tabs.parameters')}
              </span>
            ),
          },
        ]}
      />

      {tab === 'catalog' ? (
        <CatalogTab canAdmin={canAdmin} />
      ) : (
        <AttenuationTab canAdmin={canAdmin} />
      )}
    </div>
  );
}

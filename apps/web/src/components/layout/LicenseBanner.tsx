'use client';

/**
 * Banner de aviso de licença — aparece no topo do conteúdo quando a licença
 * está no período de GRAÇA (expirada mas ainda não bloqueada) pra dar tempo de
 * regularizar antes do 402. Quando ALLOW/DISABLED, não renderiza nada.
 *
 * O bloqueio de fato (402 → /license-expired) é tratado no api.ts; aqui é só o
 * aviso amigável. Usa SWR com refresh espaçado — não é dado crítico de tela.
 */
import useSWR from 'swr';
import { useTranslations } from 'next-intl';

import { licenseApi, type LicenseStatusResponse } from '@/lib/license-api';

export function LicenseBanner() {
  const t = useTranslations('license');
  const { data } = useSWR<LicenseStatusResponse>(
    licenseApi.statusPath(),
    () => licenseApi.status(),
    { refreshInterval: 60 * 60 * 1000, shouldRetryOnError: false },
  );

  if (!data || data.effect !== 'GRACE') return null;

  const when = data.expiresAt ? new Date(data.expiresAt).toLocaleDateString() : null;

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <svg
        width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className="mt-0.5 shrink-0" aria-hidden="true"
      >
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <path d="M12 9v4" /><path d="M12 17h.01" />
      </svg>
      <div>
        <p className="font-medium">{t('graceTitle')}</p>
        <p className="text-xs opacity-90">
          {when ? t('graceBodyWithDate', { date: when }) : t('graceBody')}
        </p>
      </div>
    </div>
  );
}

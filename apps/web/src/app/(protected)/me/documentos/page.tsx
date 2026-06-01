'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { hrApi, type EmployeeDocument } from '@/lib/hr-api';

export default function MeDocumentosPage() {
  const t = useTranslations('me.documents');
  const tc = useTranslations('common');
  const te = useTranslations('hr.enums');
  const { data, isLoading, mutate } = useSWR<{ pendingSignature: EmployeeDocument[]; signed: EmployeeDocument[] }>(
    '/v1/hr/me/documents',
    () => hrApi.meDocuments(),
  );
  const [signing, setSigning] = useState<EmployeeDocument | null>(null);
  const [busy, setBusy] = useState(false);

  if (isLoading) return <PageLoader />;
  const pending = data?.pendingSignature ?? [];
  const signed = data?.signed ?? [];

  async function download(d: EmployeeDocument) {
    const { url } = await hrApi.meDocumentDownload(d.id);
    window.open(url, '_blank');
  }
  async function confirmSign() {
    if (!signing) return;
    setBusy(true);
    try {
      await hrApi.meSignDocument(signing.id);
      setSigning(null);
      await mutate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('subtitle')}
        </p>
      </header>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-600">{t('pendingSignature')}</h2>
        {pending.length === 0 && <p className="text-sm text-slate-500">{t('nothingPending')}</p>}
        <div className="space-y-2">
          {pending.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
              <div>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">{te(`docType.${d.type}`)}</span>{' '}
                <strong>{d.title}</strong>
              </div>
              <div className="flex gap-1">
                {d.storageKey && <Button size="sm" variant="ghost" onClick={() => download(d)}>{t('read')}</Button>}
                <Button size="sm" onClick={() => setSigning(d)}>{t('sign')}</Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{t('signed')}</h2>
        {signed.length === 0 && <p className="text-sm text-slate-500">{t('noneSigned')}</p>}
        <div className="space-y-2">
          {signed.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
              <div>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-700">{te(`docType.${d.type}`)}</span>{' '}
                <strong>{d.title}</strong>
                {d.signature && <span className="ml-2 text-xs text-green-600">✓ {new Date(d.signature.signedAt).toLocaleDateString('pt-BR')}</span>}
              </div>
              {d.storageKey && <Button size="sm" variant="ghost" onClick={() => download(d)}>{tc('download')}</Button>}
            </div>
          ))}
        </div>
      </section>

      {signing && (
        <ConfirmDialog
          open
          title={t('signTitle', { title: signing.title })}
          message={t('signMessage')}
          confirmLabel={t('signConfirm')}
          loading={busy}
          onConfirm={confirmSign}
          onClose={() => setSigning(null)}
        />
      )}
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import {
  hrApi,
  fmtMinutes,
  type SelfDashboard,
  type TimeEntryType,
} from '@/lib/hr-api';

export default function MePage() {
  const t = useTranslations('me.home');
  const te = useTranslations('hr.enums');
  const { data, isLoading, error, mutate } = useSWR<SelfDashboard>('/v1/hr/me/dashboard', () => hrApi.meDashboard());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (isLoading) return <PageLoader />;
  if (error) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
        {t('notLinked')}
      </div>
    );
  }
  if (!data) return null;

  async function punch(type: TimeEntryType) {
    setBusy(true);
    setMsg(null);
    try {
      const pos = await getPosition();
      await hrApi.meClock({ type, latitude: pos?.lat ?? null, longitude: pos?.lng ?? null });
      setMsg(t('punchToast', { label: te(`entryType.${type}`) }));
      await mutate();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.friendlyMessage : t('punchError'));
    } finally {
      setBusy(false);
    }
  }

  const next = data.clock.nextAction;
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t('greeting', { name: data.profile.preferredName || data.profile.fullName.split(' ')[0] })}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {[data.profile.position, data.profile.department].filter(Boolean).join(' · ')}
        </p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="text-xs uppercase tracking-wide text-slate-500">{t('timeClock')}</div>
        <div className="mt-1 text-3xl font-bold">{t('workedToday', { time: fmtMinutes(data.clock.todayWorkedMinutes) })}</div>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button onClick={() => punch(next)} loading={busy} size="lg">
            {t('punchAction', { action: te(`entryType.${next}`).toLowerCase() })}
          </Button>
          <Button variant="ghost" onClick={() => punch('BREAK_START')} disabled={busy}>{t('breakStart')}</Button>
          <Button variant="ghost" onClick={() => punch('BREAK_END')} disabled={busy}>{t('breakEnd')}</Button>
        </div>
        {msg && <p className="mt-3 text-sm text-slate-500">{msg}</p>}
        {data.clock.todayEntries.length > 0 && (
          <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs text-slate-500">
            {data.clock.todayEntries.map((e, i) => (
              <span key={i} className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-700">
                {te(`entryType.${e.type}`)} {new Date(e.occurredAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link href="/me/ponto" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-800/60">
          <div className="font-semibold">{t('myTimeSheet')}</div>
          <div className="text-sm text-slate-500">{t('myTimeSheetDesc')}</div>
        </Link>
        <Link href="/me/rendimentos" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-800/60">
          <div className="font-semibold">{t('myEarnings')}</div>
          <div className="text-sm text-slate-500">{t('myEarningsDesc')}</div>
        </Link>
        <Link href="/me/documentos" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-800/60">
          <div className="font-semibold">{t('myDocuments')} {data.pendingSignatures > 0 && <span className="ml-1 rounded-full bg-amber-500 px-2 py-0.5 text-xs text-white">{data.pendingSignatures}</span>}</div>
          <div className="text-sm text-slate-500">{t('pendingSignature')}</div>
        </Link>
      </div>

      {data.latestPosts.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-semibold">{t('news')}</h2>
          <div className="space-y-2">
            {data.latestPosts.map((p) => (
              <Link key={p.id} href="/me/noticias" className="block rounded-lg border border-slate-200 bg-white p-3 text-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-800/60">
                {p.pinned && '📌 '}<strong>{p.title}</strong>
                {p.excerpt && <p className="text-slate-500">{p.excerpt}</p>}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function getPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 4000 },
    );
  });
}

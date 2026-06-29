'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { PortalApiError, portalApi } from '@/lib/portal-api';

export default function PortalLoginPage() {
  const t = useTranslations('portal');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [taxId, setTaxId] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      await portalApi.login({ taxId, code });
      router.push('/portal');
    } catch (e) {
      setErr(
        e instanceof PortalApiError
          ? e.detail
          : (e as Error)?.message ?? tCommon('error'),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-xl shadow-xl bg-white dark:bg-slate-800 p-8 space-y-4"
      >
        <div className="text-center">
          <h1 className="text-2xl font-bold">{t('login.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t('login.subtitle')}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            {t('login.taxIdLabel')}
          </label>
          <input
            className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 bg-transparent"
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            placeholder={t('login.taxIdPlaceholder')}
            required
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            {t('login.codeLabel')}
          </label>
          <input
            className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 bg-transparent font-mono tracking-widest"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCD2345"
            maxLength={12}
            required
          />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t('login.codeHint')}
          </p>
        </div>

        {err && (
          <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/40 rounded-md px-3 py-2">
            {err}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !taxId || code.length < 6}
          className="w-full py-2.5 rounded-md bg-brand-600 text-white font-semibold hover:bg-brand-700 disabled:opacity-60"
        >
          {loading ? t('login.submitting') : t('login.submit')}
        </button>

        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          {t('login.noCode')}
        </p>
      </form>
    </main>
  );
}

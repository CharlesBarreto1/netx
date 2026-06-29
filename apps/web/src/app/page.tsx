'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { AuthI18nProvider } from '@/lib/auth-i18n-provider';

export default function Home() {
  return (
    <AuthI18nProvider>
      <LandingContent />
    </AuthI18nProvider>
  );
}

function LandingContent() {
  const t = useTranslations('landing');

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-200 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center px-4">
      <div className="max-w-2xl text-center space-y-6">
        <p className="text-sm font-semibold uppercase tracking-widest text-brand-600">NetX</p>
        <h1 className="text-5xl font-bold text-slate-900 dark:text-slate-100">
          {t('headline')}
        </h1>
        <p className="text-lg text-slate-600 dark:text-slate-300">
          {t('subhead')}
        </p>
        <div className="flex gap-4 justify-center pt-4">
          <Link
            href="/login"
            className="px-6 py-3 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700 transition"
          >
            {t('signIn')}
          </Link>
          <a
            href="http://localhost:3000/api/docs"
            target="_blank"
            rel="noreferrer"
            className="px-6 py-3 rounded-lg border border-slate-300 dark:border-slate-600 font-semibold hover:bg-slate-100 dark:hover:bg-slate-700 transition"
          >
            API Docs
          </a>
        </div>
        <p className="text-xs text-slate-400 pt-8">
          {t('footer')}
        </p>
      </div>
    </main>
  );
}

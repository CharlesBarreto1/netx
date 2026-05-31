'use client';

import useSWR from 'swr';

import { PageLoader } from '@/components/ui/Spinner';
import { hrApi, type CompanyPost } from '@/lib/hr-api';

export default function MeNoticiasPage() {
  const { data, isLoading } = useSWR<CompanyPost[]>('/v1/hr/me/feed', () => hrApi.meFeed());
  if (isLoading) return <PageLoader />;
  const posts = data ?? [];

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Notícias</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Comunicados e novidades da empresa.</p>
      </header>

      {posts.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          Nenhuma notícia publicada.
        </p>
      )}

      <div className="space-y-4">
        {posts.map((p) => (
          <article key={p.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <h2 className="text-lg font-semibold">{p.pinned && '📌 '}{p.title}</h2>
            <div className="mt-1 text-xs text-slate-400">
              {p.author?.name}{p.publishedAt ? ` · ${new Date(p.publishedAt).toLocaleDateString('pt-BR')}` : ''}
            </div>
            <div className="mt-3 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{p.body}</div>
          </article>
        ))}
      </div>
    </div>
  );
}

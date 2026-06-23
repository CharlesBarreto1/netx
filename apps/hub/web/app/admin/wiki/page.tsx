'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { adminApi, adminToken, HubApiError } from '@/lib/api';
import { AdminNav } from '@/components/AdminNav';
import { inputCls } from '@/components/ui';

export default function WikiList() {
  const router = useRouter();
  const [articles, setArticles] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!adminToken.get()) {
      router.replace('/admin/login');
      return;
    }
    adminApi
      .wikiList()
      .then(setArticles)
      .catch((e) => {
        if (e instanceof HubApiError && e.status === 401) router.replace('/admin/login');
        else setErr('Falha ao carregar.');
      });
  }, [router]);

  const grouped = useMemo(() => {
    const list = (articles ?? []).filter((a) =>
      q ? a.title.toLowerCase().includes(q.toLowerCase()) : true,
    );
    const map = new Map<string, any[]>();
    for (const a of list) {
      const arr = map.get(a.category) ?? [];
      arr.push(a);
      map.set(a.category, arr);
    }
    return [...map.entries()];
  }, [articles, q]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <AdminNav />
      <header className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold">Wiki — base de conhecimento</h1>
        <Link href="/admin/wiki/new" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
          Novo artigo
        </Link>
      </header>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por título…"
        className={`${inputCls} mb-5 max-w-sm`}
      />

      {err && <p className="text-sm text-red-600">{err}</p>}
      {!articles ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : grouped.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhum artigo.</p>
      ) : (
        <div className="space-y-6">
          {grouped.map(([cat, items]) => (
            <section key={cat}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{cat}</h2>
              <ul className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                {items.map((a) => (
                  <li key={a.id} className="border-b border-slate-100 last:border-0">
                    <Link href={`/admin/wiki/${a.slug}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                      <span className="font-medium text-slate-800">{a.title}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${a.audience === 'CLIENT' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                        {a.audience === 'CLIENT' ? 'Cliente' : 'Interno'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

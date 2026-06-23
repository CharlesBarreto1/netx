'use client';

import { marked } from 'marked';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { portalApi, portalToken, HubApiError } from '@/lib/api';
import { inputCls } from '@/components/ui';

/**
 * Central de ajuda do cliente (artigos audience=CLIENT, somente leitura).
 * Lista à esquerda (por categoria) + artigo selecionado renderizado.
 */
export default function PortalAjuda() {
  const router = useRouter();
  const [articles, setArticles] = useState<any[] | null>(null);
  const [current, setCurrent] = useState<any>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!portalToken.get()) {
      router.replace('/portal/login');
      return;
    }
    portalApi
      .wikiList()
      .then(async (list) => {
        setArticles(list);
        if (list[0]) setCurrent(await portalApi.wikiGet(list[0].slug));
      })
      .catch((e) => {
        if (e instanceof HubApiError && e.status === 401) router.replace('/portal/login');
        else setErr('Falha ao carregar a central de ajuda.');
      });
  }, [router]);

  async function open(slug: string) {
    setCurrent(await portalApi.wikiGet(slug));
  }

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
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Central de ajuda</h1>
          <p className="text-sm text-slate-500">Como usar o NetX</p>
        </div>
        <Link href="/portal" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
          ← Voltar
        </Link>
      </header>

      {err && <p className="text-sm text-red-600">{err}</p>}
      {!articles ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : articles.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhum artigo disponível.</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[260px_1fr]">
          {/* Índice */}
          <aside>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar…"
              className={`${inputCls} mb-3`}
            />
            <nav className="space-y-4">
              {grouped.map(([cat, items]) => (
                <div key={cat}>
                  <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{cat}</h2>
                  <ul className="space-y-1">
                    {items.map((a) => (
                      <li key={a.id}>
                        <button
                          onClick={() => open(a.slug)}
                          className={`block w-full rounded px-2 py-1 text-left text-sm hover:bg-slate-100 ${current?.slug === a.slug ? 'bg-slate-100 font-medium' : 'text-slate-700'}`}
                        >
                          {a.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </aside>

          {/* Artigo */}
          <article className="rounded-lg border border-slate-200 bg-white p-6">
            {current ? (
              <div className="md" dangerouslySetInnerHTML={{ __html: marked.parse(current.content) as string }} />
            ) : (
              <p className="text-sm text-slate-500">Selecione um artigo.</p>
            )}
          </article>
        </div>
      )}
    </main>
  );
}

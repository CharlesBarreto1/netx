'use client';

import { marked } from 'marked';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { adminApi, adminToken, date, HubApiError } from '@/lib/api';
import { AdminNav } from '@/components/AdminNav';
import { Field, inputCls } from '@/components/ui';

export default function WikiArticlePage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [a, setA] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  // form
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [audience, setAudience] = useState<'INTERNAL' | 'CLIENT'>('INTERNAL');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const art = await adminApi.wikiGet(slug);
      setA(art);
      setTitle(art.title);
      setCategory(art.category);
      setAudience(art.audience);
      setContent(art.content);
    } catch (e) {
      if (e instanceof HubApiError && e.status === 401) router.replace('/admin/login');
      else setErr('Artigo não encontrado.');
    }
  }
  useEffect(() => {
    if (!adminToken.get()) router.replace('/admin/login');
    else void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function save() {
    setSaving(true);
    try {
      await adminApi.wikiUpdate(a.id, { title, category, audience, content });
      setEditing(false);
      await load();
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!confirm('Excluir este artigo?')) return;
    await adminApi.wikiRemove(a.id);
    router.replace('/admin/wiki');
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <AdminNav />
      <Link href="/admin/wiki" className="text-sm text-blue-700 hover:underline">← Wiki</Link>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      {!a ? (
        !err && <p className="mt-3 text-sm text-slate-500">Carregando…</p>
      ) : editing ? (
        <div className="mt-3 flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Título"><input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} /></Field>
            <Field label="Categoria"><input value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls} /></Field>
            <Field label="Público">
              <select value={audience} onChange={(e) => setAudience(e.target.value as 'INTERNAL' | 'CLIENT')} className={inputCls}>
                <option value="INTERNAL">Interno (equipe NetX)</option>
                <option value="CLIENT">Cliente (central de ajuda)</option>
              </select>
            </Field>
          </div>
          <Field label="Conteúdo (markdown)">
            <textarea value={content} onChange={(e) => setContent(e.target.value)} className={`${inputCls} h-96 font-mono text-xs`} />
          </Field>
          <div className="flex justify-end gap-2">
            <button onClick={() => { setEditing(false); setContent(a.content); setTitle(a.title); setCategory(a.category); }} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">Cancelar</button>
            <button onClick={save} disabled={saving} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">{saving ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </div>
      ) : (
        <article className="mt-3">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{a.category}</span>
              <h1 className="text-2xl font-bold">{a.title}</h1>
              <p className="text-xs text-slate-400">
                Atualizado {date(a.updatedAt)}{a.updatedByEmail ? ` por ${a.updatedByEmail}` : ''}
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditing(true)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">Editar</button>
              <button onClick={remove} className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600">Excluir</button>
            </div>
          </div>
          <div className="md" dangerouslySetInnerHTML={{ __html: marked.parse(a.content) as string }} />
        </article>
      )}
    </main>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { adminApi, adminToken, HubApiError } from '@/lib/api';
import { AdminNav } from '@/components/AdminNav';
import { Field, inputCls } from '@/components/ui';

export default function NewWikiArticle() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Geral');
  const [audience, setAudience] = useState<'INTERNAL' | 'CLIENT'>('INTERNAL');
  const [content, setContent] = useState('# Título\n\nEscreva em **markdown**.');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (typeof window !== 'undefined' && !adminToken.get()) {
    router.replace('/admin/login');
  }

  async function save() {
    setErr(null);
    setSaving(true);
    try {
      const a = await adminApi.wikiCreate({ title, category, audience, content });
      router.replace(`/admin/wiki/${a.slug}`);
    } catch (e) {
      setErr(e instanceof HubApiError ? e.message : 'Falha ao salvar.');
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <AdminNav />
      <h1 className="mb-4 text-xl font-bold">Novo artigo</h1>
      <div className="flex flex-col gap-3">
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
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={() => router.back()} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">Cancelar</button>
          <button onClick={save} disabled={saving || !title} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
            {saving ? 'Salvando…' : 'Criar'}
          </button>
        </div>
      </div>
    </main>
  );
}

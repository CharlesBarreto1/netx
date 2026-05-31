'use client';

import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import { hrApi, type CompanyPost, type CompanyPostStatus, type Paginated } from '@/lib/hr-api';

const STATUS_LABEL: Record<CompanyPostStatus, string> = {
  DRAFT: 'Rascunho',
  PUBLISHED: 'Publicado',
  ARCHIVED: 'Arquivado',
};

export default function HrPostsPage() {
  const { data, isLoading, mutate } = useSWR<Paginated<CompanyPost>>(
    hrApi.postsPath({ pageSize: 100 }),
    () => hrApi.listPosts({ pageSize: 100 }),
  );
  const [editing, setEditing] = useState<CompanyPost | null>(null);
  const [creating, setCreating] = useState(false);
  const rows = data?.data ?? [];

  async function del(p: CompanyPost) { await hrApi.deletePost(p.id); await mutate(); }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notícias da empresa</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Feed do portal do colaborador. Publique avisos, comunicados e novidades.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>Nova publicação</Button>
      </header>

      {isLoading && <PageLoader />}
      {rows.length === 0 && !isLoading && (
        <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          Nenhuma publicação.
        </p>
      )}

      <div className="space-y-2">
        {rows.map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
            <div>
              {p.pinned && <span className="mr-1">📌</span>}
              <strong>{p.title}</strong>
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-700">{STATUS_LABEL[p.status]}</span>
              {p.publishedAt && <span className="ml-2 text-xs text-slate-400">{new Date(p.publishedAt).toLocaleDateString('pt-BR')}</span>}
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>Editar</Button>
              <Button size="sm" variant="ghost" onClick={() => del(p)}>Excluir</Button>
            </div>
          </div>
        ))}
      </div>

      {(creating || editing) && (
        <PostModal
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={async () => { setCreating(false); setEditing(null); await mutate(); }}
        />
      )}
    </div>
  );
}

function PostModal({ initial, onClose, onSaved }: { initial: CompanyPost | null; onClose: () => void; onSaved: () => void }) {
  const isNew = !initial;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [excerpt, setExcerpt] = useState(initial?.excerpt ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [status, setStatus] = useState<CompanyPostStatus>(initial?.status ?? 'DRAFT');
  const [pinned, setPinned] = useState(initial?.pinned ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim() || !body.trim()) return setError('Título e conteúdo são obrigatórios');
    setBusy(true);
    setError(null);
    try {
      const payload = { title, excerpt: excerpt || null, body, status, pinned };
      if (isNew) await hrApi.createPost(payload);
      else await hrApi.updatePost(initial!.id, payload);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'Nova publicação' : 'Editar publicação'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} loading={busy}>Salvar</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <div className="rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
        <div><Label>Título</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div><Label>Resumo (opcional)</Label><Input value={excerpt} onChange={(e) => setExcerpt(e.target.value)} /></div>
        <div><Label>Conteúdo (markdown)</Label><Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} /></div>
        <div className="flex items-center gap-4">
          <div>
            <Label>Status</Label>
            <select className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" value={status} onChange={(e) => setStatus(e.target.value as CompanyPostStatus)}>
              <option value="DRAFT">Rascunho</option>
              <option value="PUBLISHED">Publicado</option>
              <option value="ARCHIVED">Arquivado</option>
            </select>
          </div>
          <label className="mt-5 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Fixar no topo
          </label>
        </div>
      </div>
    </Modal>
  );
}

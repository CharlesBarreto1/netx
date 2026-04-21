'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, relativeTime } from '@/lib/format';
import { getSession, hasPermission } from '@/lib/session';
import type { CustomerNote } from '@/lib/crm-types';

export function NotesTab({ customerId }: { customerId: string }) {
  const key = `/v1/customers/${customerId}/notes`;
  const { data, isLoading, error, mutate } = useSWR<CustomerNote[]>(key);
  const canManage = hasPermission('customers.notes.manage');
  const sessionUserId = getSession()?.user.id;

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerNote | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CustomerNote | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(n: CustomerNote) {
    setDeleting(true);
    try {
      await api.delete(`${key}/${n.id}`);
      await mutate();
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  if (isLoading) return <PageLoader />;
  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        Falha ao carregar anotações.
      </div>
    );
  }

  const pinned = (data ?? []).filter((n) => n.pinned);
  const others = (data ?? []).filter((n) => !n.pinned);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {data?.length ?? 0} anotação(ões)
        </h3>
        {canManage && (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            Nova anotação
          </Button>
        )}
      </div>

      {(!data || data.length === 0) && (
        <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
          Nenhuma anotação registrada.
        </p>
      )}

      {pinned.length > 0 && (
        <section>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Fixadas
          </h4>
          <ul className="space-y-2">
            {pinned.map((n) => (
              <NoteCard
                key={n.id}
                note={n}
                ownedByMe={n.authorId === sessionUserId}
                onEdit={() => {
                  setEditing(n);
                  setOpen(true);
                }}
                onDelete={() => setConfirmDelete(n)}
                canManage={canManage}
              />
            ))}
          </ul>
        </section>
      )}

      {others.length > 0 && (
        <section>
          {pinned.length > 0 && (
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Demais
            </h4>
          )}
          <ul className="space-y-2">
            {others.map((n) => (
              <NoteCard
                key={n.id}
                note={n}
                ownedByMe={n.authorId === sessionUserId}
                onEdit={() => {
                  setEditing(n);
                  setOpen(true);
                }}
                onDelete={() => setConfirmDelete(n)}
                canManage={canManage}
              />
            ))}
          </ul>
        </section>
      )}

      <NoteFormModal
        open={open}
        onClose={() => setOpen(false)}
        customerId={customerId}
        note={editing}
        onSaved={() => {
          setOpen(false);
          void mutate();
        }}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) return handleDelete(confirmDelete);
        }}
        title="Excluir anotação"
        message="Essa ação não pode ser desfeita."
        confirmLabel="Excluir"
        variant="danger"
        loading={deleting}
      />
    </div>
  );
}

function NoteCard({
  note,
  ownedByMe,
  onEdit,
  onDelete,
  canManage,
}: {
  note: CustomerNote;
  ownedByMe: boolean;
  onEdit: () => void;
  onDelete: () => void;
  canManage: boolean;
}) {
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center gap-2">
        {note.pinned && <Badge tone="warning">Fixada</Badge>}
        {note.title && <strong className="text-sm">{note.title}</strong>}
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-100">
        {note.body}
      </p>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span title={formatDateTime(note.createdAt)}>
          {note.authorName ?? 'Autor desconhecido'} · {relativeTime(note.createdAt)}
        </span>
        {canManage && ownedByMe && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-brand-700 hover:underline dark:text-brand-300"
              onClick={onEdit}
            >
              Editar
            </button>
            <button
              type="button"
              className="text-red-600 hover:underline dark:text-red-400"
              onClick={onDelete}
            >
              Excluir
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function NoteFormModal({
  open,
  onClose,
  customerId,
  note,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  customerId: string;
  note: CustomerNote | null;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [pinned, setPinned] = useState(note?.pinned ?? false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setTitle(note?.title ?? '');
    setBody(note?.body ?? '');
    setPinned(note?.pinned ?? false);
    setErr(null);
  }, [note, open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      const payload = {
        title: title || null,
        body,
        pinned,
      };
      if (note) {
        await api.patch(`/v1/customers/${customerId}/notes/${note.id}`, payload);
      } else {
        await api.post(`/v1/customers/${customerId}/notes`, payload);
      }
      onSaved();
    } catch (e) {
      if (e instanceof ApiError) setErr(e.friendlyMessage);
      else setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={note ? 'Editar anotação' : 'Nova anotação'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button form="note-form" type="submit" loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="note-form" onSubmit={submit} className="space-y-3">
        {err && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {err}
          </div>
        )}
        <div>
          <Label>Título</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} />
        </div>
        <div>
          <Label required>Corpo</Label>
          <Textarea
            rows={6}
            maxLength={10_000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          Fixar esta anotação no topo
        </label>
      </form>
    </Modal>
  );
}

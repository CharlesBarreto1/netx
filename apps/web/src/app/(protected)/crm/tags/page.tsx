'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { FieldError, Input, Label, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { hasPermission } from '@/lib/session';
import type { CustomerTag } from '@/lib/crm-types';

export default function TagsCatalogPage() {
  const { data, isLoading, error, mutate } = useSWR<CustomerTag[]>('/v1/crm/tags');
  const canManage = hasPermission('customers.tags.manage');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerTag | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CustomerTag | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(t: CustomerTag) {
    setDeleting(true);
    try {
      await api.delete(`/v1/crm/tags/${t.id}`);
      await mutate();
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tags</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Catálogo compartilhado entre todos os clientes deste tenant. Use tags para segmentar
            por VIP, inadimplente, plano, setor, etc.
          </p>
        </div>
        {canManage && (
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            Nova tag
          </Button>
        )}
      </header>

      {isLoading && <PageLoader />}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          Falha ao carregar tags.
        </div>
      )}

      {data && data.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
          Nenhuma tag cadastrada ainda.
        </p>
      )}

      {data && data.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-900/40">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3">Tag</th>
                  <th className="px-4 py-3">Descrição</th>
                  <th className="px-4 py-3">Clientes</th>
                  <th className="px-4 py-3">Criada</th>
                  {canManage && <th className="px-4 py-3 text-right">Ações</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {data.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-full border border-slate-300 dark:border-slate-600"
                          style={{ backgroundColor: t.color ?? 'transparent' }}
                        />
                        <strong className="text-slate-900 dark:text-slate-100">{t.name}</strong>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {t.description || <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {t.customerCount ?? 0}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {formatDate(t.createdAt)}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditing(t);
                            setOpen(true);
                          }}
                        >
                          Editar
                        </Button>{' '}
                        <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(t)}>
                          Excluir
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <TagFormModal
        open={open}
        onClose={() => setOpen(false)}
        tag={editing}
        onSaved={() => {
          setOpen(false);
          void mutate();
        }}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        title="Excluir tag"
        message={`Remover a tag "${confirmDelete?.name ?? ''}"? Ela será desassociada de todos os clientes.`}
        confirmLabel="Excluir"
        variant="danger"
        loading={deleting}
      />
    </div>
  );
}

function TagFormModal({
  open,
  onClose,
  tag,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  tag: CustomerTag | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState(tag?.name ?? '');
  const [color, setColor] = useState(tag?.color ?? '#3b82f6');
  const [description, setDescription] = useState(tag?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});

  useEffect(() => {
    setName(tag?.name ?? '');
    setColor(tag?.color ?? '#3b82f6');
    setDescription(tag?.description ?? '');
    setErr(null);
    setFieldErr({});
  }, [tag, open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setFieldErr({});
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name,
        color: color || null,
        description: description || null,
      };
      if (tag) {
        await api.patch(`/v1/crm/tags/${tag.id}`, body);
      } else {
        await api.post('/v1/crm/tags', body);
      }
      onSaved();
    } catch (e) {
      if (e instanceof ApiError) {
        setErr(e.friendlyMessage);
        if (e.problem.errors) {
          const m: Record<string, string> = {};
          for (const f of e.problem.errors) m[f.path] = f.message;
          setFieldErr(m);
        }
      } else {
        setErr((e as Error).message);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tag ? 'Editar tag' : 'Nova tag'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button form="tag-form" type="submit" loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="tag-form" onSubmit={submit} className="space-y-3">
        {err && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {err}
          </div>
        )}
        <div>
          <Label required>Nome</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
            required
            placeholder="Ex.: VIP, Inadimplente, Enterprise…"
          />
          <FieldError>{fieldErr.name}</FieldError>
        </div>
        <div>
          <Label>Cor</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-14 cursor-pointer rounded-md border border-slate-300 bg-white p-1 dark:border-slate-600 dark:bg-slate-900"
            />
            <Input
              value={color}
              onChange={(e) => setColor(e.target.value)}
              pattern="^#[0-9a-fA-F]{6}$"
              placeholder="#RRGGBB"
              className="max-w-[140px] font-mono"
            />
          </div>
          <FieldError>{fieldErr.color}</FieldError>
        </div>
        <div>
          <Label>Descrição</Label>
          <Textarea
            rows={3}
            maxLength={255}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </form>
    </Modal>
  );
}

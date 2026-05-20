'use client';

import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { FieldError, Input, Label } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  stockApi,
  type CreateStockLocationInput,
  type StockLocation,
} from '@/lib/stock-api';
import type { UserResponse } from '@/lib/users-api';

export default function StockLocationsPage() {
  const { data, isLoading, error, mutate } = useSWR<StockLocation[]>(
    stockApi.locationsPath(),
    () => stockApi.listLocations(),
  );

  const canAdmin = hasPermission('stock.admin');
  const canWrite = hasPermission('stock.write');

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StockLocation | null>(null);
  const [managingAccess, setManagingAccess] = useState<StockLocation | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<StockLocation | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(l: StockLocation) {
    setDeleting(true);
    try {
      await stockApi.deleteLocation(l.id);
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
          <h1 className="text-2xl font-bold tracking-tight">Locais de estoque</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Cada local tem ACL própria — usuários só veem locais que tem acesso. Roles com
            permissão <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">stock.admin</code>{' '}
            bypassam (veem todos os locais do tenant).
          </p>
        </div>
        {canAdmin && <Button onClick={() => setCreating(true)}>Novo local</Button>}
      </header>

      {isLoading && <PageLoader />}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          Falha ao carregar locais.
        </div>
      )}

      {data && data.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
          Nenhum local de estoque cadastrado. {canAdmin && 'Crie o primeiro pra começar.'}
        </p>
      )}

      {data && data.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-900/40">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Acessos</th>
                  <th className="px-4 py-3">Saldo</th>
                  <th className="px-4 py-3">Status</th>
                  {(canWrite || canAdmin) && <th className="px-4 py-3 text-right">Ações</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {data.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <td className="px-4 py-3 font-mono text-xs">{l.code}</td>
                    <td className="px-4 py-3">
                      <strong className="text-slate-900 dark:text-slate-100">{l.name}</strong>
                      {l.address && (
                        <p className="text-xs text-slate-500">{l.address}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      <span className="text-xs">{l.userAccess?.length ?? 0} usuário(s)</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      <div className="flex flex-col text-xs">
                        <span>{l.stats?.consumableProducts ?? 0} consumíveis</span>
                        <span className="text-slate-500">{l.stats?.serialItemsInStock ?? 0} seriais</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          l.isActive
                            ? 'inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900/30 dark:text-green-300'
                            : 'inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                        }
                      >
                        {l.isActive ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    {(canWrite || canAdmin) && (
                      <td className="px-4 py-3 text-right">
                        {canAdmin && (
                          <Button variant="ghost" size="sm" onClick={() => setManagingAccess(l)}>
                            Acessos
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setEditing(l)}>
                          Editar
                        </Button>
                        {canAdmin && (
                          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(l)}>
                            Excluir
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(creating || editing) && (
        <LocationFormModal
          initial={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            await mutate();
          }}
        />
      )}

      {managingAccess && (
        <AccessManagerModal
          location={managingAccess}
          onClose={() => setManagingAccess(null)}
          onSaved={async () => {
            setManagingAccess(null);
            await mutate();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          open={true}
          title={`Excluir "${confirmDelete.name}"?`}
          description="Não é possível excluir locais com saldo ou seriais alocados. Movimentos históricos ficam preservados."
          confirmLabel="Excluir"
          loading={deleting}
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

// =============================================================================
// FORM (criar/editar local)
// =============================================================================
function LocationFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: StockLocation | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !initial;
  const [form, setForm] = useState<CreateStockLocationInput>({
    code: initial?.code ?? '',
    name: initial?.name ?? '',
    address: initial?.address ?? '',
    isActive: initial?.isActive ?? true,
    userIds: [],
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.code.trim()) return setError('Code é obrigatório');
    if (!form.name.trim()) return setError('Nome é obrigatório');
    setSubmitting(true);
    try {
      const payload: CreateStockLocationInput = {
        ...form,
        code: form.code.toUpperCase(),
        address: form.address || null,
      };
      // No update, não enviamos userIds (deixa o AccessManagerModal cuidar)
      if (isNew) await stockApi.createLocation(payload);
      else await stockApi.updateLocation(initial!.id, { ...payload, userIds: undefined });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : 'Erro ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isNew ? 'Novo local de estoque' : 'Editar local'}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="code">Code *</Label>
            <Input
              id="code"
              placeholder="DEP-MATRIZ"
              value={form.code}
              onChange={(e) =>
                setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9._\-]/g, '') })
              }
              required
              maxLength={40}
            />
            <p className="text-xs text-slate-500 mt-1">Maiúsculas, números, "." "_" "-"</p>
          </div>
          <div className="col-span-2">
            <Label htmlFor="name">Nome *</Label>
            <Input
              id="name"
              placeholder="Depósito Matriz"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
        </div>

        <div>
          <Label htmlFor="address">Endereço</Label>
          <Input
            id="address"
            value={form.address ?? ''}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isActive ?? true}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
          Ativo
        </label>

        {error && <FieldError>{error}</FieldError>}

        <div className="rounded-md bg-blue-50 p-3 text-xs text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
          Após criar, use o botão <strong>"Acessos"</strong> na lista pra escolher quais usuários
          podem ver/operar neste local.
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="submit" loading={submitting}>
            {isNew ? 'Criar' : 'Salvar'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// =============================================================================
// ACL MANAGER — multi-select de usuários com canWrite por linha
// =============================================================================
function AccessManagerModal({
  location,
  onClose,
  onSaved,
}: {
  location: StockLocation;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: users, isLoading: loadingUsers } = useSWR<{ items: UserResponse[] }>(
    '/v1/users?pageSize=200&status=ACTIVE',
  );
  const [access, setAccess] = useState<Map<string, boolean>>(() => {
    const m = new Map<string, boolean>();
    location.userAccess?.forEach((ua) => m.set(ua.userId, ua.canWrite));
    return m;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(userId: string) {
    const next = new Map(access);
    if (next.has(userId)) next.delete(userId);
    else next.set(userId, true);
    setAccess(next);
  }

  function toggleCanWrite(userId: string) {
    const next = new Map(access);
    if (next.has(userId)) next.set(userId, !next.get(userId));
    setAccess(next);
  }

  async function handleSave() {
    setSubmitting(true);
    try {
      const userIds = Array.from(access.entries()).map(([userId, canWrite]) => ({
        userId,
        canWrite,
      }));
      await stockApi.setLocationAccess(location.id, { userIds });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : 'Erro ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Acessos — ${location.name}`}>
      <div className="space-y-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Marque os usuários que podem operar neste local. Quem não estiver marcado não verá esse
          local na listagem (exceto admins com permissão <code>stock.admin</code>).
        </p>

        {loadingUsers && <PageLoader />}

        {users && (
          <div className="max-h-96 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-900/40 sticky top-0">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 w-12">Acesso</th>
                  <th className="px-3 py-2">Usuário</th>
                  <th className="px-3 py-2 w-32">Pode editar?</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {users.items.map((u) => {
                  const has = access.has(u.id);
                  const canWrite = access.get(u.id) ?? false;
                  return (
                    <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={has} onChange={() => toggle(u.id)} />
                      </td>
                      <td className="px-3 py-2">
                        <div>
                          <span className="text-slate-900 dark:text-slate-100">
                            {u.firstName} {u.lastName}
                          </span>
                          <p className="text-xs text-slate-500">{u.email}</p>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          disabled={!has}
                          checked={canWrite}
                          onChange={() => toggleCanWrite(u.id)}
                        />
                        <span className="ml-2 text-xs text-slate-500">
                          {!has ? '—' : canWrite ? 'Sim' : 'Read-only'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {error && <FieldError>{error}</FieldError>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSave} loading={submitting}>
            Salvar acessos
          </Button>
        </div>
      </div>
    </Modal>
  );
}

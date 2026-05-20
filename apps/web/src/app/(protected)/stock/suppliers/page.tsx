'use client';

import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { FieldError, Input, Label, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  stockApi,
  type CreateSupplierInput,
  type Supplier,
  type SupplierTaxIdType,
} from '@/lib/stock-api';

const TAX_ID_TYPES: SupplierTaxIdType[] = ['CNPJ', 'CPF', 'RUC', 'DNI', 'CI', 'OTHER'];

export default function SuppliersPage() {
  const { data, isLoading, error, mutate } = useSWR<Supplier[]>(
    stockApi.suppliersPath(),
    () => stockApi.listSuppliers(),
  );
  const canWrite = hasPermission('stock.write');
  const canDelete = hasPermission('stock.delete');

  const [editing, setEditing] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(s: Supplier) {
    setDeleting(true);
    try {
      await stockApi.deleteSupplier(s.id);
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
          <h1 className="text-2xl font-bold tracking-tight">Fornecedores</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Cadastro de fornecedores pra entrada de compras. Inativos somem das listagens de
            criação de compra mas histórico fica preservado.
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setCreating(true)}>Novo fornecedor</Button>
        )}
      </header>

      {isLoading && <PageLoader />}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          Falha ao carregar fornecedores.
        </div>
      )}

      {data && data.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
          Nenhum fornecedor cadastrado ainda.
        </p>
      )}

      {data && data.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-900/40">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Documento</th>
                  <th className="px-4 py-3">Contato</th>
                  <th className="px-4 py-3">Localidade</th>
                  <th className="px-4 py-3">Status</th>
                  {canWrite && <th className="px-4 py-3 text-right">Ações</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {data.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <td className="px-4 py-3">
                      <strong className="text-slate-900 dark:text-slate-100">{s.name}</strong>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {s.taxId ? (
                        <span>
                          <span className="text-xs text-slate-500">{s.taxIdType ?? ''}</span>{' '}
                          {s.taxId}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      <div className="flex flex-col">
                        <span>{s.email || <span className="text-slate-400">—</span>}</span>
                        {s.phone && (
                          <span className="text-xs text-slate-500">{s.phone}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {s.city ? `${s.city}${s.state ? `/${s.state}` : ''}` : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          s.isActive
                            ? 'inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900/30 dark:text-green-300'
                            : 'inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                        }
                      >
                        {s.isActive ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    {canWrite && (
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                          Editar
                        </Button>
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmDelete(s)}
                          >
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
        <SupplierFormModal
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

      {confirmDelete && (
        <ConfirmDialog
          open={true}
          title={`Excluir "${confirmDelete.name}"?`}
          description="Fornecedores com histórico de compras não podem ser deletados — desative no formulário."
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
// FORM MODAL
// =============================================================================
function SupplierFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: Supplier | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !initial;
  const [form, setForm] = useState<CreateSupplierInput>({
    name: initial?.name ?? '',
    taxId: initial?.taxId ?? '',
    taxIdType: initial?.taxIdType ?? null,
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    address: initial?.address ?? '',
    city: initial?.city ?? '',
    state: initial?.state ?? '',
    notes: initial?.notes ?? '',
    isActive: initial?.isActive ?? true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return setError('Nome é obrigatório');
    setSubmitting(true);
    try {
      const payload: CreateSupplierInput = {
        ...form,
        taxId: form.taxId || null,
        taxIdType: form.taxIdType || null,
        email: form.email || null,
        phone: form.phone || null,
        address: form.address || null,
        city: form.city || null,
        state: form.state || null,
        notes: form.notes || null,
      };
      if (isNew) await stockApi.createSupplier(payload);
      else await stockApi.updateSupplier(initial!.id, payload);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : 'Erro ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isNew ? 'Novo fornecedor' : 'Editar fornecedor'}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <Label htmlFor="name">Nome *</Label>
          <Input
            id="name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="taxIdType">Tipo doc.</Label>
            <select
              id="taxIdType"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={form.taxIdType ?? ''}
              onChange={(e) => setForm({ ...form, taxIdType: (e.target.value || null) as SupplierTaxIdType | null })}
            >
              <option value="">—</option>
              {TAX_ID_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <Label htmlFor="taxId">Documento</Label>
            <Input
              id="taxId"
              value={form.taxId ?? ''}
              onChange={(e) => setForm({ ...form, taxId: e.target.value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              value={form.email ?? ''}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="phone">Telefone</Label>
            <Input
              id="phone"
              value={form.phone ?? ''}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="city">Cidade</Label>
            <Input
              id="city"
              value={form.city ?? ''}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="state">Estado/Província</Label>
            <Input
              id="state"
              value={form.state ?? ''}
              onChange={(e) => setForm({ ...form, state: e.target.value })}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="notes">Observações</Label>
          <Textarea
            id="notes"
            rows={2}
            value={form.notes ?? ''}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
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

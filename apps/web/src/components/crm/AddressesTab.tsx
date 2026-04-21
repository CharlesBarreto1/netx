'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { FieldError, Input, Label, Select } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { api, ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  ADDRESS_TYPES,
  ADDRESS_TYPE_LABEL,
  COUNTRY_OPTIONS,
  type AddressType,
  type CustomerAddress,
} from '@/lib/crm-types';

export function AddressesTab({ customerId }: { customerId: string }) {
  const key = `/v1/customers/${customerId}/addresses`;
  const { data, isLoading, error, mutate } = useSWR<CustomerAddress[]>(key);
  const canWrite = hasPermission('customers.update');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerAddress | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CustomerAddress | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(addr: CustomerAddress) {
    setDeleting(true);
    try {
      await api.delete(`${key}/${addr.id}`);
      await mutate();
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(a: CustomerAddress) {
    setEditing(a);
    setOpen(true);
  }

  if (isLoading) return <PageLoader />;
  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        Falha ao carregar endereços.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {data?.length ?? 0} endereço(s)
        </h3>
        {canWrite && (
          <Button size="sm" onClick={openCreate}>
            Adicionar endereço
          </Button>
        )}
      </div>

      {(!data || data.length === 0) && (
        <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
          Nenhum endereço cadastrado.
        </p>
      )}

      <ul className="space-y-2">
        {data?.map((a) => (
          <li
            key={a.id}
            className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="info">{ADDRESS_TYPE_LABEL[a.type]}</Badge>
                  {a.isPrimary && <Badge tone="success">Principal</Badge>}
                  {a.label && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">· {a.label}</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-800 dark:text-slate-100">
                  {a.street}
                  {a.number ? `, ${a.number}` : ''}
                  {a.complement ? ` — ${a.complement}` : ''}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {[a.district, a.city, a.state].filter(Boolean).join(' · ')}
                  {a.postalCode ? ` · CEP ${a.postalCode}` : ''} · {a.country}
                </p>
                {(a.latitude !== null || a.longitude !== null) && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    GPS: {a.latitude ?? '—'}, {a.longitude ?? '—'}
                  </p>
                )}
              </div>
              {canWrite && (
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEdit(a)}>
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmDelete(a)}
                  >
                    Excluir
                  </Button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      <AddressFormModal
        open={open}
        onClose={() => setOpen(false)}
        customerId={customerId}
        address={editing}
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
        title="Excluir endereço"
        message={`Tem certeza que deseja excluir o endereço "${confirmDelete?.street ?? ''}"?`}
        confirmLabel="Excluir"
        variant="danger"
        loading={deleting}
      />
    </div>
  );
}

function AddressFormModal({
  open,
  onClose,
  customerId,
  address,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  customerId: string;
  address: CustomerAddress | null;
  onSaved: () => void;
}) {
  const [type, setType] = useState<AddressType>(address?.type ?? 'BILLING');
  const [country, setCountry] = useState(address?.country ?? 'BR');
  const [state, setState] = useState(address?.state ?? '');
  const [city, setCity] = useState(address?.city ?? '');
  const [district, setDistrict] = useState(address?.district ?? '');
  const [street, setStreet] = useState(address?.street ?? '');
  const [number, setNumber] = useState(address?.number ?? '');
  const [complement, setComplement] = useState(address?.complement ?? '');
  const [postalCode, setPostalCode] = useState(address?.postalCode ?? '');
  const [label, setLabel] = useState(address?.label ?? '');
  const [isPrimary, setIsPrimary] = useState(address?.isPrimary ?? false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});

  // Reset quando o alvo muda (abrir para edição de outro endereço, ou criar novo).
  useEffect(() => {
    setType(address?.type ?? 'BILLING');
    setCountry(address?.country ?? 'BR');
    setState(address?.state ?? '');
    setCity(address?.city ?? '');
    setDistrict(address?.district ?? '');
    setStreet(address?.street ?? '');
    setNumber(address?.number ?? '');
    setComplement(address?.complement ?? '');
    setPostalCode(address?.postalCode ?? '');
    setLabel(address?.label ?? '');
    setIsPrimary(address?.isPrimary ?? false);
    setErr(null);
    setFieldErr({});
  }, [address, open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setFieldErr({});
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        type,
        country,
        state: state || null,
        city,
        district: district || null,
        street,
        number: number || null,
        complement: complement || null,
        postalCode: postalCode || null,
        label: label || null,
        isPrimary,
      };
      if (address) {
        await api.patch(`/v1/customers/${customerId}/addresses/${address.id}`, body);
      } else {
        await api.post(`/v1/customers/${customerId}/addresses`, body);
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
      title={address ? 'Editar endereço' : 'Novo endereço'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="address-form" loading={saving}>
            {address ? 'Salvar' : 'Criar'}
          </Button>
        </>
      }
    >
      <form id="address-form" onSubmit={submit} className="space-y-4">
        {err && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {err}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <Label>Tipo</Label>
            <Select value={type} onChange={(e) => setType(e.target.value as AddressType)}>
              {ADDRESS_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ADDRESS_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label>Rótulo</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex.: Casa, Matriz…" />
          </div>

          <div>
            <Label required>País</Label>
            <Select value={country} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Estado/Província</Label>
            <Input value={state} onChange={(e) => setState(e.target.value)} />
          </div>
          <div>
            <Label required>Cidade</Label>
            <Input value={city} onChange={(e) => setCity(e.target.value)} required />
            <FieldError>{fieldErr.city}</FieldError>
          </div>
          <div>
            <Label>Bairro</Label>
            <Input value={district} onChange={(e) => setDistrict(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label required>Rua</Label>
            <Input value={street} onChange={(e) => setStreet(e.target.value)} required />
            <FieldError>{fieldErr.street}</FieldError>
          </div>
          <div>
            <Label>Número</Label>
            <Input value={number} onChange={(e) => setNumber(e.target.value)} />
          </div>
          <div>
            <Label>Complemento</Label>
            <Input value={complement} onChange={(e) => setComplement(e.target.value)} />
          </div>
          <div>
            <Label>CEP</Label>
            <Input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isPrimary}
            onChange={(e) => setIsPrimary(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          Endereço principal (desmarca outros do mesmo tipo)
        </label>
      </form>
    </Modal>
  );
}

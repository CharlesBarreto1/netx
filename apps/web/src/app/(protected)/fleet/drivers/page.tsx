'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { FieldError, Input, Label, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  fleetApi,
  type CreateDriverInput,
  type Driver,
  type DriverStatus,
  type Paginated,
} from '@/lib/fleet-api';

function expiryWarn(date: string | null): boolean {
  if (!date) return false;
  const diff = (new Date(date).getTime() - Date.now()) / 86_400_000;
  return diff <= 30; // CNH vencendo em ≤30 dias (ou vencida)
}

export default function FleetDriversPage() {
  const t = useTranslations('fleet.drivers');
  const tc = useTranslations('common');
  const { data, isLoading, error, mutate } = useSWR<Paginated<Driver>>(
    fleetApi.driversPath({ pageSize: 200 }),
    () => fleetApi.listDrivers({ pageSize: 200 }),
  );
  const canWrite = hasPermission('fleet.write');
  const canDelete = hasPermission('fleet.delete');

  const [editing, setEditing] = useState<Driver | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Driver | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(d: Driver) {
    setDeleting(true);
    try {
      await fleetApi.deleteDriver(d.id);
      await mutate();
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  const rows = data?.data ?? [];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('subtitle')}
          </p>
        </div>
        {canWrite && <Button onClick={() => setCreating(true)}>{t('new')}</Button>}
      </header>

      {isLoading && <PageLoader />}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {t('loadError')}
        </div>
      )}

      {data && rows.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
          {t('empty')}
        </p>
      )}

      {rows.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-900/40">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3">{tc('name')}</th>
                  <th className="px-4 py-3">{t('document')}</th>
                  <th className="px-4 py-3">{t('license')}</th>
                  <th className="px-4 py-3">{t('licenseExpiry')}</th>
                  <th className="px-4 py-3">{tc('phone')}</th>
                  <th className="px-4 py-3">{tc('status')}</th>
                  {canWrite && <th className="px-4 py-3 text-right">{tc('actions')}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {rows.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">{d.name}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {d.document || <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {d.licenseNumber ? (
                        <span>
                          {d.licenseNumber}
                          {d.licenseCategory ? <span className="text-xs text-slate-400"> · {d.licenseCategory}</span> : null}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {d.licenseExpiry ? (
                        <span className={expiryWarn(d.licenseExpiry) ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}>
                          {new Date(d.licenseExpiry).toLocaleDateString('pt-BR')}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {d.phone || <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          d.status === 'ACTIVE'
                            ? 'inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900/30 dark:text-green-300'
                            : 'inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                        }
                      >
                        {d.status === 'ACTIVE' ? t('statusACTIVE') : t('statusINACTIVE')}
                      </span>
                    </td>
                    {canWrite && (
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(d)}>{tc('edit')}</Button>
                        {canDelete && (
                          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(d)}>{tc('delete')}</Button>
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
        <DriverFormModal
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
          open
          title={t('deleteTitle', { name: confirmDelete.name })}
          message={t('deleteMessage')}
          confirmLabel={tc('delete')}
          loading={deleting}
          onConfirm={() => handleDelete(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function DriverFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: Driver | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('fleet.drivers');
  const tc = useTranslations('common');
  const isNew = !initial;
  const [form, setForm] = useState<CreateDriverInput>({
    name: initial?.name ?? '',
    document: initial?.document ?? '',
    licenseNumber: initial?.licenseNumber ?? '',
    licenseCategory: initial?.licenseCategory ?? '',
    licenseExpiry: initial?.licenseExpiry ?? '',
    phone: initial?.phone ?? '',
    status: initial?.status ?? 'ACTIVE',
    notes: initial?.notes ?? '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return setError(t('nameRequired'));
    setSubmitting(true);
    try {
      const payload: CreateDriverInput = {
        ...form,
        document: form.document || null,
        licenseNumber: form.licenseNumber || null,
        licenseCategory: form.licenseCategory || null,
        licenseExpiry: form.licenseExpiry || null,
        phone: form.phone || null,
        notes: form.notes || null,
      };
      if (isNew) await fleetApi.createDriver(payload);
      else await fleetApi.updateDriver(initial!.id, payload);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : t('saveError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isNew ? t('new') : t('editTitle', { name: initial!.name })}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <Label htmlFor="name">{t('nameLabel')}</Label>
          <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="document">{t('documentLabel')}</Label>
            <Input id="document" value={form.document ?? ''} onChange={(e) => setForm({ ...form, document: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="phone">{tc('phone')}</Label>
            <Input id="phone" value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="cnh">{t('license')}</Label>
            <Input id="cnh" value={form.licenseNumber ?? ''} onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="cat">{t('category')}</Label>
            <Input id="cat" value={form.licenseCategory ?? ''} onChange={(e) => setForm({ ...form, licenseCategory: e.target.value })} placeholder="A, B, AB..." />
          </div>
          <div>
            <Label htmlFor="expiry">{t('licenseExpiry')}</Label>
            <Input id="expiry" type="date" value={form.licenseExpiry ?? ''} onChange={(e) => setForm({ ...form, licenseExpiry: e.target.value })} />
          </div>
        </div>

        <div>
          <Label htmlFor="status">{tc('status')}</Label>
          <select
            id="status"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as DriverStatus })}
          >
            <option value="ACTIVE">{t('statusACTIVE')}</option>
            <option value="INACTIVE">{t('statusINACTIVE')}</option>
          </select>
        </div>

        <div>
          <Label htmlFor="notes">{tc('notes')}</Label>
          <Textarea id="notes" rows={2} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>

        {error && <FieldError>{error}</FieldError>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>{tc('cancel')}</Button>
          <Button type="submit" loading={submitting}>{isNew ? tc('create') : tc('save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

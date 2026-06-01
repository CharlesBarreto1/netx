'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { FieldError, Input, Label, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError, swrFetcher } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import { useFormatMoney } from '@/lib/use-money';
import { cashRegistersApi, type CashRegister } from '@/lib/finance-api';
import {
  fleetApi,
  type CreateFleetExpenseInput,
  type Driver,
  type FleetExpense,
  type FleetExpenseType,
  type Paginated,
  type Vehicle,
} from '@/lib/fleet-api';

const TYPES: FleetExpenseType[] = ['FUEL', 'TOLL', 'FINE', 'INSURANCE', 'REPAIR', 'TAX', 'OTHER'];

/** datetime-local (sem tz) → ISO com offset, exigido pelo backend. */
function toIso(local: string): string {
  return new Date(local).toISOString();
}
/** ISO → valor pro input datetime-local (hora local). */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export default function FleetExpensesPage() {
  const { data, isLoading, error, mutate } = useSWR<Paginated<FleetExpense>>(
    fleetApi.expensesPath({ pageSize: 200 }),
    () => fleetApi.listExpenses({ pageSize: 200 }),
  );
  const t = useTranslations('fleet.expenses');
  const tc = useTranslations('common');
  const fmt = useFormatMoney();
  const typeLabel = (type: FleetExpenseType) => t(`types.${type}`);
  const canWrite = hasPermission('fleet.expense.create');

  const [editing, setEditing] = useState<FleetExpense | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FleetExpense | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(x: FleetExpense) {
    setDeleting(true);
    try {
      await fleetApi.deleteExpense(x.id);
      await mutate();
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  const rows = data?.data ?? [];
  const total = rows.reduce((acc, r) => acc + r.amount, 0);

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
                  <th className="px-4 py-3">{t('col.date')}</th>
                  <th className="px-4 py-3">{t('col.vehicle')}</th>
                  <th className="px-4 py-3">{tc('type')}</th>
                  <th className="px-4 py-3 text-right">{t('col.amount')}</th>
                  <th className="px-4 py-3">{t('col.cashRegister')}</th>
                  <th className="px-4 py-3">{tc('description')}</th>
                  {canWrite && <th className="px-4 py-3 text-right">{tc('actions')}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {rows.map((x) => (
                  <tr key={x.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {new Date(x.occurredAt).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-900 dark:text-slate-100">
                      {x.vehicle?.plate ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{typeLabel(x.type)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900 dark:text-slate-100">{fmt(x.amount)}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {x.cashRegister?.name ?? <span className="text-slate-400">{t('notPosted')}</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {x.description || <span className="text-slate-400">—</span>}
                    </td>
                    {canWrite && (
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(x)}>{tc('edit')}</Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(x)}>{tc('delete')}</Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50 text-sm font-semibold dark:border-slate-700 dark:bg-slate-900/40">
                  <td className="px-4 py-3" colSpan={3}>{t('total')}</td>
                  <td className="px-4 py-3 text-right">{fmt(total)}</td>
                  <td colSpan={canWrite ? 3 : 2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {(creating || editing) && (
        <ExpenseFormModal
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
          title={t('deleteTitle')}
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

function ExpenseFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: FleetExpense | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('fleet.expenses');
  const tc = useTranslations('common');
  const isNew = !initial;
  const { data: vehicles } = useSWR<Paginated<Vehicle>>(
    fleetApi.vehiclesPath({ pageSize: 200 }),
    swrFetcher,
  );
  const { data: drivers } = useSWR<Paginated<Driver>>(
    fleetApi.driversPath({ status: 'ACTIVE', pageSize: 200 }),
    swrFetcher,
  );
  const { data: registers } = useSWR<CashRegister[]>(cashRegistersApi.listPath(), swrFetcher);

  const [form, setForm] = useState<{
    vehicleId: string;
    driverId: string;
    type: FleetExpenseType;
    amount: string;
    occurredAt: string;
    odometer: string;
    description: string;
    cashRegisterId: string;
  }>({
    vehicleId: initial?.vehicleId ?? '',
    driverId: initial?.driverId ?? '',
    type: initial?.type ?? 'FUEL',
    amount: initial ? String(initial.amount) : '',
    occurredAt: initial ? toLocalInput(initial.occurredAt) : toLocalInput(new Date().toISOString()),
    odometer: initial?.odometer != null ? String(initial.odometer) : '',
    description: initial?.description ?? '',
    cashRegisterId: initial?.cashRegisterId ?? '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.vehicleId) return setError(t('error.selectVehicle'));
    const amount = Number(form.amount);
    if (!amount || amount <= 0) return setError(t('error.invalidAmount'));
    setSubmitting(true);
    try {
      const payload: CreateFleetExpenseInput = {
        vehicleId: form.vehicleId,
        driverId: form.driverId || null,
        type: form.type,
        amount,
        occurredAt: toIso(form.occurredAt),
        odometer: form.odometer ? Number(form.odometer) : null,
        description: form.description || null,
        cashRegisterId: form.cashRegisterId || null,
      };
      if (isNew) await fleetApi.createExpense(payload);
      else await fleetApi.updateExpense(initial!.id, payload);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : t('error.save'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isNew ? t('new') : t('editTitle')}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="vehicle">{t('field.vehicle')}</Label>
            <select
              id="vehicle"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={form.vehicleId}
              onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}
              required
            >
              <option value="">{t('selectPlaceholder')}</option>
              {(vehicles?.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plate} {[v.brand, v.model].filter(Boolean).join(' ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="type">{tc('type')}</Label>
            <select
              id="type"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as FleetExpenseType })}
            >
              {TYPES.map((ty) => (
                <option key={ty} value={ty}>{t(`types.${ty}`)}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="amount">{t('field.amount')}</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              required
            />
          </div>
          <div>
            <Label htmlFor="when">{t('field.occurredAt')}</Label>
            <Input
              id="when"
              type="datetime-local"
              value={form.occurredAt}
              onChange={(e) => setForm({ ...form, occurredAt: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="odo">{t('field.odometer')}</Label>
            <Input
              id="odo"
              type="number"
              value={form.odometer}
              onChange={(e) => setForm({ ...form, odometer: e.target.value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="driver">{t('field.driver')}</Label>
            <select
              id="driver"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={form.driverId}
              onChange={(e) => setForm({ ...form, driverId: e.target.value })}
            >
              <option value="">—</option>
              {(drivers?.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="caixa">{t('field.cashRegister')}</Label>
            <select
              id="caixa"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={form.cashRegisterId}
              onChange={(e) => setForm({ ...form, cashRegisterId: e.target.value })}
            >
              <option value="">{t('noCashRegister')}</option>
              {(registers ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <Label htmlFor="desc">{tc('description')}</Label>
          <Textarea id="desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>

        {error && <FieldError>{error}</FieldError>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>{tc('cancel')}</Button>
          <Button type="submit" loading={submitting}>{isNew ? t('submit') : tc('save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

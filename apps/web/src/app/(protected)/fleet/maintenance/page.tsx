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
import {
  fleetApi,
  MAINTENANCE_KIND_LABELS,
  type CreateMaintenancePlanInput,
  type CreateMaintenanceRecordInput,
  type MaintenanceDueStatus,
  type MaintenanceKind,
  type MaintenancePlan,
  type MaintenanceRecord,
  type Paginated,
  type Vehicle,
} from '@/lib/fleet-api';

const KINDS: MaintenanceKind[] = ['OIL_CHANGE', 'REVISION', 'TIRES', 'BRAKES', 'FILTERS', 'ALIGNMENT', 'OTHER'];

const DUE_BADGE: Record<MaintenanceDueStatus, { cls: string; labelKey: string }> = {
  OVERDUE: { cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300', labelKey: 'dueStatus.overdue' },
  DUE_SOON: { cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300', labelKey: 'dueStatus.dueSoon' },
  OK: { cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300', labelKey: 'dueStatus.ok' },
  UNKNOWN: { cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300', labelKey: 'dueStatus.unknown' },
};

function dueDetail(p: MaintenancePlan, t: ReturnType<typeof useTranslations>): string {
  const parts: string[] = [];
  if (p.nextDueOdometer != null) {
    parts.push(
      p.kmRemaining != null && p.kmRemaining <= 0
        ? t('kmOverdue', { km: Math.abs(p.kmRemaining).toLocaleString('pt-BR') })
        : t('kmRemaining', { km: (p.kmRemaining ?? 0).toLocaleString('pt-BR') }),
    );
  }
  if (p.nextDueDate != null) {
    parts.push(
      p.daysRemaining != null && p.daysRemaining <= 0
        ? t('daysOverdue', { days: Math.abs(p.daysRemaining) })
        : t('daysRemaining', { days: p.daysRemaining ?? 0 }),
    );
  }
  return parts.join(' · ') || '—';
}

export default function FleetMaintenancePage() {
  const t = useTranslations('fleet.maintenance');
  const tc = useTranslations('common');
  const [dueOnly, setDueOnly] = useState(false);
  const plansKey = fleetApi.plansPath({ dueOnly: dueOnly || undefined, pageSize: 200 });
  const { data: plans, isLoading, error, mutate } = useSWR<Paginated<MaintenancePlan>>(
    plansKey,
    () => fleetApi.listPlans({ dueOnly: dueOnly || undefined, pageSize: 200 }),
  );
  const { data: records, mutate: mutateRecords } = useSWR<Paginated<MaintenanceRecord>>(
    fleetApi.recordsPath({ pageSize: 50 }),
    swrFetcher,
  );
  const canManage = hasPermission('fleet.maintenance.manage');

  const [planModal, setPlanModal] = useState<MaintenancePlan | 'new' | null>(null);
  const [recordFor, setRecordFor] = useState<MaintenancePlan | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MaintenancePlan | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function refresh() {
    await Promise.all([mutate(), mutateRecords()]);
  }

  async function handleDelete(p: MaintenancePlan) {
    setDeleting(true);
    try {
      await fleetApi.deletePlan(p.id);
      await mutate();
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  const planRows = plans?.data ?? [];
  const recordRows = records?.data ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('subtitle')}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setRecordFor('new')}>{t('registerMaintenance')}</Button>
            <Button onClick={() => setPlanModal('new')}>{t('newPlan')}</Button>
          </div>
        )}
      </header>

      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={dueOnly} onChange={(e) => setDueOnly(e.target.checked)} />
        {t('dueOnlyFilter')}
      </label>

      {isLoading && <PageLoader />}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {t('loadFailure')}
        </div>
      )}

      {plans && planRows.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
          {dueOnly ? t('emptyAlerts') : t('emptyPlans')}
        </p>
      )}

      {planRows.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-900/40">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3">{t('col.vehicle')}</th>
                  <th className="px-4 py-3">{t('col.item')}</th>
                  <th className="px-4 py-3">{t('col.interval')}</th>
                  <th className="px-4 py-3">{t('col.next')}</th>
                  <th className="px-4 py-3">{t('col.situation')}</th>
                  {canManage && <th className="px-4 py-3 text-right">{tc('actions')}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {planRows.map((p) => {
                  const badge = DUE_BADGE[p.dueStatus];
                  return (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                      <td className="px-4 py-3 font-mono text-slate-900 dark:text-slate-100">
                        {p.vehicle?.plate ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {MAINTENANCE_KIND_LABELS[p.kind]}
                        {p.description ? <span className="block text-xs text-slate-400">{p.description}</span> : null}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {[p.intervalKm ? `${p.intervalKm.toLocaleString('pt-BR')} km` : null, p.intervalDays ? `${p.intervalDays} dias` : null]
                          .filter(Boolean)
                          .join(' / ') || '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {[
                          p.nextDueOdometer != null ? `${p.nextDueOdometer.toLocaleString('pt-BR')} km` : null,
                          p.nextDueDate ? new Date(p.nextDueDate).toLocaleDateString('pt-BR') : null,
                        ].filter(Boolean).join(' · ') || '—'}
                        <span className="block text-xs text-slate-400">{dueDetail(p, t)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${badge.cls}`}>{t(badge.labelKey)}</span>
                      </td>
                      {canManage && (
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <Button variant="ghost" size="sm" onClick={() => setRecordFor(p)}>{t('register')}</Button>
                          <Button variant="ghost" size="sm" onClick={() => setPlanModal(p)}>{tc('edit')}</Button>
                          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(p)}>{tc('delete')}</Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {recordRows.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{t('doneTitle')}</h2>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead className="bg-slate-50 dark:bg-slate-900/40">
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3">{t('col.date')}</th>
                    <th className="px-4 py-3">{t('col.vehicle')}</th>
                    <th className="px-4 py-3">{t('col.item')}</th>
                    <th className="px-4 py-3">{t('col.odometer')}</th>
                    <th className="px-4 py-3">{t('col.workshop')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {recordRows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{new Date(r.performedAt).toLocaleDateString('pt-BR')}</td>
                      <td className="px-4 py-3 font-mono text-slate-900 dark:text-slate-100">{r.vehicle?.plate ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{MAINTENANCE_KIND_LABELS[r.kind]}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{r.odometer != null ? `${r.odometer.toLocaleString('pt-BR')} km` : '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{r.workshop || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {planModal && (
        <PlanFormModal
          initial={planModal === 'new' ? null : planModal}
          onClose={() => setPlanModal(null)}
          onSaved={async () => {
            setPlanModal(null);
            await mutate();
          }}
        />
      )}

      {recordFor && (
        <RecordFormModal
          plan={recordFor === 'new' ? null : recordFor}
          onClose={() => setRecordFor(null)}
          onSaved={async () => {
            setRecordFor(null);
            await refresh();
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

function PlanFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: MaintenancePlan | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('fleet.maintenance');
  const tc = useTranslations('common');
  const isNew = !initial;
  const { data: vehicles } = useSWR<Paginated<Vehicle>>(fleetApi.vehiclesPath({ pageSize: 200 }), swrFetcher);
  const [form, setForm] = useState({
    vehicleId: initial?.vehicleId ?? '',
    kind: (initial?.kind ?? 'OIL_CHANGE') as MaintenanceKind,
    description: initial?.description ?? '',
    intervalKm: initial?.intervalKm != null ? String(initial.intervalKm) : '',
    intervalDays: initial?.intervalDays != null ? String(initial.intervalDays) : '',
    lastServiceOdometer: initial?.lastServiceOdometer != null ? String(initial.lastServiceOdometer) : '',
    lastServiceDate: initial?.lastServiceDate ?? '',
    active: initial?.active ?? true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isNew && !form.vehicleId) return setError(t('errSelectVehicle'));
    if (!form.intervalKm && !form.intervalDays) return setError(t('errInterval'));
    setSubmitting(true);
    try {
      if (isNew) {
        const payload: CreateMaintenancePlanInput = {
          vehicleId: form.vehicleId,
          kind: form.kind,
          description: form.description || null,
          intervalKm: form.intervalKm ? Number(form.intervalKm) : null,
          intervalDays: form.intervalDays ? Number(form.intervalDays) : null,
          lastServiceOdometer: form.lastServiceOdometer ? Number(form.lastServiceOdometer) : null,
          lastServiceDate: form.lastServiceDate || null,
          active: form.active,
        };
        await fleetApi.createPlan(payload);
      } else {
        await fleetApi.updatePlan(initial!.id, {
          kind: form.kind,
          description: form.description || null,
          intervalKm: form.intervalKm ? Number(form.intervalKm) : null,
          intervalDays: form.intervalDays ? Number(form.intervalDays) : null,
          lastServiceOdometer: form.lastServiceOdometer ? Number(form.lastServiceOdometer) : null,
          lastServiceDate: form.lastServiceDate || null,
          active: form.active,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : t('errSave'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isNew ? t('planModalNewTitle') : t('planModalEditTitle')}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="vehicle">{t('field.vehicleRequired')}</Label>
            <select
              id="vehicle"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900"
              value={form.vehicleId}
              onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}
              disabled={!isNew}
              required={isNew}
            >
              <option value="">{t('selectPlaceholder')}</option>
              {(vehicles?.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>{v.plate} {[v.brand, v.model].filter(Boolean).join(' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="kind">{t('field.item')}</Label>
            <select
              id="kind"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as MaintenanceKind })}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>{MAINTENANCE_KIND_LABELS[k]}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="ikm">{t('field.intervalKm')}</Label>
            <Input id="ikm" type="number" value={form.intervalKm} onChange={(e) => setForm({ ...form, intervalKm: e.target.value })} placeholder={t('ph.intervalKm')} />
          </div>
          <div>
            <Label htmlFor="idays">{t('field.intervalDays')}</Label>
            <Input id="idays" type="number" value={form.intervalDays} onChange={(e) => setForm({ ...form, intervalDays: e.target.value })} placeholder={t('ph.intervalDays')} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="lso">{t('field.lastServiceKm')}</Label>
            <Input id="lso" type="number" value={form.lastServiceOdometer} onChange={(e) => setForm({ ...form, lastServiceOdometer: e.target.value })} placeholder={t('ph.lastServiceKm')} />
          </div>
          <div>
            <Label htmlFor="lsd">{t('field.lastServiceDate')}</Label>
            <Input id="lsd" type="date" value={form.lastServiceDate ?? ''} onChange={(e) => setForm({ ...form, lastServiceDate: e.target.value })} />
          </div>
        </div>

        <div>
          <Label htmlFor="desc">{tc('description')}</Label>
          <Textarea id="desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          {t('field.active')}
        </label>

        {error && <FieldError>{error}</FieldError>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>{tc('cancel')}</Button>
          <Button type="submit" loading={submitting}>{isNew ? tc('create') : tc('save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

function RecordFormModal({
  plan,
  onClose,
  onSaved,
}: {
  plan: MaintenancePlan | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('fleet.maintenance');
  const tc = useTranslations('common');
  const { data: vehicles } = useSWR<Paginated<Vehicle>>(fleetApi.vehiclesPath({ pageSize: 200 }), swrFetcher);
  const [form, setForm] = useState({
    vehicleId: plan?.vehicleId ?? '',
    kind: (plan?.kind ?? 'OIL_CHANGE') as MaintenanceKind,
    performedAt: new Date().toISOString().slice(0, 10),
    odometer: plan?.vehicle?.odometer != null ? String(plan.vehicle.odometer) : '',
    cost: '',
    workshop: '',
    description: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.vehicleId) return setError(t('errSelectVehicle'));
    setSubmitting(true);
    try {
      const payload: CreateMaintenanceRecordInput = {
        vehicleId: form.vehicleId,
        planId: plan?.id ?? null,
        kind: form.kind,
        performedAt: form.performedAt,
        odometer: form.odometer ? Number(form.odometer) : null,
        cost: form.cost ? Number(form.cost) : null,
        workshop: form.workshop || null,
        description: form.description || null,
      };
      await fleetApi.createRecord(payload);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : t('errSave'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={plan ? t('recordModalTitleFor', { item: MAINTENANCE_KIND_LABELS[plan.kind] }) : t('registerMaintenance')}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="rv">{t('field.vehicleRequired')}</Label>
            <select
              id="rv"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900"
              value={form.vehicleId}
              onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}
              disabled={!!plan}
              required
            >
              <option value="">{t('selectPlaceholder')}</option>
              {(vehicles?.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>{v.plate} {[v.brand, v.model].filter(Boolean).join(' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="rk">{t('field.item')}</Label>
            <select
              id="rk"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as MaintenanceKind })}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>{MAINTENANCE_KIND_LABELS[k]}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="rd">{t('field.date')}</Label>
            <Input id="rd" type="date" value={form.performedAt} onChange={(e) => setForm({ ...form, performedAt: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="ro">{t('field.odometerKm')}</Label>
            <Input id="ro" type="number" value={form.odometer} onChange={(e) => setForm({ ...form, odometer: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="rc">{t('field.cost')}</Label>
            <Input id="rc" type="number" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
          </div>
        </div>

        <div>
          <Label htmlFor="rw">{t('field.workshop')}</Label>
          <Input id="rw" value={form.workshop} onChange={(e) => setForm({ ...form, workshop: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="rdesc">{tc('description')}</Label>
          <Textarea id="rdesc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>

        <p className="text-xs text-slate-400">
          {t('costHint')}
        </p>

        {error && <FieldError>{error}</FieldError>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>{tc('cancel')}</Button>
          <Button type="submit" loading={submitting}>{t('register')}</Button>
        </div>
      </form>
    </Modal>
  );
}

'use client';

/**
 * /settings/plans — catálogo de planos de internet (velocidade + preço).
 *
 * O contrato seleciona um plano, que preenche valor e velocidade. A
 * velocidade vira a queue RADIUS (Mikrotik-Rate-Limit) por cliente.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { FieldError, FieldHelp, Input, Label, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { Badge } from '@/components/ui/Badge';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import { useFormatMoney } from '@/lib/use-money';
import { plansApi, type CreatePlanInput, type Plan } from '@/lib/plans-api';

export default function PlansPage() {
  const t = useTranslations('settings.plans');
  const tc = useTranslations('common');
  const { data, isLoading, mutate } = useSWR<Plan[]>(
    plansApi.listPath(true),
    () => plansApi.list(true),
  );
  const canManage = hasPermission('plans.manage');
  const formatMoney = useFormatMoney();

  const [editing, setEditing] = useState<Plan | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Plan | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (isLoading) return <PageLoader />;
  const plans = data ?? [];

  async function handleDelete(p: Plan) {
    setDeleting(true);
    try {
      await plansApi.remove(p.id);
      await mutate();
      setConfirmDelete(null);
    } catch (err) {
      // Plano em uso → backend retorna 409. Mostra a mensagem.
      const msg = err instanceof ApiError ? err.friendlyMessage : t('deleteError');
      alert(msg);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('subtitle')}
          </p>
        </div>
        {canManage && <Button onClick={() => setCreating(true)}>{t('newPlan')}</Button>}
      </header>

      {plans.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          {t('empty')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t('colPlan')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('colDownload')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('colUpload')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('colMonthlyPrice')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('colBlock')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('colContracts')}</th>
                <th className="px-3 py-2 text-left font-medium">{tc('status')}</th>
                <th className="px-3 py-2 text-right font-medium">{tc('actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {plans.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-900">
                  <td className="px-3 py-2 font-medium">{p.name}</td>
                  <td className="px-3 py-2">{p.downloadMbps} Mbps</td>
                  <td className="px-3 py-2">{p.uploadMbps} Mbps</td>
                  <td className="px-3 py-2">{formatMoney(Number(p.monthlyPrice))}</td>
                  <td className="px-3 py-2 text-slate-500">{t('days', { count: p.blockAfterDays })}</td>
                  <td className="px-3 py-2 text-slate-500">{p.contractCount ?? 0}</td>
                  <td className="px-3 py-2">
                    <Badge tone={p.isActive ? 'success' : 'neutral'}>
                      {p.isActive ? t('active') : t('inactive')}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canManage && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                          {tc('edit')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmDelete(p)}
                        >
                          {tc('delete')}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <PlanFormModal
          plan={editing}
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
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => handleDelete(confirmDelete)}
          title={t('deleteTitle')}
          message={t('deleteMessage', { name: confirmDelete.name })}
          confirmLabel={tc('delete')}
          variant="danger"
          loading={deleting}
        />
      )}
    </div>
  );
}

interface PlanFormModalProps {
  plan: Plan | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

function PlanFormModal({ plan, onClose, onSaved }: PlanFormModalProps) {
  const t = useTranslations('settings.plans');
  const tc = useTranslations('common');
  const [form, setForm] = useState<CreatePlanInput>({
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    downloadMbps: plan?.downloadMbps ?? 500,
    uploadMbps: plan?.uploadMbps ?? 500,
    monthlyPrice: plan ? Number(plan.monthlyPrice) : 0,
    blockAfterDays: plan?.blockAfterDays ?? 5,
    isActive: plan?.isActive ?? true,
    order: plan?.order ?? 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof CreatePlanInput>(k: K, v: CreatePlanInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (plan) await plansApi.update(plan.id, form);
      else await plansApi.create(form);
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={plan ? t('editTitle') : t('newPlan')}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <Label htmlFor="plan-name" required>
            {tc('name')}
          </Label>
          <Input
            id="plan-name"
            required
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder={t('namePlaceholder')}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="plan-download" required>
              {t('downloadMbps')}
            </Label>
            <Input
              id="plan-download"
              type="number"
              required
              min={1}
              value={form.downloadMbps}
              onChange={(e) => set('downloadMbps', Number(e.target.value))}
            />
          </div>
          <div>
            <Label htmlFor="plan-upload" required>
              {t('uploadMbps')}
            </Label>
            <Input
              id="plan-upload"
              type="number"
              required
              min={1}
              value={form.uploadMbps}
              onChange={(e) => set('uploadMbps', Number(e.target.value))}
            />
            <FieldHelp>{t('symmetricHelp')}</FieldHelp>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="plan-price" required>
              {t('monthlyPrice')}
            </Label>
            <Input
              id="plan-price"
              type="number"
              required
              min={0}
              step="0.01"
              value={form.monthlyPrice}
              onChange={(e) => set('monthlyPrice', Number(e.target.value))}
            />
          </div>
          <div>
            <Label htmlFor="plan-order">{t('displayOrder')}</Label>
            <Input
              id="plan-order"
              type="number"
              min={0}
              value={form.order ?? 0}
              onChange={(e) => set('order', Number(e.target.value))}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="plan-block-after-days">{t('blockAfterDays')}</Label>
          <Input
            id="plan-block-after-days"
            type="number"
            min={0}
            max={60}
            value={form.blockAfterDays ?? 5}
            onChange={(e) => set('blockAfterDays', Number(e.target.value))}
          />
          <FieldHelp>{t('blockAfterDaysHelp')}</FieldHelp>
        </div>

        <div>
          <Label htmlFor="plan-description">{t('descriptionLabel')}</Label>
          <Textarea
            id="plan-description"
            rows={2}
            value={form.description ?? ''}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isActive ?? true}
            onChange={(e) => set('isActive', e.target.checked)}
          />
          {t('isActiveLabel')}
        </label>

        {error && <FieldError>{error}</FieldError>}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={saving}>
            {plan ? tc('save') : tc('create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

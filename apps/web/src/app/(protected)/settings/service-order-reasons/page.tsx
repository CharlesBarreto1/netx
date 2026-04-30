'use client';

import Link from 'next/link';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  FieldHelp,
  Input,
  Label,
  Textarea,
} from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  serviceOrderReasonsApi,
  type ServiceOrderReasonResponse,
} from '@/lib/service-orders-api';

/**
 * /settings/service-order-reasons — CRUD do cadastro de motivos.
 * Mostra ativos + inativos. "Excluir" apenas desativa.
 */
export default function ServiceOrderReasonsPage() {
  const tSO = useTranslations('serviceOrders');
  const tReasons = useTranslations('serviceOrders.reasons');
  const tCommon = useTranslations('common');
  const canManage = hasPermission('service_order_reasons.manage');

  const { data, isLoading, mutate } = useSWR<ServiceOrderReasonResponse[]>(
    serviceOrderReasonsApi.path(true),
  );

  const [editing, setEditing] = useState<ServiceOrderReasonResponse | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ServiceOrderReasonResponse | null>(null);

  if (isLoading || !data) return <PageLoader label={tCommon('loading')} />;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <nav className="text-xs text-text-muted">
            <Link href="/settings/tenant" className="hover:underline">
              {tCommon('back')}
            </Link>
          </nav>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            {tReasons('title')}
          </h1>
          <p className="text-sm text-text-muted">{tReasons('subtitle')}</p>
        </div>
        {canManage && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            {tReasons('new')}
          </Button>
        )}
      </header>

      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <tr>
              <th className="px-3 py-2">{tReasons('cols.name')}</th>
              <th className="px-3 py-2">{tReasons('cols.description')}</th>
              <th className="px-3 py-2 text-center">{tReasons('cols.order')}</th>
              <th className="px-3 py-2">{tCommon('status')}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-text-muted">
                  {tReasons('empty')}
                </td>
              </tr>
            ) : (
              data.map((r) => (
                <tr key={r.id} className="hover:bg-surface-hover">
                  <td className="px-3 py-2 font-medium text-text">{r.name}</td>
                  <td className="px-3 py-2 text-text-muted">
                    {r.description ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-center text-text-muted">
                    {r.order}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={r.isActive ? 'success' : 'neutral'}>
                      {r.isActive ? tReasons('active') : tReasons('inactive')}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canManage && (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(r)}
                        >
                          {tCommon('edit')}
                        </Button>
                        {r.isActive && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleting(r)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {creating && (
        <ReasonFormDialog
          open={creating}
          onOpenChange={setCreating}
          onSaved={async () => {
            setCreating(false);
            await mutate();
          }}
        />
      )}
      {editing && (
        <ReasonFormDialog
          open={!!editing}
          initial={editing}
          onOpenChange={(v) => !v && setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await mutate();
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await serviceOrderReasonsApi.remove(deleting.id);
            toast.success(tCommon('success'));
            setDeleting(null);
            await mutate();
          } catch (err) {
            const msg = err instanceof ApiError ? err.friendlyMessage : 'Erro';
            toast.error(msg);
          }
        }}
        title={tReasons('deactivateTitle')}
        message={tReasons('deactivateMessage', { name: deleting?.name ?? '' })}
        confirmLabel={tCommon('confirm')}
        variant="danger"
      />
    </div>
  );
}

// =============================================================================
// FORM DIALOG (create / edit)
// =============================================================================
function ReasonFormDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: ServiceOrderReasonResponse;
  onSaved: () => void;
}) {
  const tReasons = useTranslations('serviceOrders.reasons');
  const tCommon = useTranslations('common');
  const isEdit = !!initial;

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [order, setOrder] = useState(String(initial?.order ?? 0));
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      if (isEdit && initial) {
        await serviceOrderReasonsApi.update(initial.id, {
          name: name.trim(),
          description: description.trim() || null,
          isActive,
          order: Number(order) || 0,
        });
      } else {
        await serviceOrderReasonsApi.create({
          name: name.trim(),
          description: description.trim() || null,
          isActive,
          order: Number(order) || 0,
        });
      }
      toast.success(tCommon('success'));
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : 'Erro';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {isEdit ? tCommon('edit') : tReasons('new')}
            </DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <div>
              <Label htmlFor="r-name" required>
                {tReasons('cols.name')}
              </Label>
              <Input
                id="r-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="r-desc">{tReasons('cols.description')}</Label>
              <Textarea
                id="r-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="r-order">{tReasons('cols.order')}</Label>
                <Input
                  id="r-order"
                  type="number"
                  value={order}
                  onChange={(e) => setOrder(e.target.value)}
                  min={0}
                />
                <FieldHelp>{tReasons('orderHelp')}</FieldHelp>
              </div>
              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600"
                  />
                  <span>{tReasons('active')}</span>
                </label>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {tCommon('cancel')}
            </Button>
            <Button type="submit" loading={submitting}>
              {isEdit ? tCommon('save') : tCommon('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

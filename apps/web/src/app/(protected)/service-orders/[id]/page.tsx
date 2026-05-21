'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { OsStockSection } from '@/components/service-orders/OsStockSection';
import { ServiceOrderStatusBadge } from '@/components/service-orders/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  serviceOrdersApi,
  type ServiceOrderResponse,
} from '@/lib/service-orders-api';
import { formatDateTime } from '@/lib/format';

/**
 * /service-orders/[id] — detalhe + transições.
 *
 * Ações por status:
 *   OPEN/SCHEDULED/OVERDUE → Iniciar (POST /start) | Cancelar
 *   IN_PROGRESS            → Finalizar (POST /complete) | Cancelar
 *   COMPLETED              → (sem ações; reabrir não previsto no v1)
 *   CANCELLED              → (sem ações)
 */
export default function ServiceOrderDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const tSO = useTranslations('serviceOrders');
  const tDetail = useTranslations('serviceOrders.detail');
  const tCommon = useTranslations('common');
  const canWrite = hasPermission('service_orders.write');
  const canDelete = hasPermission('service_orders.delete');

  const key = id ? serviceOrdersApi.getPath(id) : null;
  const { data: os, isLoading, error, mutate } = useSWR<ServiceOrderResponse>(key);

  const [completeOpen, setCompleteOpen] = useState(false);
  const [closeDescription, setCloseDescription] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (isLoading || !os) return <PageLoader label={tCommon('loading')} />;
  if (error) {
    const msg =
      error instanceof ApiError ? error.friendlyMessage : (error as Error).message;
    return <p className="text-sm text-red-600">{msg}</p>;
  }

  const isOpenLike =
    os.status === 'OPEN' || os.status === 'SCHEDULED';
  const isInProgress = os.status === 'IN_PROGRESS';

  // Os handlers podem ser chamados a qualquer momento; o TS não propaga o
  // narrowing do `if (!os) return` lá em cima porque closures podem rodar
  // depois do componente ser desmontado/re-renderizado. Guard explícita.
  async function handleStart() {
    if (!os) return;
    setBusy(true);
    try {
      const updated = await serviceOrdersApi.start(os.id);
      await mutate(updated, false);
      toast.success(tDetail('startedToast'));
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : 'Erro';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleComplete() {
    if (!os) return;
    if (closeDescription.trim().length < 1) return;
    setBusy(true);
    try {
      const updated = await serviceOrdersApi.complete(os.id, {
        closeDescription: closeDescription.trim(),
      });
      await mutate(updated, false);
      toast.success(tDetail('completedToast'));
      setCompleteOpen(false);
      setCloseDescription('');
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : 'Erro';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!os) return;
    setBusy(true);
    try {
      const updated = await serviceOrdersApi.cancel(os.id, {
        reason: cancelReason.trim() || undefined,
      });
      await mutate(updated, false);
      toast.success(tDetail('cancelledToast'));
      setCancelOpen(false);
      setCancelReason('');
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : 'Erro';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!os) return;
    setBusy(true);
    try {
      await serviceOrdersApi.remove(os.id);
      toast.success(tCommon('success'));
      router.replace('/service-orders');
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : 'Erro';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <nav className="text-xs text-slate-500 dark:text-slate-400">
          <Link href="/service-orders" className="hover:underline">
            {tSO('title')}
          </Link>{' '}
          › {os.code ?? os.id.slice(0, 8)}
        </nav>

        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">
                {os.code ?? `#${os.id.slice(0, 8)}`}
              </h1>
              <ServiceOrderStatusBadge status={os.displayStatus} />
            </div>
            <p className="text-sm text-text-muted">
              {os.reason?.name ?? '—'} · {os.customer?.displayName ?? '—'}
              {os.contract?.code && ` · ${os.contract.code}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Imprimir / Salvar PDF — disponível em qualquer status. Abre em
                nova aba pra não perder o estado da tela. */}
            <Link
              href={`/service-orders/${os.id}/print`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline">{tDetail('actionPrint')}</Button>
            </Link>
            {canWrite && isOpenLike && (
              <Button onClick={handleStart} loading={busy}>
                {tDetail('actionStart')}
              </Button>
            )}
            {canWrite && isInProgress && (
              <Button onClick={() => setCompleteOpen(true)}>
                {tDetail('actionComplete')}
              </Button>
            )}
            {canWrite && (isOpenLike || isInProgress) && (
              <Button variant="outline" onClick={() => setCancelOpen(true)}>
                {tDetail('actionCancel')}
              </Button>
            )}
            {canDelete && (
              <Button variant="ghost" onClick={() => setDeleteOpen(true)}>
                {tCommon('delete')}
              </Button>
            )}
          </div>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-md border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text">{tDetail('cardData')}</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Row label={tDetail('openedAt')} value={formatDateTime(os.openedAt)} />
            <Row
              label={tDetail('scheduledAt')}
              value={os.scheduledAt ? formatDateTime(os.scheduledAt) : '—'}
            />
            <Row
              label={tDetail('startedAt')}
              value={os.startedAt ? formatDateTime(os.startedAt) : '—'}
            />
            <Row
              label={tDetail('completedAt')}
              value={os.completedAt ? formatDateTime(os.completedAt) : '—'}
            />
            <Row
              label={tDetail('cancelledAt')}
              value={os.cancelledAt ? formatDateTime(os.cancelledAt) : '—'}
            />
            <Row
              label={tDetail('city')}
              value={[os.city, os.state].filter(Boolean).join(' · ') || '—'}
            />
          </dl>
        </div>
        <div className="rounded-md border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text">
            {tDetail('cardLinks')}
          </h2>
          <dl className="mt-2 grid grid-cols-1 gap-y-2 text-sm">
            {os.contract && (
              <Row
                label={tDetail('contract')}
                value={
                  <Link
                    href={`/contracts/${os.contract.id}`}
                    className="text-brand-500 hover:underline"
                  >
                    {os.contract.code ?? os.contract.id.slice(0, 8)} · {os.contract.pppoeUsername}
                  </Link>
                }
              />
            )}
            {os.customer && (
              <Row
                label={tDetail('customer')}
                value={
                  <Link
                    href={`/customers/${os.customer.id}`}
                    className="text-brand-500 hover:underline"
                  >
                    {os.customer.displayName}
                  </Link>
                }
              />
            )}
            {os.assignedTo && (
              <Row
                label={tDetail('assignedTo')}
                value={`${os.assignedTo.firstName} ${os.assignedTo.lastName}`}
              />
            )}
          </dl>
        </div>
      </section>

      <section className="rounded-md border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-text">
          {tDetail('openDescription')}
        </h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-text">
          {os.openDescription}
        </p>
      </section>

      {os.closeDescription && (
        <section className="rounded-md border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text">
            {tDetail('closeDescription')}
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-text">
            {os.closeDescription}
          </p>
        </section>
      )}

      {/* Estoque — materiais consumidos + atalho pra alocar comodato (Fase 2) */}
      {os.contractId && (
        <section className="rounded-md border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text mb-3">
            Estoque & comodato
          </h2>
          <OsStockSection
            serviceOrderId={os.id}
            contractId={os.contractId}
            isFinalized={
              os.status === 'COMPLETED' || os.status === 'CANCELLED'
            }
          />
        </section>
      )}

      {/* Diálogo: Finalizar (exige closeDescription) */}
      {completeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-lg rounded-md border border-border bg-surface p-5 shadow-lg">
            <h3 className="text-base font-semibold text-text">
              {tDetail('completeTitle')}
            </h3>
            <p className="mt-1 text-xs text-text-muted">{tDetail('completeHelp')}</p>
            <div className="mt-3">
              <Label htmlFor="so-close" required>
                {tDetail('closeDescription')}
              </Label>
              <Textarea
                id="so-close"
                rows={4}
                value={closeDescription}
                onChange={(e) => setCloseDescription(e.target.value)}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setCompleteOpen(false)}
                disabled={busy}
              >
                {tCommon('cancel')}
              </Button>
              <Button
                onClick={handleComplete}
                loading={busy}
                disabled={closeDescription.trim().length < 1}
              >
                {tDetail('actionComplete')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Diálogo: Cancelar */}
      {cancelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-lg rounded-md border border-border bg-surface p-5 shadow-lg">
            <h3 className="text-base font-semibold text-text">
              {tDetail('cancelTitle')}
            </h3>
            <p className="mt-1 text-xs text-text-muted">{tDetail('cancelHelp')}</p>
            <div className="mt-3">
              <Label htmlFor="so-cancel-reason">{tDetail('cancelReason')}</Label>
              <Input
                id="so-cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setCancelOpen(false)}
                disabled={busy}
              >
                {tCommon('cancel')}
              </Button>
              <Button onClick={handleCancel} variant="danger" loading={busy}>
                {tDetail('actionCancel')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title={tDetail('deleteTitle')}
        message={tDetail('deleteMessage')}
        confirmLabel={tCommon('delete')}
        variant="danger"
        loading={busy}
      />
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
        {label}
      </dt>
      <dd className="text-sm text-text">{value}</dd>
    </>
  );
}

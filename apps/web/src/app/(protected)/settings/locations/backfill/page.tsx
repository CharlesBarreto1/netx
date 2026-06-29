'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';
import type { Paginated } from '@netx/shared';

import { AddressPicker, EMPTY_ADDRESS, type AddressValue } from '@/components/contracts/AddressPicker';
import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import { useTenantConfig } from '@/lib/tenant-config';
import { contractsApi } from '@/lib/contracts-api';
import { locationsApi, type AddressBackfillItem } from '@/lib/locations-api';

function errMsg(e: unknown, t: (key: string) => string): string {
  return e instanceof ApiError ? e.friendlyMessage : t('errors.unexpected');
}

function fmtCep(cep: string | null): string {
  return cep ? cep.replace(/^(\d{5})(\d{3})$/, '$1-$2') : '—';
}

export default function AddressBackfillPage() {
  const t = useTranslations('settingsLocations');
  const tCommon = useTranslations('common');
  const { tenant, isLoading: tenantLoading } = useTenantConfig();
  const canManage = hasPermission('contracts.write');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, isLoading, mutate } = useSWR<Paginated<AddressBackfillItem>>(
    tenant?.country === 'BR' ? locationsApi.backfillPath(page, pageSize) : null,
  );

  const [reconciling, setReconciling] = useState<AddressBackfillItem | null>(null);

  if (tenantLoading) return <PageLoader />;
  if (tenant?.country !== 'BR') {
    return (
      <div className="rounded-md border border-border bg-surface p-10 text-center">
        <p className="text-sm text-text-muted">{t('backfill.brOnly')}</p>
      </div>
    );
  }
  if (isLoading || !data) return <PageLoader label={t('backfill.loadingContracts')} />;

  const { data: items, pagination } = data;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('backfill.title')}</h1>
          <p className="text-sm text-text-muted">{t('backfill.subtitle')}</p>
        </div>
        <Link
          href="/settings/locations"
          className="text-sm text-accent hover:underline"
        >
          {t('backfill.backLink')}
        </Link>
      </header>

      <p className="text-sm text-text-muted">
        {pagination.total === 0
          ? t('backfill.allDone')
          : t('backfill.pendingCount', { count: pagination.total })}
      </p>

      {items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border bg-surface">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              <tr>
                <th className="px-3 py-2">{t('backfill.colContract')}</th>
                <th className="px-3 py-2">{t('backfill.colCustomer')}</th>
                <th className="px-3 py-2">{t('backfill.colCurrentAddress')}</th>
                <th className="px-3 py-2">{t('backfill.colCepNumber')}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((it) => (
                <tr key={it.contractId} className="hover:bg-surface-hover">
                  <td className="px-3 py-2 font-mono text-xs text-text-muted">
                    {it.contractCode ?? it.contractId.slice(0, 8)}
                  </td>
                  <td className="px-3 py-2 font-medium text-text">{it.customerName}</td>
                  <td className="max-w-md px-3 py-2 text-text-muted">{it.installationAddress}</td>
                  <td className="px-3 py-2 text-xs text-text-muted">
                    {fmtCep(it.suggestedCep)}
                    {it.suggestedNumber ? ` · ${t('backfill.numberPrefix', { number: it.suggestedNumber })}` : ''}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canManage && (
                      <Button size="sm" onClick={() => setReconciling(it)}>
                        {t('backfill.link')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {tCommon('previous')}
          </Button>
          <span className="text-text-muted">
            {pagination.page} / {pagination.totalPages}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {tCommon('next')}
          </Button>
        </div>
      )}

      {reconciling && (
        <ReconcileDialog
          item={reconciling}
          country={tenant.country}
          onClose={() => setReconciling(null)}
          onSaved={async () => {
            setReconciling(null);
            await mutate();
          }}
        />
      )}
    </div>
  );
}

function ReconcileDialog({
  item,
  country,
  onClose,
  onSaved,
}: {
  item: AddressBackfillItem;
  country: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('settingsLocations');
  const tCommon = useTranslations('common');
  const [address, setAddress] = useState<AddressValue>({
    ...EMPTY_ADDRESS,
    addressNumber: item.suggestedNumber ?? '',
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!address.streetId) {
      toast.error(t('reconcile.selectStreet'));
      return;
    }
    setSaving(true);
    try {
      await contractsApi.update(item.contractId, {
        streetId: address.streetId,
        addressNumber: address.addressNumber.trim() || null,
        addressComplement: address.addressComplement.trim() || null,
      });
      toast.success(t('reconcile.linked'));
      onSaved();
    } catch (e) {
      toast.error(errMsg(e, t));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t('reconcile.title', { ref: item.contractCode ?? item.customerName })}
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <div className="rounded bg-surface-muted px-3 py-2 text-xs text-text-muted">
            <span className="font-semibold">{t('reconcile.originalAddress')}</span> {item.installationAddress}
            {item.suggestedCep && (
              <>
                <br />
                <span className="font-semibold">{t('reconcile.suggestedCep')}</span> {fmtCep(item.suggestedCep)} {t('reconcile.suggestedCepHint')}
              </>
            )}
          </div>
          <AddressPicker
            country={country}
            value={address}
            onChange={setAddress}
            freeTextLabel={t('reconcile.addressLabel')}
            initialCep={item.suggestedCep ?? undefined}
          />
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" onClick={() => void save()} loading={saving} disabled={!address.streetId}>
            {t('backfill.link')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

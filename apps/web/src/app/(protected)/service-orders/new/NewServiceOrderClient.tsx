'use client';

/**
 * NewServiceOrderClient — conteúdo client da rota `/service-orders/new`.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Padrão server-wrapper: a `page.tsx` é server component que exporta
 * `dynamic = 'force-dynamic'`. Ver comentário em `page.tsx` pra contexto.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import {
  FieldError,
  FieldHelp,
  Input,
  Label,
  Select,
  Textarea,
} from '@/components/ui/Input';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { contractsApi, type Contract } from '@/lib/contracts-api';
import type { Paginated } from '@/lib/crm-types';
import {
  serviceOrdersApi,
  serviceOrderReasonsApi,
  type ServiceOrderReasonResponse,
} from '@/lib/service-orders-api';

export default function NewServiceOrderClient() {
  const router = useRouter();
  const params = useSearchParams();
  const tSO = useTranslations('serviceOrders');
  const tCommon = useTranslations('common');
  const tForm = useTranslations('serviceOrders.form');

  const prefilledContractId = params.get('contractId');
  // Quando vem do hub do cliente (/customers/[id]), limita a busca de
  // contratos àquele cliente. Se o cliente tem só 1 contrato, pré-seleciona.
  const prefilledCustomerId = params.get('customerId');

  const { data: reasons } = useSWR<ServiceOrderReasonResponse[]>(
    serviceOrderReasonsApi.path(false),
  );
  const { data: contractsResp } = useSWR<Paginated<Contract>>(
    contractsApi.listPath({
      pageSize: 200,
      ...(prefilledCustomerId ? { customerId: prefilledCustomerId } : {}),
    }),
  );
  const contracts = contractsResp?.data ?? [];

  const [contractId, setContractId] = useState(prefilledContractId ?? '');

  // Auto-select quando vier do hub do cliente e ele tem só 1 contrato.
  if (
    !prefilledContractId &&
    prefilledCustomerId &&
    contracts.length === 1 &&
    contractId === ''
  ) {
    setContractId(contracts[0].id);
  }
  const [reasonId, setReasonId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [openDescription, setOpenDescription] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!contractId || !reasonId || !openDescription.trim()) {
      setError(tForm('requiredFields'));
      return;
    }
    setSubmitting(true);
    try {
      const created = await serviceOrdersApi.create({
        contractId,
        reasonId,
        scheduledAt: scheduledAt
          ? new Date(`${scheduledAt}:00`).toISOString()
          : null,
        openDescription: openDescription.trim(),
        city: city.trim() || null,
        state: state.trim() || null,
      });
      toast.success(tCommon('success'));
      router.replace(`/service-orders/${created.id}`);
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <nav className="text-xs text-slate-500 dark:text-slate-400">
          <Link href="/service-orders" className="hover:underline">
            {tSO('title')}
          </Link>{' '}
          › {tCommon('new')}
        </nav>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{tSO('new')}</h1>
        <p className="text-sm text-text-muted">{tForm('newSubtitle')}</p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800"
      >
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        <div>
          <Label htmlFor="so-contract" required>
            {tForm('contract')}
          </Label>
          <Select
            id="so-contract"
            value={contractId}
            onChange={(e) => setContractId(e.target.value)}
            disabled={!!prefilledContractId}
          >
            <option value="">{tCommon('select')}</option>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code ?? c.id.slice(0, 8)} · {c.customer?.displayName ?? '—'} ({c.pppoeUsername})
              </option>
            ))}
          </Select>
          {prefilledContractId && (
            <FieldHelp>{tForm('contractLocked')}</FieldHelp>
          )}
        </div>

        <div>
          <Label htmlFor="so-reason" required>
            {tForm('reason')}
          </Label>
          <Select
            id="so-reason"
            value={reasonId}
            onChange={(e) => setReasonId(e.target.value)}
          >
            <option value="">{tCommon('select')}</option>
            {(reasons ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
          {(!reasons || reasons.length === 0) && (
            <FieldHelp>
              <Link
                href="/settings/service-order-reasons"
                className="text-brand-500 hover:underline"
              >
                {tForm('noReasons')}
              </Link>
            </FieldHelp>
          )}
        </div>

        <div>
          <Label htmlFor="so-scheduled">{tForm('scheduledAt')}</Label>
          <Input
            id="so-scheduled"
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
          <FieldHelp>{tForm('scheduledHelp')}</FieldHelp>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="so-city">{tForm('city')}</Label>
            <Input
              id="so-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder={tForm('cityPlaceholder')}
            />
          </div>
          <div>
            <Label htmlFor="so-state">{tForm('state')}</Label>
            <Input
              id="so-state"
              value={state}
              onChange={(e) => setState(e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="so-open" required>
            {tForm('openDescription')}
          </Label>
          <Textarea
            id="so-open"
            rows={5}
            value={openDescription}
            onChange={(e) => setOpenDescription(e.target.value)}
            placeholder={tForm('openDescriptionPlaceholder')}
          />
          <FieldError>{!openDescription.trim() && error ? error : ''}</FieldError>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
          <Link href="/service-orders">
            <Button type="button" variant="ghost" disabled={submitting}>
              {tCommon('cancel')}
            </Button>
          </Link>
          <Button type="submit" loading={submitting}>
            {tCommon('create')}
          </Button>
        </footer>
      </form>
    </div>
  );
}

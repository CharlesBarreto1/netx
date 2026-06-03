'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldHelp, Input, Label, Select, Textarea } from '@/components/ui/Input';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { contractsApi, type Contract } from '@/lib/contracts-api';
import type { Customer, Paginated } from '@/lib/crm-types';
import { chargesApi } from '@/lib/finance-api';

/**
 * NewChargeDialog — modal compartilhado pra criar OneTimeCharge.
 *
 * Dois modos:
 *   - Standalone (sem `customerId`): pede busca de cliente.
 *   - Vinculado (`customerId`): pré-preenche e oculta o seletor. Usado no
 *     hub do cliente (/customers/[id] aba Financeiro).
 *
 * Quando `customerId` está fixo, oferece também escolher um contrato
 * específico do cliente (pra rastreio fiscal: "multa contrato CTR-X").
 */
export interface NewChargeDialogProps {
  /** Quando definido, esconde busca de cliente. */
  customerId?: string;
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

export function NewChargeDialog({
  customerId,
  open,
  onClose,
  onCreated,
}: NewChargeDialogProps) {
  const t = useTranslations('financeDialogs');
  const tc = useTranslations('common');
  const isLocked = !!customerId;

  const [customerSearch, setCustomerSearch] = useState('');
  const [pickedCustomerId, setPickedCustomerId] = useState<string | null>(
    customerId ?? null,
  );
  const [contractId, setContractId] = useState<string>('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Busca de cliente — só ativo no modo standalone
  const customerKey =
    !isLocked && customerSearch.trim().length >= 2
      ? `/v1/customers?search=${encodeURIComponent(customerSearch.trim())}&pageSize=8`
      : null;
  const { data: hits } = useSWR<Paginated<Customer>>(customerKey);
  const options = hits?.data ?? [];

  // Contratos do cliente vinculado, pra opcionalmente associar a cobrança
  const contractsKey = pickedCustomerId
    ? contractsApi.listPath({ customerId: pickedCustomerId, pageSize: 50 })
    : null;
  const { data: contractsResp } = useSWR<Paginated<Contract>>(contractsKey);
  const contracts = contractsResp?.data ?? [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!pickedCustomerId || !description.trim() || !amount || !dueDate) {
      setError(t('newCharge.requiredFieldsError'));
      return;
    }
    setSubmitting(true);
    try {
      await chargesApi.create({
        customerId: pickedCustomerId,
        contractId: contractId || undefined,
        description: description.trim(),
        amount: Number(amount.replace(',', '.')),
        dueDate,
      });
      toast.success(t('newCharge.createdToast'));
      // Reset (mas mantém customerId travado)
      setDescription('');
      setAmount('');
      setDueDate('');
      setContractId('');
      if (!isLocked) {
        setPickedCustomerId(null);
        setCustomerSearch('');
      }
      onCreated?.();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('newCharge.title')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            {!isLocked && (
              <div>
                <Label required>{t('newCharge.customerLabel')}</Label>
                <Input
                  value={customerSearch}
                  onChange={(e) => {
                    setCustomerSearch(e.target.value);
                    setPickedCustomerId(null);
                    setContractId('');
                  }}
                  placeholder={t('newCharge.customerSearchPlaceholder')}
                />
                {customerSearch.trim().length >= 2 && (
                  <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-surface">
                    {options.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-text-subtle">
                        {tc('noResults')}
                      </div>
                    ) : (
                      options.map((c) => (
                        <button
                          type="button"
                          key={c.id}
                          onClick={() => {
                            setPickedCustomerId(c.id);
                            setCustomerSearch(c.displayName);
                            setContractId('');
                          }}
                          className={
                            'flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs hover:bg-surface-hover ' +
                            (pickedCustomerId === c.id ? 'bg-accent-muted text-accent' : '')
                          }
                        >
                          <span className="truncate">{c.displayName}</span>
                          <span className="text-2xs text-text-subtle">
                            {c.primaryEmail ?? c.primaryPhone ?? ''}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {pickedCustomerId && contracts.length > 0 && (
              <div>
                <Label>{t('newCharge.contractLabel')}</Label>
                <Select
                  value={contractId}
                  onChange={(e) => setContractId(e.target.value)}
                >
                  <option value="">{t('newCharge.noContractOption')}</option>
                  {contracts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code ?? `#${c.id.slice(0, 8)}`} — {c.bandwidthMbps} Mbps
                    </option>
                  ))}
                </Select>
                <FieldHelp>{t('newCharge.contractHelp')}</FieldHelp>
              </div>
            )}

            <div>
              <Label required>{t('newCharge.descriptionLabel')}</Label>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('newCharge.descriptionPlaceholder')}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label required>{t('newCharge.amountLabel')}</Label>
                <Input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0,00"
                />
              </div>
              <div>
                <Label required>{t('newCharge.dueDateLabel')}</Label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>
            {error && (
              <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={submitting}>
              {tc('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

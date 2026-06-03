'use client';

/**
 * Diálogo de geração manual de fatura do contrato (ContractInvoice).
 *
 * Casos excepcionais — o fluxo normal de faturas é o cron mensal. Use para
 * cobrar algo atrelado ao contrato (ajuste, taxa) que deve aparecer no painel
 * financeiro do contrato. Para cobranças avulsas do cliente sem fatura formal,
 * use Financeiro > Cobranças (OneTimeCharge).
 *
 * Chama POST /v1/contracts/:id/invoices (perm contracts.write).
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FieldError, Input, Label } from '@/components/ui/Input';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { contractInvoicesApi } from '@/lib/contracts-api';

export function NewInvoiceDialog({
  contractId,
  onClose,
  onCreated,
}: {
  contractId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations('contracts.detail');
  const tc = useTranslations('common');

  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = Number(amount.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) return setError(t('newInvoice.amountError'));
    if (!dueDate) return setError(t('newInvoice.dueDateError'));

    setSubmitting(true);
    try {
      await contractInvoicesApi.create(contractId, {
        amount: value,
        dueDate,
        reference: reference.trim() || undefined,
      });
      toast.success(t('newInvoice.createdToast'));
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t('newInvoice.title')}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label required>{t('newInvoice.amountLabel')}</Label>
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
            />
          </div>
          <div>
            <Label required>{t('newInvoice.dueDateLabel')}</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <div>
          <Label>{t('newInvoice.referenceLabel')}</Label>
          <Input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={120}
            placeholder={t('newInvoice.referencePlaceholder')}
          />
        </div>

        {error && <FieldError>{error}</FieldError>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={submitting}>
            {t('newInvoice.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

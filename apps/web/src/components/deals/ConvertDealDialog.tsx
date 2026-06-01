'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { NewContractInline } from '@/components/contracts/NewContractInline';
import { CustomerForm } from '@/components/crm/CustomerForm';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/sonner';
import { ApiError, api } from '@/lib/api';
import { dealsApi } from '@/lib/crm-sales-api';
import type { Deal } from '@/lib/crm-sales-types';
import type { Customer } from '@/lib/crm-types';

type Step = 'customer' | 'contract';

/**
 * ConvertDealDialog — fluxo de conversão de um deal em cliente + contrato.
 *
 * Decisões de UX:
 *   - Se o deal já tem cliente vinculado, pulamos o passo 1 e vamos direto
 *     para o contrato.
 *   - Senão, passo 1 é o `CustomerForm` em modo `create`. Após salvar, o
 *     `customerId` é fixado e seguimos para o passo de contrato.
 *   - Ao criar o contrato, marcamos o deal como WON com nota referenciando
 *     o contractId — fica o trilho de auditoria entre venda e contrato.
 *   - Em qualquer ponto o usuário pode cancelar; o que já foi criado fica
 *     persistido (cliente sem contrato é um estado válido). Mostramos um
 *     aviso quando isso acontece.
 */
export function ConvertDealDialog({
  open,
  onOpenChange,
  deal,
  onConverted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  deal: Deal;
  /** Chamado depois que o deal é marcado como WON. */
  onConverted: () => void;
}) {
  const t = useTranslations('dealsComponents');
  const tc = useTranslations('common');
  const initialStep: Step = deal.customerId ? 'contract' : 'customer';
  const [step, setStep] = useState<Step>(initialStep);
  const [customerId, setCustomerId] = useState<string | null>(deal.customerId);
  const [customerName, setCustomerName] = useState<string | null>(
    deal.customer?.displayName ?? null,
  );

  // Reset ao abrir/fechar.
  useEffect(() => {
    if (open) {
      setStep(deal.customerId ? 'contract' : 'customer');
      setCustomerId(deal.customerId);
      setCustomerName(deal.customer?.displayName ?? null);
    }
  }, [open, deal.customerId, deal.customer?.displayName]);

  async function handleCustomerSubmit(payload: Record<string, unknown>) {
    // Pré-preenche shortNote com referência ao deal (ajuda no rastreio).
    const body = { ...payload };
    if (!body.shortNote) {
      body.shortNote = t('convert.customerShortNote', { title: deal.title });
    }
    const created = await api.post<Customer>('/v1/customers', body);
    setCustomerId(created.id);
    setCustomerName(created.displayName);

    // Vincula o cliente ao deal (PATCH).
    try {
      await dealsApi.update(deal.id, { customerId: created.id });
    } catch (err) {
      // Não bloqueia o fluxo: o cliente já existe; o vínculo pode ser feito depois.
      const msg =
        err instanceof ApiError
          ? err.friendlyMessage
          : t('convert.linkFailed');
      toast.error(msg);
    }

    toast.success(t('convert.customerCreated'));
    setStep('contract');
  }

  async function handleContractCreated(contract: { id: string; code: string | null }) {
    // Fecha o deal como WON com nota referenciando o contractId.
    try {
      const note = contract.code
        ? t('convert.contractNoteWithCode', { code: contract.code, id: contract.id })
        : t('convert.contractNote', { id: contract.id });
      await dealsApi.win(deal.id, { note });
      toast.success(t('convert.dealConverted'));
      onConverted();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.friendlyMessage
          : t('convert.winFailed');
      toast.error(msg);
      // Mesmo assim segue o fluxo de fechamento — o contrato existe.
      onConverted();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
       <div className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>{t('convert.title')}</DialogTitle>
            <Badge tone={step === 'customer' ? 'info' : 'success'}>
              {step === 'customer' ? t('convert.stepCustomer') : t('convert.stepContract')}
            </Badge>
          </div>
          <DialogDescription>
            {t('convert.dealLabel')}{' '}
            <span className="font-medium text-text">{deal.title}</span>
            {customerName && (
              <>
                {` · ${t('convert.customerLabel')} `}
                <span className="font-medium text-text">{customerName}</span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {step === 'customer' && (
            <>
              <p className="mb-4 text-xs text-text-muted">
                {t('convert.customerStepHint')}
              </p>
              <CustomerForm
                mode="create"
                onSubmit={handleCustomerSubmit}
                onCancel={() => onOpenChange(false)}
              />
            </>
          )}

          {step === 'contract' && customerId && (
            <NewContractInline
              lockedCustomerId={customerId}
              initial={{
                monthlyValue: deal.value && deal.value > 0 ? deal.value : '',
              }}
              submitLabel={t('convert.contractSubmit')}
              onCreated={handleContractCreated}
              onCancel={() => onOpenChange(false)}
            />
          )}
        </DialogBody>

        {step === 'contract' && customerId && !deal.customerId && (
          <div className="mx-5 mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            {t('convert.customerSavedWarning')}
          </div>
        )}

        {step === 'customer' && (
          <div className="mx-5 mb-4 flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {t('convert.cancelConversion')}
            </Button>
          </div>
        )}
       </div>
      </DialogContent>
    </Dialog>
  );
}

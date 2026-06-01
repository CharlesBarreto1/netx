'use client';

/**
 * NewInstallOrderInline — passo 3 do wizard de novo cliente.
 *
 * Cria uma Ordem de Serviço de instalação vinculada ao contrato recém-criado.
 * O motivo é fixado em "Instalação" (ServiceOrderReason com isInstallation=true,
 * seedado como padrão do sistema). O técnico/agendamento são opcionais — podem
 * ser ajustados depois no detalhe da O.S.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { FieldHelp, Input, Label, Textarea } from '@/components/ui/Input';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import type { Contract } from '@/lib/contracts-api';
import {
  serviceOrdersApi,
  serviceOrderReasonsApi,
  type ServiceOrderReasonResponse,
  type ServiceOrderResponse,
} from '@/lib/service-orders-api';

interface Props {
  contract: Contract;
  onCreated: (os: ServiceOrderResponse) => void;
  onSkip: () => void;
}

export function NewInstallOrderInline({ contract, onCreated, onSkip }: Props) {
  const t = useTranslations('contractCards');
  const tc = useTranslations('common');
  // Carrega os motivos pra achar o de instalação (isInstallation=true).
  const { data: reasons, isLoading: loadingReasons } = useSWR<
    ServiceOrderReasonResponse[]
  >(serviceOrderReasonsApi.path(), () => serviceOrderReasonsApi.list());

  const installReason = (reasons ?? []).find((r) => r.isInstallation && r.isActive);

  const [description, setDescription] = useState(
    t('installOrder.defaultDescription', { address: contract.installationAddress }),
  );
  const [scheduledAt, setScheduledAt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate() {
    if (!installReason) return;
    setSubmitting(true);
    try {
      const os = await serviceOrdersApi.create({
        contractId: contract.id,
        reasonId: installReason.id,
        openDescription: description.trim() || t('installOrder.fallbackDescription'),
        // datetime-local não tem timezone — converte pra ISO com offset local.
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      });
      toast.success(t('installOrder.createdToast'));
      onCreated(os);
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(t('installOrder.createFailed', { error: msg }));
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingReasons) {
    return <p className="text-sm text-text-muted">{t('installOrder.loadingReasons')}</p>;
  }

  // Seed não rodou / motivo de instalação não existe — não trava o wizard.
  if (!installReason) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          ⚠️{' '}
          {t.rich('installOrder.noReason', {
            code: (chunks) => <code>{chunks}</code>,
          })}
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onSkip}>
            {t('installOrder.skip')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
        {t.rich('installOrder.contractCreatedBanner', {
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
      </div>

      <div>
        <Label>{t('installOrder.reason')}</Label>
        <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-text">
          {installReason.name}
          <span className="ml-2 rounded bg-accent-muted px-1.5 py-0.5 text-2xs uppercase tracking-wide text-accent">
            {t('installOrder.installationTag')}
          </span>
        </div>
        <FieldHelp>
          {t('installOrder.reasonHelp')}
        </FieldHelp>
      </div>

      <div>
        <Label htmlFor="os-description" required>
          {tc('description')}
        </Label>
        <Textarea
          id="os-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
      </div>

      <div>
        <Label htmlFor="os-scheduledAt">{t('installOrder.scheduling')}</Label>
        <Input
          id="os-scheduledAt"
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          className="sm:max-w-xs"
        />
        <FieldHelp>
          {t('installOrder.schedulingHelp')}
        </FieldHelp>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        <Button variant="outline" onClick={onSkip} disabled={submitting}>
          {t('installOrder.skip')}
        </Button>
        <Button onClick={handleCreate} loading={submitting}>
          {t('installOrder.createAndFinish')}
        </Button>
      </div>
    </div>
  );
}

'use client';

/**
 * Desfazer instalação — volta o contrato pra PENDING_INSTALL (sem cancelar).
 * Pede o local onde o comodato (ONT) deve voltar. Reusa o endpoint
 * /provisioning/contracts/:id/deactivate.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FieldError, Label, Select } from '@/components/ui/Input';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { provisioningApi } from '@/lib/provisioning-api';
import { stockApi, type StockLocation } from '@/lib/stock-api';

export function DeactivateInstallDialog({
  contractId,
  onClose,
  onDone,
}: {
  contractId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('contracts.detail');
  const tc = useTranslations('common');
  const { data: locations } = useSWR<StockLocation[]>(
    stockApi.locationsPath({ isActive: true }),
    () => stockApi.listLocations({ isActive: true }),
  );

  const [returnLocationId, setReturnLocationId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!returnLocationId) {
      setError(t('undoInstallNeedLocation'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await provisioningApi.deactivateInstall(contractId, returnLocationId);
      toast.success(t('undoInstallDone'));
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={submitting ? () => {} : onClose}
      title={t('undoInstall')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {tc('cancel')}
          </Button>
          <Button variant="danger" onClick={submit} loading={submitting}>
            {t('undoInstall')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {t('undoInstallHelp')}
        </div>
        <div>
          <Label required>{t('undoInstallLocation')}</Label>
          <Select
            value={returnLocationId}
            onChange={(e) => setReturnLocationId(e.target.value)}
          >
            <option value="">—</option>
            {locations?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} — {l.name}
              </option>
            ))}
          </Select>
        </div>
        {error && <FieldError>{error}</FieldError>}
      </div>
    </Modal>
  );
}

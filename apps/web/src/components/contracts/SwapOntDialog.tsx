'use client';

/**
 * Diálogo de troca de ONT (administrativo — sem abrir O.S de campo).
 *
 * Chama POST /v1/provisioning/contracts/:id/swap-ont, que reusa o swapOnt do
 * backend: devolve a ONT antiga ao estoque, provisiona a nova e re-cadastra
 * device + Wi-Fi no TR-069. É o caminho CORRETO de troca — a devolução avulsa
 * pelo card de comodato é bloqueada de propósito (deixaria o TR-069 órfão).
 *
 * Permissão: provisioning.write (mesma do install em campo).
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FieldError, FieldHelp, Input, Label, Select } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import { provisioningApi, type OntSwapRequest } from '@/lib/provisioning-api';
import {
  stockApi,
  type ComodatoAvailableSerial,
  type StockLocation,
} from '@/lib/stock-api';

export function SwapOntDialog({
  contractId,
  onClose,
  onDone,
}: {
  contractId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('contractCards');
  const tc = useTranslations('common');

  const { data: available, isLoading: loadingAvail } = useSWR<ComodatoAvailableSerial[]>(
    '/v1/stock/comodato/available',
    () => stockApi.listComodatoAvailable(),
  );
  const { data: locations } = useSWR<StockLocation[]>(
    stockApi.locationsPath({ isActive: true }),
    () => stockApi.listLocations({ isActive: true }),
  );

  const [useManual, setUseManual] = useState(false);
  const [serialItemId, setSerialItemId] = useState('');
  const [snGpon, setSnGpon] = useState('');
  const [returnLocationId, setReturnLocationId] = useState('');
  const [wifiBandMode, setWifiBandMode] = useState<'BAND_STEERING' | 'DUAL_BAND'>(
    'BAND_STEERING',
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (useManual ? !snGpon.trim() : !serialItemId)
      return setError(t('swapOnt.selectEquipmentError'));
    if (!returnLocationId) return setError(t('swapOnt.selectLocationError'));

    const body: OntSwapRequest = {
      returnLocationId,
      // Wi-Fi herda do contrato (definido no cadastro) — não pede aqui.
      wifiBandMode,
      ...(useManual
        ? { newSnGpon: snGpon.trim(), allowStockBypass: true }
        : { newSerialItemId: serialItemId }),
    };
    setSubmitting(true);
    try {
      const r = await provisioningApi.swapOnt(contractId, body);
      if (r.status === 'FAILED') {
        setError(t('swapOnt.failed'));
        return;
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : t('swapOnt.error'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t('swapOnt.title')}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {t('swapOnt.intro')}
        </div>

        {/* Fonte da ONT nova: estoque (normal) ou serial manual (bypass) */}
        <div className="flex items-center justify-between">
          <Label className="!mb-0">{t('swapOnt.newEquipment')}</Label>
          <button
            type="button"
            className="text-xs text-brand-500 hover:underline"
            onClick={() => {
              setUseManual((v) => !v);
              setError(null);
            }}
          >
            {useManual ? t('swapOnt.useStock') : t('swapOnt.useManual')}
          </button>
        </div>

        {!useManual && (
          <div>
            {loadingAvail && <Spinner />}
            {available && available.length === 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                {t('swapOnt.noneAvailable')}
              </div>
            )}
            {available && available.length > 0 && (
              <Select
                value={serialItemId}
                onChange={(e) => setSerialItemId(e.target.value)}
              >
                <option value="">—</option>
                {available.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.product.sku} · {s.product.name} — SN: {s.serial} ({s.location.code})
                  </option>
                ))}
              </Select>
            )}
          </div>
        )}

        {useManual && (
          <div>
            <Input
              value={snGpon}
              onChange={(e) => setSnGpon(e.target.value)}
              placeholder={t('swapOnt.snGponPlaceholder')}
              maxLength={64}
            />
            <FieldHelp>{t('swapOnt.bypassWarning')}</FieldHelp>
          </div>
        )}

        {/* Local de devolução da ONT antiga */}
        <div>
          <Label required>{t('swapOnt.returnLocation')}</Label>
          <Select
            value={returnLocationId}
            onChange={(e) => setReturnLocationId(e.target.value)}
            required
          >
            <option value="">—</option>
            {locations?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} — {l.name}
              </option>
            ))}
          </Select>
        </div>

        {/* Wi-Fi herda do contrato — não pede nome/senha aqui. */}
        <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {t('swapOnt.wifiFromContract')}
        </p>

        <div>
          <Label>{t('swapOnt.bandMode')}</Label>
          <Select
            value={wifiBandMode}
            onChange={(e) =>
              setWifiBandMode(e.target.value as 'BAND_STEERING' | 'DUAL_BAND')
            }
          >
            <option value="BAND_STEERING">{t('swapOnt.bandSteering')}</option>
            <option value="DUAL_BAND">{t('swapOnt.dualBand')}</option>
          </Select>
        </div>

        {error && <FieldError>{error}</FieldError>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={submitting}>
            {t('swapOnt.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

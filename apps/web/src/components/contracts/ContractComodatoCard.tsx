'use client';

/**
 * Card de equipamentos em comodato no contrato.
 *
 * Mostra os SerialItems atualmente ALOCADOS nesse contrato + ações pra alocar
 * novo equipamento ou devolver um existente.
 *
 * Visibilidade: respeita `stock.read`. Botões de alocar/devolver respeitam
 * `stock.write` (e a ACL de local é checada no backend).
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FieldError, Input, Label, Textarea } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  stockApi,
  type ComodatoAvailableSerial,
  type ComodatoSerial,
  type StockLocation,
} from '@/lib/stock-api';

export function ContractComodatoCard({ contractId }: { contractId: string }) {
  const t = useTranslations('contractCards');
  const tc = useTranslations('common');
  const { data, isLoading, error, mutate } = useSWR<ComodatoSerial[]>(
    stockApi.comodatoByContractPath(contractId),
    () => stockApi.listComodatoByContract(contractId),
  );

  const canWrite = hasPermission('stock.write');

  const [allocating, setAllocating] = useState(false);
  const [returning, setReturning] = useState<ComodatoSerial | null>(null);

  if (!hasPermission('stock.read')) return null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-text-muted">
          {t('comodato.intro')}
        </div>
        {canWrite && (
          <Button size="sm" onClick={() => setAllocating(true)}>
            {t('comodato.addEquipment')}
          </Button>
        )}
      </div>

      {isLoading && <Spinner />}
      {error && (
        <div className="text-sm text-red-600">{t('comodato.loadError')}</div>
      )}

      {data && data.length === 0 && (
        <p className="text-sm text-text-muted italic">
          {t('comodato.empty')}
        </p>
      )}

      {data && data.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-bg-soft">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                <th className="px-3 py-2">{t('comodato.product')}</th>
                <th className="px-3 py-2">{t('comodato.serial')}</th>
                <th className="px-3 py-2">{t('comodato.allocatedAt')}</th>
                {canWrite && <th className="px-3 py-2 text-right">{tc('actions')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((s) => (
                <tr key={s.id} className="hover:bg-bg-soft">
                  <td className="px-3 py-2">
                    <strong>{s.product.name}</strong>
                    {(s.product.brand || s.product.model) && (
                      <p className="text-xs text-text-muted">
                        {[s.product.brand, s.product.model]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                    <p className="text-xs text-text-muted font-mono">
                      SKU: {s.product.sku}
                    </p>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{s.serial}</td>
                  <td className="px-3 py-2 text-xs text-text-muted">
                    {s.allocatedAt
                      ? new Date(s.allocatedAt).toLocaleString()
                      : '—'}
                  </td>
                  {canWrite && (
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setReturning(s)}
                      >
                        {t('comodato.return')}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {allocating && (
        <AllocateModal
          contractId={contractId}
          onClose={() => setAllocating(false)}
          onSaved={async () => {
            setAllocating(false);
            await mutate();
          }}
        />
      )}

      {returning && (
        <ReturnModal
          serial={returning}
          onClose={() => setReturning(null)}
          onSaved={async () => {
            setReturning(null);
            await mutate();
          }}
        />
      )}
    </div>
  );
}

// =============================================================================
// ALLOCATE — escolhe serial disponível
// =============================================================================
function AllocateModal({
  contractId,
  onClose,
  onSaved,
}: {
  contractId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('contractCards');
  const tc = useTranslations('common');
  const { data: available, isLoading } = useSWR<ComodatoAvailableSerial[]>(
    '/v1/stock/comodato/available',
    () => stockApi.listComodatoAvailable(),
  );

  const [serialItemId, setSerialItemId] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!serialItemId) return setError(t('comodato.selectEquipmentError'));
    setSubmitting(true);
    try {
      await stockApi.allocateComodato({
        contractId,
        serialItemId,
        notes: notes || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : t('comodato.allocateError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t('comodato.allocateTitle')}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {isLoading && <Spinner />}

        {available && available.length === 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {t('comodato.noneAvailable')}
          </div>
        )}

        {available && available.length > 0 && (
          <div>
            <Label>{t('comodato.equipmentRequired')}</Label>
            <select
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={serialItemId}
              onChange={(e) => setSerialItemId(e.target.value)}
              required
            >
              <option value="">—</option>
              {available.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.product.sku} · {s.product.name} — SN: {s.serial} ({s.location.code})
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <Label>{tc('notes')}</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('comodato.allocateNotesPlaceholder')}
          />
        </div>

        {error && <FieldError>{error}</FieldError>}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
          >
            {tc('cancel')}
          </Button>
          <Button
            type="submit"
            loading={submitting}
            disabled={!serialItemId}
          >
            {t('comodato.allocate')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// =============================================================================
// RETURN — escolhe local destino
// =============================================================================
function ReturnModal({
  serial,
  onClose,
  onSaved,
}: {
  serial: ComodatoSerial;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('contractCards');
  const tc = useTranslations('common');
  const { data: locations } = useSWR<StockLocation[]>(
    stockApi.locationsPath({ isActive: true }),
    () => stockApi.listLocations({ isActive: true }),
  );

  const [toLocationId, setToLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!toLocationId) return setError(t('comodato.selectLocationError'));
    setSubmitting(true);
    try {
      await stockApi.returnComodato({
        serialItemId: serial.id,
        toLocationId,
        notes: notes || null,
      });
      onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.friendlyMessage : t('comodato.returnError'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t('comodato.returnTitle')}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="rounded-md bg-bg-soft p-3 text-sm">
          <div>
            <strong>{serial.product.name}</strong>
          </div>
          <div className="text-xs text-text-muted">
            SKU: {serial.product.sku} · {t('comodato.serial')}:{' '}
            <span className="font-mono">{serial.serial}</span>
          </div>
        </div>

        <div>
          <Label>{t('comodato.destinationRequired')}</Label>
          <select
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            value={toLocationId}
            onChange={(e) => setToLocationId(e.target.value)}
            required
          >
            <option value="">—</option>
            {locations?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} — {l.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label>{tc('notes')}</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('comodato.returnNotesPlaceholder')}
          />
        </div>

        {error && <FieldError>{error}</FieldError>}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
          >
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={submitting} disabled={!toLocationId}>
            {t('comodato.return')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

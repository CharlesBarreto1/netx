'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import {
  SubscriberPortPicker,
  type SubscriberPortSelection,
} from '@/components/fibermap/SubscriberPortPicker';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { fibermapApi, type FibermapContractPortRef } from '@/lib/fibermap-api';
import { hasPermission } from '@/lib/session';

/**
 * ContractFibermapPortCard — vínculo físico do contrato com a planta
 * (contracts.fibermap_port_id, spec §11). Mostra "CTO · porta N" resolvido
 * via GET /v1/fibermap/contracts/:id/port e oferece:
 *   [Trocar porta] — abre o SubscriberPortPicker num modal e chama
 *                    assign-contract com a porta escolhida;
 *   [Liberar]      — release-port com confirmação.
 *
 * NÃO confundir com o UfinetStatusPanel: lá o ctoPort é o valor persistido
 * que foi enviado à Ufinet; aqui é a fonte de verdade do FiberMap.
 */
export function ContractFibermapPortCard({
  contractId,
  nearLat,
  nearLng,
}: {
  contractId: string;
  nearLat?: number | null;
  nearLng?: number | null;
}) {
  const t = useTranslations('fibermap.contractPort');
  const tPicker = useTranslations('fibermap.portPicker');
  const canRead = hasPermission('fibermap.read');
  const canWrite = hasPermission('contracts.write');

  const key = canRead ? fibermapApi.contractPortPath(contractId) : null;
  const { data: ref, isLoading, mutate } = useSWR<FibermapContractPortRef | null>(key);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!canRead) return null;

  async function doAssign(sel: SubscriberPortSelection) {
    setBusy(true);
    try {
      await fibermapApi.assignPortToContract(sel.portId, contractId);
      toast.success(t('assignedToast'));
      setPickerOpen(false);
      await mutate();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(t('assignFailed', { error: msg }));
    } finally {
      setBusy(false);
    }
  }

  async function doRelease() {
    setBusy(true);
    try {
      await fibermapApi.releaseContractPort(contractId);
      toast.success(t('releasedToast'));
      setReleaseOpen(false);
      await mutate();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          {t('title')}
        </h3>
        {canWrite && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setPickerOpen(true)}
            >
              {ref ? t('change') : t('link')}
            </Button>
            {ref && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                className="text-danger"
                onClick={() => setReleaseOpen(true)}
              >
                {t('release')}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 text-sm">
        {isLoading && !ref ? (
          <p className="text-xs text-text-muted">…</p>
        ) : ref ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-border bg-surface-muted px-2.5 py-1 text-xs font-medium text-text">
              {tPicker('chip', { cto: ref.elementName, port: ref.portNumber })}
            </span>
            <span className="text-xs text-text-muted">
              {ref.deviceName}
              {ref.label ? ` · ${ref.label}` : ''}
            </span>
          </div>
        ) : (
          <p className="text-xs text-text-muted">{t('none')}</p>
        )}
      </div>

      {/* Trocar/vincular porta — o picker devolve a seleção e o assign roda aqui. */}
      <Modal
        open={pickerOpen}
        onClose={() => {
          if (!busy) setPickerOpen(false);
        }}
        title={t('modalTitle')}
        size="lg"
      >
        <SubscriberPortPicker
          value={null}
          onChange={(sel) => {
            if (sel) void doAssign(sel);
          }}
          nearLat={nearLat}
          nearLng={nearLng}
          disabled={busy}
        />
      </Modal>

      {/* Liberar porta — confirmação (retirada/cancelamento manual). */}
      <ConfirmDialog
        open={releaseOpen}
        onClose={() => setReleaseOpen(false)}
        onConfirm={doRelease}
        title={t('releaseTitle')}
        message={t('releaseMessage', {
          cto: ref?.elementName ?? '—',
          port: ref?.portNumber ?? 0,
        })}
        confirmLabel={t('release')}
        variant="danger"
        loading={busy}
      />
    </div>
  );
}

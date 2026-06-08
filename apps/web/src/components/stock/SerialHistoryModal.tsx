'use client';

/**
 * Histórico (timeline) de um equipamento patrimonial. Lê o kardex via
 * /v1/stock/serial-items/:id/history e renderiza cada evento (compra,
 * transferência, comodato, retorno, ajuste, baixa) com data e usuário.
 *
 * Reutilizável: chamado ao clicar num serial nas telas de Patrimônios e
 * Relatório.
 */
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Modal } from '@/components/ui/Modal';
import { InlineLoader } from '@/components/ui/Spinner';
import { formatDateTime } from '@/lib/format';
import { stockApi, type SerialHistory, type SerialHistoryEvent } from '@/lib/stock-api';

export function SerialHistoryModal({
  serialItemId,
  onClose,
}: {
  serialItemId: string;
  onClose: () => void;
}) {
  const t = useTranslations('stock.history');
  const { data, isLoading } = useSWR<SerialHistory>(
    stockApi.serialHistoryPath(serialItemId),
    () => stockApi.serialHistory(serialItemId),
  );

  return (
    <Modal open onClose={onClose} title={t('title')}>
      {isLoading || !data ? (
        <InlineLoader label={t('loading')} />
      ) : (
        <div className="space-y-4">
          <div className="rounded-md border border-border bg-surface-muted p-3 text-sm">
            <div className="font-mono font-medium">{data.serial}</div>
            <div className="text-xs text-text-muted">
              {data.product.name} · {data.product.sku}
            </div>
          </div>

          {data.events.length === 0 ? (
            <p className="py-4 text-center text-sm text-text-muted">{t('empty')}</p>
          ) : (
            <ol className="relative space-y-4 border-l border-border pl-4">
              {data.events.map((ev) => (
                <li key={ev.id} className="relative">
                  <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-brand-500" />
                  <div className="text-sm font-medium text-text">{describe(ev, t)}</div>
                  <div className="text-xs text-text-muted">
                    {formatDateTime(ev.date)}
                    {ev.user ? ` · ${t('by', { user: ev.user })}` : ''}
                  </div>
                  {ev.notes && (
                    <div className="mt-0.5 text-xs italic text-text-muted">{ev.notes}</div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Modal>
  );
}

type TFn = ReturnType<typeof useTranslations>;

/** Monta a frase do evento com os dados disponíveis. */
function describe(ev: SerialHistoryEvent, t: TFn): string {
  switch (ev.type) {
    case 'PURCHASE': {
      const parts = [t('event.purchase')];
      if (ev.supplier) parts.push(t('fromSupplier', { supplier: ev.supplier }));
      if (ev.invoiceNumber) parts.push(t('invoice', { nf: ev.invoiceNumber }));
      if (ev.toLocation) parts.push(t('atLocation', { location: ev.toLocation }));
      return parts.join(' · ');
    }
    case 'TRANSFER':
      return t('event.transfer', {
        from: ev.fromLocation ?? '—',
        to: ev.toLocation ?? '—',
      });
    case 'COMODATO_OUT':
      return t('event.comodatoOut', {
        customer: ev.customerName ?? '—',
        contract: ev.contractCode ?? '—',
      });
    case 'COMODATO_RETURN':
      return t('event.comodatoReturn', { location: ev.toLocation ?? '—' });
    case 'ADJUSTMENT_IN':
      return t('event.adjustmentIn', { location: ev.toLocation ?? '—' });
    case 'ADJUSTMENT_OUT':
      return t('event.adjustmentOut');
    case 'SALE':
      return t('event.sale');
    case 'PURCHASE_RETURN':
      return t('event.purchaseReturn', { supplier: ev.supplier ?? '—' });
    case 'SALE_RETURN':
      return t('event.saleReturn');
    case 'OS_CONSUMPTION':
      return t('event.osConsumption');
    default:
      return ev.type;
  }
}

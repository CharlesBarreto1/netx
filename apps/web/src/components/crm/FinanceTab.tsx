'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import useSWR from 'swr';

import { DiscountDialog } from '@/components/finance/DiscountDialog';
import { EfiChargeDialog } from '@/components/finance/EfiChargeDialog';
import { NewChargeDialog } from '@/components/finance/NewChargeDialog';
import { PaymentDialog } from '@/components/finance/PaymentDialog';
import { PostponeDialog } from '@/components/finance/PostponeDialog';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { InlineLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import {
  contractInvoicesApi,
  contractsApi,
  type Contract,
  type ContractInvoice,
  type InvoiceStatus,
} from '@/lib/contracts-api';
import type { Paginated } from '@/lib/crm-types';
import { formatDate } from '@/lib/format';
import { useFormatMoney } from '@/lib/use-money';
import { hasPermission } from '@/lib/session';

/**
 * FinanceTab — financeiro consolidado do cliente.
 *
 * - Lista todas as faturas (de todos os contratos do cliente) ordenadas por
 *   vencimento desc.
 * - Mostra "cards" no topo com totais: aberto, em atraso e total recebido.
 * - Cada linha tem botões: "Baixar fatura" (abre /invoices/[id]/print numa
 *   nova aba e dispara print → salvar como PDF) e, se OPEN/OVERDUE, "Dar baixa"
 *   (PATCH PAID).
 *
 * Por que não há boleto/PIX aqui ainda: a integração com Asaas (Sprint S8–S10)
 * vai fornecer o PDF do boleto + QR PIX. Até lá, o "Baixar" gera um
 * demonstrativo a partir dos próprios dados, suficiente pra envio ao cliente.
 */
const STATUS_TONE: Record<InvoiceStatus, 'info' | 'success' | 'warning' | 'danger'> = {
  OPEN: 'info',
  PAID: 'success',
  OVERDUE: 'danger',
  CANCELLED: 'warning',
};

export function FinanceTab({ customerId }: { customerId: string }) {
  const canWrite = hasPermission('contracts.write');
  const formatMoney = useFormatMoney();
  const tFinance = useTranslations('finance');
  const tCommon = useTranslations('common');
  const t = useTranslations('crmTabs');
  // Status do invoice traduzido vem do dict via key.
  const statusLabel = (s: InvoiceStatus): string =>
    tFinance(`invoice.status.${s}` as 'invoice.status.OPEN');

  // Faturas do cliente. O backend aceita customerId direto em ListContractInvoicesQuery.
  const invoicesKey = contractInvoicesApi.listPath({
    customerId,
    pageSize: 200,
    sortBy: 'dueDate',
    sortDir: 'desc',
  });
  const {
    data: invoicesResp,
    isLoading,
    error,
    mutate,
  } = useSWR<Paginated<ContractInvoice>>(invoicesKey);

  // Carrega contratos do cliente em paralelo só para mostrar o "código do contrato"
  // bonitinho na tabela. Pequeno (até 100 contratos), zero custo perceptível.
  const { data: contractsResp } = useSWR<Paginated<Contract>>(
    contractsApi.listPath({ customerId, pageSize: 100 }),
  );
  const contractById = new Map<string, Contract>(
    (contractsResp?.data ?? []).map((c) => [c.id, c]),
  );

  // Estado de "dar baixa"
  const [paying, setPaying] = useState<ContractInvoice | null>(null);
  const [discounting, setDiscounting] = useState<ContractInvoice | null>(null);
  const [postponing, setPostponing] = useState<ContractInvoice | null>(null);
  const [efiCharging, setEfiCharging] = useState<ContractInvoice | null>(null);
  const [newChargeOpen, setNewChargeOpen] = useState(false);
  const canCreateCharge = hasPermission('finance.charges.write');
  const canDiscount = hasPermission('finance.discount.apply');
  const canEfiCharge = hasPermission('efi.charges.write');

  if (isLoading && !invoicesResp) {
    return <InlineLoader label={t('finance.loading')} />;
  }
  if (error) {
    return (
      <p className="text-sm text-red-600">{t('finance.loadError')}</p>
    );
  }

  const invoices = invoicesResp?.data ?? [];

  // Totais
  const open = invoices
    .filter((i) => i.status === 'OPEN')
    .reduce((s, i) => s + i.amount, 0);
  const overdue = invoices
    .filter((i) => i.status === 'OVERDUE')
    .reduce((s, i) => s + i.amount, 0);
  const paidTotal = invoices
    .filter((i) => i.status === 'PAID')
    .reduce((s, i) => s + (i.paidAmount ?? i.amount), 0);

  // handlePay foi substituído pelo PaymentDialog (que recebe input
  // estruturado com cashRegisterId/discount/method).

  return (
    <div className="flex flex-col gap-4">
      {/* Header com ação rápida — princípio "hub do atendente": ação de
          cobrança avulsa fica AQUI, sem precisar ir pra /finance/charges. */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">
          {t('finance.title')}
        </h3>
        {canCreateCharge && (
          <Button size="sm" onClick={() => setNewChargeOpen(true)}>
            {t('finance.newCharge')}
          </Button>
        )}
      </div>

      {/* Totais */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <SummaryCard
          label={tFinance('summary.open')}
          value={formatMoney(open)}
          tone="info"
        />
        <SummaryCard
          label={tFinance('summary.overdue')}
          value={formatMoney(overdue)}
          tone={overdue > 0 ? 'danger' : 'neutral'}
        />
        <SummaryCard
          label={tFinance('summary.paidTotal')}
          value={formatMoney(paidTotal)}
          tone="success"
        />
      </div>

      {invoices.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {t('finance.empty')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">{t('finance.dueDate')}</th>
                <th className="px-3 py-2">{t('finance.contract')}</th>
                <th className="px-3 py-2">{t('finance.reference')}</th>
                <th className="px-3 py-2 text-right">{t('finance.amount')}</th>
                <th className="px-3 py-2">{tCommon('status')}</th>
                <th className="px-3 py-2 text-right">{tCommon('actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {invoices.map((inv) => {
                const c = contractById.get(inv.contractId);
                const canPay = inv.status === 'OPEN' || inv.status === 'OVERDUE';
                return (
                  <tr key={inv.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                    <td className="px-3 py-2">{formatDate(inv.dueDate)}</td>
                    <td className="px-3 py-2">
                      {c ? (
                        <Link
                          href={`/contracts/${c.id}`}
                          className="text-brand-600 hover:underline dark:text-brand-300"
                        >
                          {c.code ?? `#${c.id.slice(0, 8)}`}
                        </Link>
                      ) : (
                        <span className="text-2xs text-slate-500">
                          {inv.contractId.slice(0, 8)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                      {inv.reference ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMoney(inv.amount)}
                      {inv.discountAmount != null && inv.discountAmount > 0 && inv.status !== 'PAID' && (
                        <div className="text-2xs text-amber-700 dark:text-amber-400">
                          {t('finance.discountShort')}: -{formatMoney(inv.discountAmount)}
                        </div>
                      )}
                      {inv.status === 'PAID' &&
                        inv.paidAmount != null &&
                        inv.paidAmount !== inv.amount && (
                          <div className="text-2xs text-emerald-700">
                            {t('finance.paidShort')}: {formatMoney(inv.paidAmount)}
                          </div>
                        )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS_TONE[inv.status]}>{statusLabel(inv.status)}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2">
                        {canPay && canWrite && (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setPostponing(inv)}
                            title={t('finance.postponeTitle')}
                          >
                            {t('finance.postpone')}
                          </Button>
                        )}
                        {canPay && canDiscount && (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setDiscounting(inv)}
                            title={t('finance.discountTitle')}
                          >
                            {t('finance.discount')}
                          </Button>
                        )}
                        {canPay && canEfiCharge && (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setEfiCharging(inv)}
                            title={t('finance.efiTitle')}
                          >
                            Pix/Boleto
                          </Button>
                        )}
                        {canPay && canWrite && (
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => setPaying(inv)}
                          >
                            {tFinance('invoice.payAction')}
                          </Button>
                        )}
                        <Link
                          href={`/invoices/${inv.id}/print`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button variant="ghost" size="xs">
                            {tFinance('invoice.downloadAction')}
                          </Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {paying && (
        <PaymentDialog
          open
          onOpenChange={(v) => !v && setPaying(null)}
          amount={paying.amount}
          description={`${paying.reference ?? ''} · ${formatDate(paying.dueDate)}`}
          initialDiscount={paying.discountAmount ?? null}
          onConfirm={async (input) => {
            const invId = paying.id;
            await contractInvoicesApi.pay(invId, input);
            toast.success(tCommon('success'));
            await mutate();
            // Abre recibo em nova aba — auto-print configurado lá dentro.
            // Operador pode fechar a aba se não quiser imprimir.
            window.open(`/receipts/invoice/${invId}`, '_blank');
          }}
        />
      )}

      {discounting && (
        <DiscountDialog
          open
          onOpenChange={(v) => !v && setDiscounting(null)}
          amount={discounting.amount}
          currentDiscount={discounting.discountAmount ?? null}
          description={`${discounting.reference ?? ''} · ${formatDate(discounting.dueDate)}`}
          onConfirm={async (discount, note) => {
            await contractInvoicesApi.applyDiscount(discounting.id, discount, note);
            toast.success(tCommon('success'));
            await mutate();
          }}
        />
      )}

      {postponing && (
        <PostponeDialog
          open
          onOpenChange={(v) => !v && setPostponing(null)}
          currentDueDate={postponing.dueDate}
          description={`${postponing.reference ?? ''} · ${formatMoney(postponing.amount)}`}
          onConfirm={async (newDate, note) => {
            await contractInvoicesApi.postpone(postponing.id, newDate, note);
            toast.success(tCommon('success'));
            await mutate();
          }}
        />
      )}

      {efiCharging && (
        <EfiChargeDialog
          open
          onOpenChange={(v) => !v && setEfiCharging(null)}
          invoiceId={efiCharging.id}
          amount={efiCharging.amount}
          description={`${efiCharging.reference ?? ''} · ${formatDate(efiCharging.dueDate)}`}
          onGenerated={() => void mutate()}
        />
      )}

      <NewChargeDialog
        customerId={customerId}
        open={newChargeOpen}
        onClose={() => setNewChargeOpen(false)}
        onCreated={() => void mutate()}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
}) {
  const toneClass: Record<typeof tone, string> = {
    info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200',
    success:
      'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200',
    warning:
      'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200',
    danger:
      'border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200',
    neutral:
      'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-200',
  };
  return (
    <div className={`rounded-lg border p-3 ${toneClass[tone]}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wider opacity-80">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

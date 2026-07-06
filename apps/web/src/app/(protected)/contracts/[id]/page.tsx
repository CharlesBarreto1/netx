'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import useSWR, { mutate } from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import {
  contractsApi,
  contractInvoicesApi,
  type Contract,
  type ContractInvoice,
  type InvoiceStatus,
} from '@/lib/contracts-api';
import type { Paginated } from '@/lib/crm-types';
import { formatDate, formatDateTime } from '@/lib/format';
import { useFormatMoney } from '@/lib/use-money';
import { hasPermission } from '@/lib/session';
import { useTenantConfig } from '@/lib/tenant-config';
import { sifenApi } from '@/lib/sifen-api';

import { AuditTrail } from '@/components/audit/AuditTrail';
import { ContractComodatoCard } from '@/components/contracts/ContractComodatoCard';
import { ContractFibermapPortCard } from '@/components/contracts/ContractFibermapPortCard';
import { ContractSessionCard } from '@/components/contracts/ContractSessionCard';
import { ContractWifiCard } from '@/components/contracts/ContractWifiCard';
import { ContractUsageChart } from '@/components/contracts/ContractUsageChart';
import { ContractDiagnosticsCard } from '@/components/contracts/ContractDiagnosticsCard';
import { UfinetStatusPanel } from '@/components/contracts/UfinetStatusPanel';
import { EditContractDialog } from '@/components/contracts/EditContractDialog';
import { SwapOntDialog } from '@/components/contracts/SwapOntDialog';
import { DeactivateInstallDialog } from '@/components/contracts/DeactivateInstallDialog';
import { NewInvoiceDialog } from '@/components/contracts/NewInvoiceDialog';
import { PaymentDialog } from '@/components/finance/PaymentDialog';
import { EfiChargeDialog } from '@/components/finance/EfiChargeDialog';
import { BtgChargeDialog } from '@/components/finance/BtgChargeDialog';
import { chargesApi, type OneTimeCharge } from '@/lib/finance-api';

import { StatusBadge } from '../_components/StatusBadge';

/**
 * /contracts/[id] — detalhe do contrato.
 *
 * Mostra dados do contrato, lista de faturas e ações de transição de estado:
 *  - Dar baixa em fatura (reativação instantânea se contrato estava suspenso por inadimplência)
 *  - Suspender / Reativar / Cancelar contrato
 */
export default function ContractDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const canWrite = hasPermission('contracts.write');
  const canDelete = hasPermission('contracts.delete');
  const canProvision = hasPermission('provisioning.write');
  const canReverse = hasPermission('cash_registers.manage');
  const canEmitSifen = hasPermission('sifen.emit');
  const canEfiCharge = hasPermission('efi.charges.write');
  const canBtgCharge = hasPermission('btg.charges.write');
  const tenantConfig = useTenantConfig();
  const tenantCountry = tenantConfig?.tenant?.country ?? null;
  const formatMoney = useFormatMoney();

  // Abre o documento da fatura/cobrança: KuDE fiscal quando há DTE aprovado
  // (PY); senão, o documento não fiscal.
  const openDoc = async (
    kind: 'invoice' | 'charge',
    refId: string,
  ): Promise<void> => {
    if (tenantCountry === 'PY') {
      try {
        const res = await sifenApi.list({
          ...(kind === 'invoice'
            ? { contractInvoiceId: refId }
            : { oneTimeChargeId: refId }),
          status: 'APPROVED',
          pageSize: 1,
        });
        const sdoc = res.data[0];
        if (sdoc) {
          window.open(`/fiscal/documents/${sdoc.id}/print`, '_blank');
          return;
        }
      } catch {
        // cai no documento não fiscal
      }
    }
    const path = kind === 'invoice' ? 'invoices' : 'charges';
    window.open(`/${path}/${refId}/print`, '_blank');
  };
  const tCommon = useTranslations('common');
  const tContracts = useTranslations('contracts');
  const tDetail = useTranslations('contracts.detail');
  const tAudit = useTranslations('audit');
  const tExtras = useTranslations('extras');

  const contractKey = id ? `/v1/contracts/${id}` : null;
  const invoicesKey = id ? contractInvoicesApi.byContractPath(id) : null;
  // Cobranças avulsas (OneTimeCharge) vinculadas a este contrato — o painel
  // financeiro precisa mostrá-las junto das faturas (antes só apareciam em
  // Financeiro > Cobranças).
  const chargesKey = id ? chargesApi.listPath({ contractId: id, pageSize: 200 }) : null;

  const { data: contract, isLoading: loadingContract, error: contractError } =
    useSWR<Contract>(contractKey);
  const { data: invoicesResp, isLoading: loadingInvoices } =
    useSWR<Paginated<ContractInvoice>>(invoicesKey);
  const { data: chargesResp } = useSWR<Paginated<OneTimeCharge>>(chargesKey);

  async function refresh() {
    await Promise.all([
      contractKey ? mutate(contractKey) : Promise.resolve(),
      invoicesKey ? mutate(invoicesKey) : Promise.resolve(),
      chargesKey ? mutate(chargesKey) : Promise.resolve(),
    ]);
  }

  // --- Estados de modais ---------------------------------------------------
  const [payInvoice, setPayInvoice] = useState<ContractInvoice | null>(null);
  const [efiCharging, setEfiCharging] = useState<ContractInvoice | null>(null);
  const [btgCharging, setBtgCharging] = useState<ContractInvoice | null>(null);
  const [newInvoiceOpen, setNewInvoiceOpen] = useState(false);
  const [payCharge, setPayCharge] = useState<OneTimeCharge | null>(null);
  const [cancelCharge, setCancelCharge] = useState<OneTimeCharge | null>(null);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);

  const [noteValue, setNoteValue] = useState('');
  const [busy, setBusy] = useState(false);

  if (loadingContract && !contract) return <PageLoader label={tCommon('loading')} />;
  if (contractError) {
    const msg =
      contractError instanceof ApiError ? contractError.friendlyMessage : (contractError as Error).message;
    return (
      <div className="rounded-md border border-border bg-surface p-6 text-sm text-text">
        <p className="font-medium">{tCommon('failureLoading')}</p>
        <p className="mt-1 text-xs text-text-muted">{msg}</p>
        <Link href="/contracts" className="mt-3 inline-block text-xs text-brand-500 hover:underline">
          ← {tContracts('title')}
        </Link>
      </div>
    );
  }
  if (!contract) return null;

  const invoices = invoicesResp?.data ?? [];
  const charges = chargesResp?.data ?? [];
  const isActive = contract.status === 'ACTIVE';
  const isSuspended = contract.status === 'SUSPENDED';
  const isCancelled = contract.status === 'CANCELLED';

  // -------------------------------------------------------------------------
  // Handlers de ações
  // -------------------------------------------------------------------------
  // O pagamento real fica no <PaymentDialog />. Aqui só fechamos e refrescamos
  // ao final — o dialog cuida de mostrar e validar caixa, método, desconto.

  async function doUnpayInvoice(inv: ContractInvoice) {
    if (!confirm(tDetail('unpayConfirm', { amount: formatMoney(inv.amount) }))) return;
    try {
      await contractInvoicesApi.unpay(inv.id);
      toast.success(tDetail('unpaidToast'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
    }
  }

  async function doReopen() {
    if (!confirm(tDetail('reopenConfirm'))) return;
    setBusy(true);
    try {
      await contractsApi.reopen(id);
      toast.success(tDetail('reopenedToast'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tCommon('error'));
    } finally {
      setBusy(false);
    }
  }

  async function doUnpayCharge(ch: OneTimeCharge) {
    if (!confirm(tDetail('unpayConfirm', { amount: formatMoney(ch.amount) }))) return;
    try {
      await chargesApi.unpay(ch.id);
      toast.success(tDetail('unpaidToast'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
    }
  }

  async function doCancelInvoice(inv: ContractInvoice) {
    if (!confirm(`Cancelar a fatura de ${formatMoney(inv.amount)}?`)) return;
    try {
      await contractInvoicesApi.cancel(inv.id);
      toast.success(tCommon('success'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
    }
  }

  async function doSuspend() {
    if (!id) return;
    setBusy(true);
    try {
      await contractsApi.suspend(id, 'MANUAL', noteValue || undefined);
      toast.success(tCommon('success'));
      setSuspendOpen(false);
      setNoteValue('');
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doReactivate() {
    if (!id) return;
    setBusy(true);
    try {
      await contractsApi.reactivate(id, noteValue || undefined);
      toast.success(tCommon('success'));
      setReactivateOpen(false);
      setNoteValue('');
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doCancel() {
    if (!id) return;
    setBusy(true);
    try {
      await contractsApi.cancel(id, noteValue || undefined);
      toast.success(tCommon('success'));
      setCancelOpen(false);
      setNoteValue('');
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!id) return;
    setBusy(true);
    try {
      await contractsApi.remove(id);
      toast.success(tDetail('deletedToast'));
      router.push('/contracts');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3">
        <Link href="/contracts" className="text-xs text-text-muted hover:text-text">
          ← Contratos
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-text">
              {contract.customer?.displayName ?? '—'}
            </h1>
            <StatusBadge status={contract.status} />
            {contract.suspendReason === 'OVERDUE_PAYMENT' && isSuspended && (
              <Badge tone="danger">Inadimplência</Badge>
            )}
            {contract.trustExtensionUntil && isActive && (
              <Badge tone="warning">
                Confianza hasta {contract.trustExtensionUntil.slice(0, 10)}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {contract.code ? `Contrato ${contract.code} · ` : ''}
            {contract.authMethod === 'IPOE' ? (
              <>
                IPoE{' '}
                <span className="font-mono">
                  {contract.circuitId ?? contract.macAddress ?? '—'}
                </span>
              </>
            ) : (
              <>
                PPPoE{' '}
                <span className="font-mono">
                  {contract.pppoeUsername ?? '—'}
                </span>
              </>
            )}
          </p>
        </div>

        {/* Ações de estado */}
        <div className="flex flex-wrap items-center gap-2">
          {canWrite && !isCancelled && (
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              {tCommon('edit')}
            </Button>
          )}
          {canProvision && isActive && (
            <Button variant="outline" size="sm" onClick={() => setSwapOpen(true)}>
              {tDetail('swapOnt')}
            </Button>
          )}
          {canProvision && isActive && (
            <Button variant="outline" size="sm" onClick={() => setDeactivateOpen(true)}>
              {tDetail('undoInstall')}
            </Button>
          )}
          {canWrite && isCancelled && (
            <Button variant="primary" size="sm" onClick={doReopen} loading={busy}>
              {tDetail('reopen')}
            </Button>
          )}
          {canWrite && isActive && (
            <Button variant="outline" size="sm" onClick={() => setSuspendOpen(true)}>
              {tDetail('suspendContract')}
            </Button>
          )}
          {canWrite && isSuspended && (
            <Button variant="primary" size="sm" onClick={() => setReactivateOpen(true)}>
              {tDetail('reactivateContract')}
            </Button>
          )}
          {canWrite && isSuspended && contract.suspendReason === 'OVERDUE_PAYMENT' && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const raw = window.prompt('Religue de confiança — días', '5');
                if (!raw) return;
                const days = Math.max(1, Math.min(30, Number(raw) || 5));
                try {
                  await contractsApi.trustExtend(contract.id, days);
                  toast.success(`Reactivado por ${days} días`);
                  await refresh();
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.friendlyMessage : 'Error');
                }
              }}
            >
              Religue de confianza
            </Button>
          )}
          {canWrite && !isCancelled && (
            <Button variant="danger" size="sm" onClick={() => setCancelOpen(true)}>
              {tDetail('cancelContract')}
            </Button>
          )}
          {canDelete && isCancelled && (
            <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)}>
              {tCommon('delete')}
            </Button>
          )}
        </div>
      </div>

      {/* Modal de edição */}
      {editOpen && (
        <EditContractDialog
          open={editOpen}
          contract={contract}
          onClose={() => setEditOpen(false)}
          onUpdated={() => {
            void refresh();
          }}
        />
      )}

      {/* Troca de ONT (administrativo — reusa o swapOnt, atualiza o TR-069) */}
      {swapOpen && (
        <SwapOntDialog
          contractId={contract.id}
          onClose={() => setSwapOpen(false)}
          onDone={() => {
            setSwapOpen(false);
            toast.success(tDetail('swapOntDone'));
            void refresh();
          }}
        />
      )}

      {/* Desfazer instalação — volta o contrato pra PENDING_INSTALL */}
      {deactivateOpen && (
        <DeactivateInstallDialog
          contractId={contract.id}
          onClose={() => setDeactivateOpen(false)}
          onDone={() => {
            setDeactivateOpen(false);
            void refresh();
          }}
        />
      )}

      {/* Info do contrato */}
      <div className="grid gap-4 md:grid-cols-2">
        <InfoCard title={tDetail('service')}>
          <DataRow
            label={tContracts('fields.monthlyValue')}
            value={formatMoney(contract.monthlyValue)}
          />
          <DataRow
            label={tDetail('bandwidth')}
            value={
              contract.uploadMbps != null
                ? `${contract.bandwidthMbps}/${contract.uploadMbps} Mbps`
                : `${contract.bandwidthMbps} Mbps`
            }
          />
          {contract.planName && (
            <DataRow label={tExtras('contractPlan')} value={contract.planName} />
          )}
          <DataRow
            label={tExtras('paymentMode')}
            value={
              <Badge tone={contract.paymentMode === 'PREPAID' ? 'warning' : 'neutral'}>
                {contract.paymentMode === 'PREPAID' ? tExtras('prepaid') : tExtras('postpaid')}
              </Badge>
            }
          />
          {contract.paymentMode === 'POSTPAID' && (
            <DataRow label={tDetail('dueDay')} value={`${contract.dueDay}`} />
          )}
          {contract.paymentMode === 'PREPAID' && contract.prepaidUntil && (
            <DataRow
              label={tExtras('paidUntil')}
              value={formatDate(contract.prepaidUntil)}
            />
          )}
          <DataRow
            label="Dias para bloqueio"
            value={
              contract.blockAfterDays != null
                ? `${contract.blockAfterDays} (override)`
                : `${contract.effectiveBlockAfterDays} (do plano)`
            }
          />
          <DataRow
            label={tDetail('installationAddress')}
            value={contract.installationAddress}
          />
          {contract.installationMapsUrl && (
            <DataRow
              label={tDetail('mapsLink')}
              value={
                <a
                  href={contract.installationMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-500 hover:underline"
                >
                  {tDetail('mapsOpen')}
                </a>
              }
            />
          )}
        </InfoCard>

        <InfoCard
          title={
            contract.authMethod === 'IPOE'
              ? tDetail('ipoeCard')
              : tDetail('pppoeCard')
          }
        >
          {contract.authMethod === 'IPOE' ? (
            <>
              {contract.circuitId && (
                <DataRow
                  label={tDetail('circuitIdLabel')}
                  value={
                    <span className="font-mono text-xs">{contract.circuitId}</span>
                  }
                />
              )}
              {contract.remoteId && (
                <DataRow
                  label={tDetail('remoteIdLabel')}
                  value={
                    <span className="font-mono text-xs">{contract.remoteId}</span>
                  }
                />
              )}
              {contract.macAddress && (
                <DataRow
                  label={tDetail('macAddressLabel')}
                  value={
                    <span className="font-mono text-xs">{contract.macAddress}</span>
                  }
                />
              )}
              {contract.framedIpAddress && (
                <DataRow
                  label={tDetail('framedIpLabel')}
                  value={
                    <span className="font-mono text-xs">
                      {contract.framedIpAddress}
                    </span>
                  }
                />
              )}
              {contract.vlanId !== null && contract.vlanId !== undefined && (
                <DataRow
                  label={tDetail('vlanIdLabel')}
                  value={
                    <span className="font-mono text-xs">{contract.vlanId}</span>
                  }
                />
              )}
            </>
          ) : (
            <>
              <DataRow
                label={tDetail('pppoeUserLabel')}
                value={
                  <span className="font-mono text-xs">
                    {contract.pppoeUsername ?? '—'}
                  </span>
                }
              />
              <DataRow
                label={tDetail('pppoePassLabel')}
                value={
                  contract.pppoePassword ? (
                    <span className="font-mono text-xs">
                      {contract.pppoePassword}
                    </span>
                  ) : (
                    <span className="text-xs text-text-muted">
                      {tDetail('pppoeHidden')}
                    </span>
                  )
                }
              />
            </>
          )}
          {contract.customer && (
            <DataRow
              label={tDetail('customer')}
              value={
                <Link
                  href={`/customers/${contract.customerId}`}
                  className="text-brand-500 hover:underline"
                >
                  {contract.customer.displayName}
                </Link>
              }
            />
          )}
        </InfoCard>
      </div>

      {contract.notes && (
        <InfoCard title={tDetail('notesTitle')}>
          <p className="whitespace-pre-wrap text-sm text-text">{contract.notes}</p>
        </InfoCard>
      )}

      {/* Status técnico em tempo real (RADIUS accounting) */}
      <InfoCard title={tExtras('technicalStatus')}>
        <ContractSessionCard contractId={contract.id} />
      </InfoCard>

      {/* Wi-Fi (TR-069 ACS) — só faz sentido pra contratos com ONT vinculada,
          mas o próprio card renderiza um aviso quando não há TR-069 device. */}
      <ContractWifiCard contractId={contract.id} />

      {/* Diagnóstico do CPE (TR-069) — óptico/Wi-Fi/alertas; some se não houver
          CPE gerenciada. Hub do Atendente: evita ir até /tr069 copiar serial. */}
      <ContractDiagnosticsCard contractId={contract.id} />

      {/* Rede neutra Ufinet (PY) — só renderiza se o contrato tem serviço Ufinet */}
      <UfinetStatusPanel contractId={contract.id} />

      {/* Vínculo físico CTO/porta no FiberMap (fonte de verdade do drop).
          O ctoPort do painel Ufinet acima segue mostrando o valor persistido. */}
      <ContractFibermapPortCard
        contractId={contract.id}
        nearLat={contract.latitude}
        nearLng={contract.longitude}
      />

      {/* Equipamentos em comodato (Estoque Fase 2) */}
      <InfoCard title="Equipamentos em comodato">
        <ContractComodatoCard contractId={contract.id} />
      </InfoCard>

      {/* Consumo de banda */}
      <InfoCard title="Consumo de banda">
        <ContractUsageChart contractId={contract.id} />
      </InfoCard>

      {/* Timeline resumida */}
      <InfoCard title={tDetail('historyTitle')}>
        <DataRow
          label={tDetail('createdAt')}
          value={formatDateTime(contract.createdAt)}
        />
        {contract.activatedAt && (
          <DataRow
            label={tDetail('activatedAt')}
            value={formatDateTime(contract.activatedAt)}
          />
        )}
        {contract.suspendedAt && (
          <DataRow
            label={tDetail('suspendedAt')}
            value={formatDateTime(contract.suspendedAt)}
          />
        )}
        {contract.cancelledAt && (
          <DataRow
            label={tDetail('cancelledAt')}
            value={formatDateTime(contract.cancelledAt)}
          />
        )}
      </InfoCard>

      {/* Trilha de auditoria — quem mexeu nesse contrato e quando */}
      {hasPermission('audit.read') && contract.id && (
        <InfoCard title={tAudit('title')}>
          <AuditTrail resource="contracts" resourceId={contract.id} />
        </InfoCard>
      )}

      {/* Faturas */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">{tDetail('invoicesTitle')}</h2>
          {canWrite && !isCancelled && (
            <Button size="sm" variant="outline" onClick={() => setNewInvoiceOpen(true)}>
              {tDetail('newInvoice.button')}
            </Button>
          )}
        </div>

        {loadingInvoices && !invoicesResp ? (
          <PageLoader label={tCommon('loading')} />
        ) : invoices.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface px-4 py-8 text-center text-xs text-text-muted">
            {tCommon('nothingHere')}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border bg-surface">
            <table className="min-w-full text-sm">
              <thead className="bg-surface-muted text-xs uppercase tracking-wide text-text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Referência</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                  <th className="px-3 py-2 text-center">Vencimento</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Pago em</th>
                  <th className="px-3 py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <div className="text-xs text-text">{inv.reference ?? '—'}</div>
                    </td>
                    <td className="px-3 py-2 text-right">{formatMoney(inv.amount)}</td>
                    <td className="px-3 py-2 text-center">{formatDate(inv.dueDate)}</td>
                    <td className="px-3 py-2">
                      <InvoiceBadge status={inv.status} />
                    </td>
                    <td className="px-3 py-2 text-xs text-text-muted">
                      {inv.paidAt ? formatDate(inv.paidAt) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        {/* Botão Emitir SIFEN — só pra tenant PY com permissão.
                            Backend rejeita se SIFEN não configurado, então não
                            tem cheque extra aqui (UX: msg de erro orienta o user). */}
                        {tenantCountry === 'PY' &&
                          canEmitSifen &&
                          (inv.status === 'OPEN' || inv.status === 'PAID') && (
                            <SifenEmitButton invoiceId={inv.id} />
                          )}
                        {(inv.status === 'OPEN' || inv.status === 'OVERDUE') && canWrite && (
                          <>
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => {
                                setPayInvoice(inv);
                                setNoteValue('');
                              }}
                            >
                              Dar baixa
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void doCancelInvoice(inv)}
                            >
                              Cancelar
                            </Button>
                          </>
                        )}
                        {(inv.status === 'OPEN' || inv.status === 'OVERDUE') &&
                          contract.brBillingGateway === 'EFI' &&
                          canEfiCharge && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEfiCharging(inv)}
                              title="Gerar cobrança Pix/Boleto no EFI"
                            >
                              Pix/Boleto
                            </Button>
                          )}
                        {(inv.status === 'OPEN' || inv.status === 'OVERDUE') &&
                          contract.brBillingGateway === 'BTG' &&
                          canBtgCharge && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setBtgCharging(inv)}
                              title="Gerar cobrança Pix/Boleto no BTG"
                            >
                              Pix/Boleto
                            </Button>
                          )}
                        {inv.status === 'PAID' && canReverse && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 dark:text-red-400"
                            onClick={() => void doUnpayInvoice(inv)}
                          >
                            {tDetail('reversePayment')}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void openDoc('invoice', inv.id)}
                        >
                          Imprimir
                        </Button>
                        {inv.status === 'PAID' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              window.open(`/receipts/invoice/${inv.id}`, '_blank')
                            }
                          >
                            Recibo
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cobranças avulsas (OneTimeCharge) vinculadas a este contrato */}
      {charges.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-text">
            {tDetail('chargesTitle')}
          </h2>
          <div className="overflow-x-auto rounded-md border border-border bg-surface">
            <table className="min-w-full text-sm">
              <thead className="bg-surface-muted text-xs uppercase tracking-wide text-text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">{tDetail('chargeDescription')}</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                  <th className="px-3 py-2 text-center">Vencimento</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Pago em</th>
                  <th className="px-3 py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {charges.map((ch) => (
                  <tr key={ch.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <div className="text-xs text-text">{ch.description}</div>
                      {ch.code && (
                        <div className="font-mono text-2xs text-text-muted">{ch.code}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{formatMoney(ch.amount)}</td>
                    <td className="px-3 py-2 text-center">{formatDate(ch.dueDate)}</td>
                    <td className="px-3 py-2">
                      <ChargeBadge status={ch.status} />
                    </td>
                    <td className="px-3 py-2 text-xs text-text-muted">
                      {ch.paidAt ? formatDate(ch.paidAt) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void openDoc('charge', ch.id)}
                        >
                          Imprimir
                        </Button>
                        {ch.status === 'PAID' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              window.open(`/receipts/charge/${ch.id}`, '_blank')
                            }
                          >
                            Recibo
                          </Button>
                        )}
                        {ch.status === 'PAID' && canReverse && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 dark:text-red-400"
                            onClick={() => void doUnpayCharge(ch)}
                          >
                            {tDetail('reversePayment')}
                          </Button>
                        )}
                        {ch.status === 'OPEN' && canWrite && (
                          <>
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => setPayCharge(ch)}
                            >
                              Dar baixa
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setCancelCharge(ch)}
                            >
                              Cancelar
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Gerar fatura manual do contrato */}
      {newInvoiceOpen && (
        <NewInvoiceDialog
          contractId={contract.id}
          onClose={() => setNewInvoiceOpen(false)}
          onCreated={() => {
            setNewInvoiceOpen(false);
            void refresh();
          }}
        />
      )}

      {/* Dar baixa numa cobrança avulsa */}
      {payCharge && (
        <PaymentDialog
          open
          onOpenChange={(v) => !v && setPayCharge(null)}
          amount={payCharge.amount}
          description={`${payCharge.code ? `${payCharge.code} · ` : ''}${payCharge.description}`}
          onConfirm={async (input) => {
            const chargeId = payCharge.id;
            await chargesApi.pay(chargeId, input);
            setPayCharge(null);
            toast.success(tCommon('success'));
            await refresh();
            window.open(`/receipts/charge/${chargeId}`, '_blank');
          }}
        />
      )}

      {/* Cancelar cobrança avulsa */}
      <ConfirmDialog
        open={!!cancelCharge}
        onClose={() => setCancelCharge(null)}
        onConfirm={async () => {
          if (!cancelCharge) return;
          try {
            await chargesApi.cancel(cancelCharge.id);
            setCancelCharge(null);
            toast.success(tCommon('success'));
            await refresh();
          } catch (err) {
            toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
          }
        }}
        title={tDetail('cancelChargeTitle')}
        message={tDetail('cancelChargeMessage')}
      />

      {/* -------------------- Pagamento -------------------- */}
      {payInvoice && (
        <PaymentDialog
          open={!!payInvoice}
          onOpenChange={(v) => {
            if (!v) setPayInvoice(null);
          }}
          amount={payInvoice.amount}
          description={
            payInvoice.reference
              ? `${payInvoice.reference} · ${formatMoney(payInvoice.amount)}`
              : `${formatMoney(payInvoice.amount)}`
          }
          onConfirm={async (input) => {
            const invId = payInvoice.id;
            await contractInvoicesApi.pay(invId, input);
            toast.success(tDetail('paidToast'));
            await refresh();
            window.open(`/receipts/invoice/${invId}`, '_blank');
          }}
        />
      )}

      {/* -------------------- Cobrança Pix/Boleto (EFI) -------------------- */}
      {efiCharging && (
        <EfiChargeDialog
          open={!!efiCharging}
          onOpenChange={(v) => !v && setEfiCharging(null)}
          invoiceId={efiCharging.id}
          amount={efiCharging.amount}
          description={
            efiCharging.reference
              ? `${efiCharging.reference} · ${formatDate(efiCharging.dueDate)}`
              : formatMoney(efiCharging.amount)
          }
        />
      )}

      {/* -------------------- Cobrança Pix/Boleto (BTG) -------------------- */}
      {btgCharging && (
        <BtgChargeDialog
          open={!!btgCharging}
          onOpenChange={(v) => !v && setBtgCharging(null)}
          invoiceId={btgCharging.id}
          amount={btgCharging.amount}
          description={
            btgCharging.reference
              ? `${btgCharging.reference} · ${formatDate(btgCharging.dueDate)}`
              : formatMoney(btgCharging.amount)
          }
        />
      )}

      {/* -------------------- Modal: Suspender -------------------- */}
      <Modal
        open={suspendOpen}
        onClose={() => {
          if (!busy) {
            setSuspendOpen(false);
            setNoteValue('');
          }
        }}
        title={tDetail('suspendModal.title')}
        description={tDetail('suspendModal.desc')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSuspendOpen(false)} disabled={busy}>
              {tCommon('cancel')}
            </Button>
            <Button variant="primary" onClick={() => void doSuspend()} loading={busy}>
              {tDetail('suspendContract')}
            </Button>
          </>
        }
      >
        <Label htmlFor="suspendNote">{tDetail('suspendModal.noteLabel')}</Label>
        <Input
          id="suspendNote"
          value={noteValue}
          onChange={(e) => setNoteValue(e.target.value)}
          placeholder={tCommon('optional')}
        />
      </Modal>

      {/* -------------------- Modal: Reativar -------------------- */}
      <Modal
        open={reactivateOpen}
        onClose={() => {
          if (!busy) {
            setReactivateOpen(false);
            setNoteValue('');
          }
        }}
        title={tDetail('reactivateModal.title')}
        description={tDetail('reactivateModal.desc')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReactivateOpen(false)} disabled={busy}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={() => void doReactivate()} loading={busy}>
              {tDetail('reactivateContract')}
            </Button>
          </>
        }
      >
        <Label htmlFor="reactivateNote">{tDetail('reactivateModal.noteLabel')}</Label>
        <Input
          id="reactivateNote"
          value={noteValue}
          onChange={(e) => setNoteValue(e.target.value)}
        />
      </Modal>

      {/* -------------------- Modal: Cancelar contrato -------------------- */}
      <Modal
        open={cancelOpen}
        onClose={() => {
          if (!busy) {
            setCancelOpen(false);
            setNoteValue('');
          }
        }}
        title={tDetail('cancelModal.title')}
        description={tDetail('cancelModal.desc')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelOpen(false)} disabled={busy}>
              {tDetail('cancelModal.back')}
            </Button>
            <Button variant="danger" onClick={() => void doCancel()} loading={busy}>
              {tDetail('cancelContract')}
            </Button>
          </>
        }
      >
        <Label htmlFor="cancelNote">{tDetail('cancelModal.noteLabel')}</Label>
        <Textarea
          id="cancelNote"
          rows={2}
          value={noteValue}
          onChange={(e) => setNoteValue(e.target.value)}
          placeholder={tDetail('cancelModal.notePlaceholder')}
        />
      </Modal>

      {/* -------------------- Modal: Excluir definitivamente -------------------- */}
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void doDelete()}
        title={tDetail('deleteModal.title')}
        message={tDetail('deleteModal.desc')}
        confirmLabel={tCommon('delete')}
        variant="danger"
        loading={busy}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers visuais
// ---------------------------------------------------------------------------
function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
        {title}
      </h3>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="min-w-[120px] text-xs text-text-muted">{label}</span>
      <span className="text-right text-text">{value}</span>
    </div>
  );
}

function InvoiceBadge({ status }: { status: InvoiceStatus }) {
  switch (status) {
    case 'PAID':
      return <Badge tone="success">Paga</Badge>;
    case 'OPEN':
      return <Badge tone="info">Em aberto</Badge>;
    case 'OVERDUE':
      return <Badge tone="danger">Vencida</Badge>;
    case 'CANCELLED':
      return <Badge tone="neutral">Cancelada</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

function ChargeBadge({ status }: { status: OneTimeCharge['status'] }) {
  switch (status) {
    case 'PAID':
      return <Badge tone="success">Paga</Badge>;
    case 'OPEN':
      return <Badge tone="info">Em aberto</Badge>;
    case 'CANCELLED':
      return <Badge tone="neutral">Cancelada</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

/**
 * Botão que emite DTE SIFEN pra esta fatura. Confirmação inline (não modal —
 * default tipo FACTURA, sem campos extras). Após sucesso, leva o operador ao
 * detalhe do documento gerado pra ver QR + status SET.
 *
 * Se SIFEN não estiver configurado, o backend devolve 400 com mensagem clara
 * — o toast mostra e o user clica "Configurar SIFEN" no menu fiscal.
 */
function SifenEmitButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [emitting, setEmitting] = useState(false);

  async function onClick() {
    if (emitting) return;
    if (!window.confirm('Emitir DTE SIFEN (Factura) para esta fatura?')) return;
    setEmitting(true);
    try {
      const doc = await sifenApi.emit({ type: 'FACTURA', contractInvoiceId: invoiceId });
      toast.success(
        doc.status === 'APPROVED'
          ? 'DTE aprovado pelo SET'
          : `DTE criado com status ${doc.status}`,
      );
      router.push(`/fiscal/documents/${doc.id}`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha: ${msg}`);
    } finally {
      setEmitting(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={onClick} loading={emitting}>
      Emitir SIFEN
    </Button>
  );
}

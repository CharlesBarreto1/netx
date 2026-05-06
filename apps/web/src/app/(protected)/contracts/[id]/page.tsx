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

import { EditContractDialog } from '@/components/contracts/EditContractDialog';

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
  const formatMoney = useFormatMoney();
  const tCommon = useTranslations('common');
  const tContracts = useTranslations('contracts');
  const tDetail = useTranslations('contracts.detail');

  const contractKey = id ? `/v1/contracts/${id}` : null;
  const invoicesKey = id ? contractInvoicesApi.byContractPath(id) : null;

  const { data: contract, isLoading: loadingContract, error: contractError } =
    useSWR<Contract>(contractKey);
  const { data: invoicesResp, isLoading: loadingInvoices } =
    useSWR<Paginated<ContractInvoice>>(invoicesKey);

  async function refresh() {
    await Promise.all([
      contractKey ? mutate(contractKey) : Promise.resolve(),
      invoicesKey ? mutate(invoicesKey) : Promise.resolve(),
    ]);
  }

  // --- Estados de modais ---------------------------------------------------
  const [payInvoice, setPayInvoice] = useState<ContractInvoice | null>(null);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const [noteValue, setNoteValue] = useState('');
  const [busy, setBusy] = useState(false);

  if (loadingContract && !contract) return <PageLoader label={tCommon('loading')} />;
  if (contractError) {
    const msg =
      contractError instanceof ApiError ? contractError.friendlyMessage : (contractError as Error).message;
    return (
      <div className="rounded-md border border-border bg-surface p-6 text-sm text-text">
        <p className="font-medium">Erro ao carregar contrato</p>
        <p className="mt-1 text-xs text-text-muted">{msg}</p>
        <Link href="/contracts" className="mt-3 inline-block text-xs text-brand-500 hover:underline">
          ← Voltar para contratos
        </Link>
      </div>
    );
  }
  if (!contract) return null;

  const invoices = invoicesResp?.data ?? [];
  const isActive = contract.status === 'ACTIVE';
  const isSuspended = contract.status === 'SUSPENDED';
  const isCancelled = contract.status === 'CANCELLED';

  // -------------------------------------------------------------------------
  // Handlers de ações
  // -------------------------------------------------------------------------
  async function doPay() {
    if (!payInvoice) return;
    setBusy(true);
    try {
      await contractInvoicesApi.pay(payInvoice.id, {
        note: noteValue || undefined,
      });
      toast.success('Fatura baixada com sucesso');
      setPayInvoice(null);
      setNoteValue('');
      await refresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha ao dar baixa: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function doCancelInvoice(inv: ContractInvoice) {
    if (!confirm(`Cancelar a fatura de ${formatMoney(inv.amount)}?`)) return;
    try {
      await contractInvoicesApi.cancel(inv.id);
      toast.success('Fatura cancelada');
      await refresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha ao cancelar fatura: ${msg}`);
    }
  }

  async function doSuspend() {
    if (!id) return;
    setBusy(true);
    try {
      await contractsApi.suspend(id, 'MANUAL', noteValue || undefined);
      toast.success('Contrato suspenso');
      setSuspendOpen(false);
      setNoteValue('');
      await refresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha ao suspender: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function doReactivate() {
    if (!id) return;
    setBusy(true);
    try {
      await contractsApi.reactivate(id, noteValue || undefined);
      toast.success('Contrato reativado');
      setReactivateOpen(false);
      setNoteValue('');
      await refresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha ao reativar: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function doCancel() {
    if (!id) return;
    setBusy(true);
    try {
      await contractsApi.cancel(id, noteValue || undefined);
      toast.success('Contrato cancelado');
      setCancelOpen(false);
      setNoteValue('');
      await refresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha ao cancelar: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!id) return;
    setBusy(true);
    try {
      await contractsApi.remove(id);
      toast.success('Contrato excluído');
      router.push('/contracts');
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha ao excluir: ${msg}`);
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
              Editar
            </Button>
          )}
          {canWrite && isActive && (
            <Button variant="outline" size="sm" onClick={() => setSuspendOpen(true)}>
              Suspender
            </Button>
          )}
          {canWrite && isSuspended && (
            <Button variant="primary" size="sm" onClick={() => setReactivateOpen(true)}>
              Reativar
            </Button>
          )}
          {canWrite && !isCancelled && (
            <Button variant="danger" size="sm" onClick={() => setCancelOpen(true)}>
              Cancelar contrato
            </Button>
          )}
          {canDelete && isCancelled && (
            <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)}>
              Excluir
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

      {/* Info do contrato */}
      <div className="grid gap-4 md:grid-cols-2">
        <InfoCard title={tDetail('service')}>
          <DataRow
            label={tContracts('fields.monthlyValue')}
            value={formatMoney(contract.monthlyValue)}
          />
          <DataRow
            label={tDetail('bandwidth')}
            value={`${contract.bandwidthMbps} Mbps`}
          />
          <DataRow label={tDetail('dueDay')} value={`${contract.dueDay}`} />
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

      {/* Faturas */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">{tDetail('invoicesTitle')}</h2>
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
                      {(inv.status === 'OPEN' || inv.status === 'OVERDUE') && canWrite && (
                        <div className="flex justify-end gap-1">
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
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* -------------------- Modal: Dar baixa -------------------- */}
      <Modal
        open={!!payInvoice}
        onClose={() => {
          if (!busy) {
            setPayInvoice(null);
            setNoteValue('');
          }
        }}
        title="Dar baixa em fatura"
        description={
          payInvoice
            ? `Marca a fatura ${payInvoice.reference ?? ''} (${formatMoney(payInvoice.amount)}) como paga.`
            : undefined
        }
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setPayInvoice(null);
                setNoteValue('');
              }}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button onClick={() => void doPay()} loading={busy}>
              Confirmar baixa
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-text-muted">
            Se o contrato estava suspenso por inadimplência e esta era a última fatura vencida, o
            contrato é reativado automaticamente.
          </p>
          <div>
            <Label htmlFor="payNote">Observação (opcional)</Label>
            <Textarea
              id="payNote"
              rows={2}
              value={noteValue}
              onChange={(e) => setNoteValue(e.target.value)}
              placeholder="Ex.: pago em dinheiro / PIX"
            />
          </div>
        </div>
      </Modal>

      {/* -------------------- Modal: Suspender -------------------- */}
      <Modal
        open={suspendOpen}
        onClose={() => {
          if (!busy) {
            setSuspendOpen(false);
            setNoteValue('');
          }
        }}
        title="Suspender contrato"
        description="O RADIUS recebe ordem de bloqueio — o cliente permanece autenticado, mas em pool restrito."
        footer={
          <>
            <Button variant="ghost" onClick={() => setSuspendOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={() => void doSuspend()} loading={busy}>
              Suspender
            </Button>
          </>
        }
      >
        <Label htmlFor="suspendNote">Motivo / observação</Label>
        <Input
          id="suspendNote"
          value={noteValue}
          onChange={(e) => setNoteValue(e.target.value)}
          placeholder="Opcional"
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
        title="Reativar contrato"
        description="O RADIUS volta a autorizar o cliente no pool normal."
        footer={
          <>
            <Button variant="ghost" onClick={() => setReactivateOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={() => void doReactivate()} loading={busy}>
              Reativar
            </Button>
          </>
        }
      >
        <Label htmlFor="reactivateNote">Observação (opcional)</Label>
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
        title="Cancelar contrato"
        description="Encerra o serviço. Faturas em aberto serão canceladas e o cliente vai para o pool de cancelados no RADIUS. Esta ação não pode ser desfeita."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelOpen(false)} disabled={busy}>
              Voltar
            </Button>
            <Button variant="danger" onClick={() => void doCancel()} loading={busy}>
              Cancelar contrato
            </Button>
          </>
        }
      >
        <Label htmlFor="cancelNote">Motivo</Label>
        <Textarea
          id="cancelNote"
          rows={2}
          value={noteValue}
          onChange={(e) => setNoteValue(e.target.value)}
          placeholder="Ex.: cliente mudou de provedor"
        />
      </Modal>

      {/* -------------------- Modal: Excluir definitivamente -------------------- */}
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void doDelete()}
        title="Excluir contrato"
        message="O contrato será removido (soft-delete). Só é possível excluir contratos já cancelados."
        confirmLabel="Excluir"
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

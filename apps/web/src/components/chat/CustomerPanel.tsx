'use client';

import {
  Activity,
  ExternalLink,
  Link2,
  Link2Off,
  RefreshCw,
  Search,
  ShieldCheck,
  Unplug,
  Wifi,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { contractsApi, contractInvoicesApi, type ContractInvoice } from '@/lib/contracts-api';
import { efiApi, btgApi } from '@/lib/finance-api';
import { classifyRxPower, tr069Api } from '@/lib/provisioning-api';
import { radacctApi, type ContractSession } from '@/lib/radacct-api';
import { hasPermission } from '@/lib/session';
import { useTenantConfig } from '@/lib/tenant-config';
import {
  customerContextPath,
  getCustomerContext,
  linkContactCustomer,
  searchCustomers,
  sendMessage,
  type WaContractCtx,
  type WaConversationDetail,
  type WaCustomerHit,
} from '@/lib/whatsapp-api';

type Tab = 'resumo' | 'conexao' | 'financeiro';

/**
 * Painel do cliente (coluna direita do atendimento). Abas: Resumo (dados +
 * vínculo manual), Conexão (online/IP/sinal/WiFi + ações de rede) e Financeiro
 * (faturas + gerar/enviar Pix/Boleto na conversa). Reaproveita os endpoints já
 * existentes (radacct, tr069, contracts, finance/efi/btg).
 */
export function CustomerPanel({
  conversation,
  onChanged,
}: {
  conversation: WaConversationDetail | undefined;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>('resumo');
  const convId = conversation?.id;

  const ctx = useSWR(convId ? customerContextPath(convId) : null, () =>
    getCustomerContext(convId as string),
  );

  if (!conversation) return <aside className="hidden md:block" />;

  const contracts = ctx.data?.contracts ?? [];
  const hasCustomer = Boolean(ctx.data?.customer);

  return (
    <aside className="flex h-[calc(100vh-160px)] flex-col rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      {/* Tabs */}
      <div className="flex border-b border-slate-200 text-sm dark:border-slate-700">
        {([
          ['resumo', 'Resumo'],
          ['conexao', 'Conexão'],
          ['financeiro', 'Financeiro'],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 px-3 py-2.5 font-medium transition ${
              tab === key
                ? 'border-b-2 border-brand-500 text-brand-700 dark:text-brand-300'
                : 'text-text-muted hover:text-text'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {ctx.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : tab === 'resumo' ? (
          <ResumoTab conversation={conversation} ctx={ctx.data} onChanged={() => { void ctx.mutate(); onChanged(); }} />
        ) : tab === 'conexao' ? (
          <ConexaoTab contracts={contracts} hasCustomer={hasCustomer} />
        ) : (
          <FinanceiroTab contracts={contracts} conversationId={conversation.id} hasCustomer={hasCustomer} onSent={onChanged} />
        )}
      </div>
    </aside>
  );
}

// ============================ RESUMO ============================

function ResumoTab({
  conversation,
  ctx,
  onChanged,
}: {
  conversation: WaConversationDetail;
  ctx: Awaited<ReturnType<typeof getCustomerContext>> | undefined;
  onChanged: () => void;
}) {
  const customer = ctx?.customer;
  const contactId = ctx?.contact.id ?? conversation.contact.id;

  return (
    <div className="space-y-4">
      {customer ? (
        <div>
          <p className="text-base font-medium">{customer.displayName}</p>
          {customer.code && <p className="text-xs text-text-muted">{customer.code}</p>}
          <dl className="mt-3 space-y-2 text-xs">
            <Row label="Telefone" value={customer.primaryPhone ?? conversation.contact.phoneE164} />
            {customer.primaryEmail && <Row label="E-mail" value={customer.primaryEmail} />}
            <Row label="Status" value={customer.status} />
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={`/customers/${customer.id}`}
              className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700 hover:bg-brand-100 dark:bg-slate-700 dark:text-brand-300"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Abrir cadastro
            </Link>
            <LinkCustomerControl contactId={contactId} current={customer.displayName} onChanged={onChanged} />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            Contato não vinculado a um cliente.
            <p className="mt-1 font-mono">{conversation.contact.phoneE164}</p>
          </div>
          <LinkCustomerControl contactId={contactId} current={null} onChanged={onChanged} />
        </div>
      )}
    </div>
  );
}

/** Busca + vínculo manual de cliente. */
function LinkCustomerControl({
  contactId,
  current,
  onChanged,
}: {
  contactId: string;
  current: string | null;
  onChanged: () => void;
}) {
  const canLink = hasPermission('chat.send');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<WaCustomerHit[]>([]);
  const [busy, setBusy] = useState(false);

  if (!canLink) return null;

  async function doSearch() {
    if (q.trim().length < 2) return;
    setBusy(true);
    try {
      setHits(await searchCustomers(q.trim()));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.friendlyMessage : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doLink(customerId: string | null) {
    setBusy(true);
    try {
      await linkContactCustomer(contactId, customerId);
      toast.success(customerId ? 'Cliente vinculado' : 'Vínculo removido');
      setOpen(false);
      setQ('');
      setHits([]);
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.friendlyMessage : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Link2 className="mr-1 h-3.5 w-3.5" /> {current ? 'Trocar vínculo' : 'Vincular cliente'}
        </Button>
        {current && (
          <Button size="sm" variant="outline" onClick={() => doLink(null)} disabled={busy}>
            <Link2Off className="mr-1 h-3.5 w-3.5" /> Desvincular
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="w-full rounded-lg border border-slate-200 p-2 dark:border-slate-700">
      <div className="flex gap-1">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void doSearch())}
          placeholder="Nome, código ou documento…"
          className="text-xs"
        />
        <Button size="sm" onClick={doSearch} disabled={busy}>
          <Search className="h-3.5 w-3.5" />
        </Button>
      </div>
      <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto">
        {hits.map((h) => (
          <li key={h.id}>
            <button
              onClick={() => doLink(h.id)}
              disabled={busy}
              className="w-full rounded p-1.5 text-left text-xs hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-slate-700"
            >
              <span className="font-medium">{h.displayName}</span>
              {h.code && <span className="ml-1 text-text-muted">· {h.code}</span>}
              {h.primaryPhone && <span className="block text-text-muted">{h.primaryPhone}</span>}
            </button>
          </li>
        ))}
      </ul>
      <button className="mt-1 text-xs text-text-muted hover:underline" onClick={() => setOpen(false)}>
        cancelar
      </button>
    </div>
  );
}

// ============================ CONEXÃO ============================

function ConexaoTab({ contracts, hasCustomer }: { contracts: WaContractCtx[]; hasCustomer: boolean }) {
  const [sel, setSel] = useState(0);
  if (!hasCustomer) return <Hint text="Vincule um cliente para ver a conexão." />;
  if (!contracts.length) return <Hint text="Cliente sem contratos." />;
  const contract = contracts[Math.min(sel, contracts.length - 1)];

  return (
    <div className="space-y-3">
      {contracts.length > 1 && (
        <select
          value={sel}
          onChange={(e) => setSel(Number(e.target.value))}
          className="w-full rounded-md border border-slate-300 p-1.5 text-xs dark:border-slate-600 dark:bg-slate-700"
        >
          {contracts.map((c, i) => (
            <option key={c.id} value={i}>
              {c.code ?? c.id.slice(0, 8)} · {c.planName ?? `${c.bandwidthMbps} Mbps`} · {c.status}
            </option>
          ))}
        </select>
      )}
      <ContractConnection contract={contract} />
    </div>
  );
}

function ContractConnection({ contract }: { contract: WaContractCtx }) {
  const session = useSWR<ContractSession>(
    radacctApi.sessionPath(contract.id),
    () => radacctApi.session(contract.id),
    { refreshInterval: 30000 },
  );
  const tr = useSWR(tr069Api.byContractPath(contract.id), () => tr069Api.byContract(contract.id), {
    refreshInterval: 30000,
  });
  const [busy, setBusy] = useState(false);
  const canWrite = hasPermission('contracts.write');

  const s = session.data;
  const d = tr.data?.latest ?? null;
  const rx = d?.rxPower ?? null;
  const rxHealth = classifyRxPower(rx);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      void session.mutate();
      void tr.mutate();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.friendlyMessage : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-xs">
      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <div className="mb-2 flex items-center gap-2 font-semibold">
          <Activity className="h-4 w-4" />
          Conexão
          <span
            className={`ml-auto rounded px-2 py-0.5 ${
              s?.online
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
            }`}
          >
            {s?.online ? 'Online' : 'Offline'}
          </span>
        </div>
        <dl className="space-y-1">
          <Row label="IP" value={s?.framedIp ?? '—'} />
          <Row label="Tempo online" value={s?.online ? fmtUptime(s.uptimeSeconds) : '—'} />
          <Row label="Download / Upload" value={`${fmtBytes(s?.inputBytes)} / ${fmtBytes(s?.outputBytes)}`} />
          <Row label="Plano" value={contract.planName ?? `${contract.bandwidthMbps} Mbps`} />
        </dl>
      </div>

      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <div className="mb-2 flex items-center gap-2 font-semibold">
          <Wifi className="h-4 w-4" /> Diagnóstico
          {tr.data?.manufacturer && (
            <span className="ml-auto text-text-muted">{tr.data.manufacturer}</span>
          )}
        </div>
        {d ? (
          <dl className="space-y-1">
            <div className="flex justify-between">
              <dt className="text-text-muted">Sinal óptico (RX)</dt>
              <dd className={rxClass(rxHealth)}>{rx !== null ? `${rx} dBm` : '—'}</dd>
            </div>
            <Row label="TX" value={d.txPower !== null ? `${d.txPower} dBm` : '—'} />
            <Row
              label="Clientes Wi-Fi"
              value={`${(d.wifiClients24 ?? 0) + (d.wifiClients5 ?? 0)}`}
            />
            {d.wifiWorstRssi !== null && <Row label="Pior RSSI" value={`${d.wifiWorstRssi} dBm`} />}
            {tr.data?.lastInformAt && (
              <Row label="Último contato" value={new Date(tr.data.lastInformAt).toLocaleString()} />
            )}
          </dl>
        ) : (
          <p className="text-text-muted">Sem diagnóstico do CPE ainda.</p>
        )}
      </div>

      {/* Ações */}
      <div className="flex flex-wrap gap-2">
        {tr.data?.id && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => act(() => tr069Api.refresh(tr.data!.id), 'Diagnóstico solicitado')}
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Coletar
          </Button>
        )}
        {canWrite && contract.status !== 'ACTIVE' && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => act(() => contractsApi.trustExtend(contract.id, 5), 'Religue de confiança aplicado (5 dias)')}
          >
            <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Religue confiança
          </Button>
        )}
        {canWrite && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => act(() => contractsApi.kick(contract.id), 'Cliente desconectado')}
          >
            <Unplug className="mr-1 h-3.5 w-3.5" /> Desconectar
          </Button>
        )}
        <Link
          href={`/contracts/${contract.id}`}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-brand-700 hover:underline dark:text-brand-300"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Contrato
        </Link>
      </div>
      {contract.trustExtensionUntil && (
        <p className="text-amber-600 dark:text-amber-400">
          Religue de confiança até {new Date(contract.trustExtensionUntil).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

// ============================ FINANCEIRO ============================

function FinanceiroTab({
  contracts,
  conversationId,
  hasCustomer,
  onSent,
}: {
  contracts: WaContractCtx[];
  conversationId: string;
  hasCustomer: boolean;
  onSent: () => void;
}) {
  const [sel, setSel] = useState(0);
  if (!hasCustomer) return <Hint text="Vincule um cliente para ver o financeiro." />;
  if (!contracts.length) return <Hint text="Cliente sem contratos." />;
  const contract = contracts[Math.min(sel, contracts.length - 1)];

  return (
    <div className="space-y-3">
      {contracts.length > 1 && (
        <select
          value={sel}
          onChange={(e) => setSel(Number(e.target.value))}
          className="w-full rounded-md border border-slate-300 p-1.5 text-xs dark:border-slate-600 dark:bg-slate-700"
        >
          {contracts.map((c, i) => (
            <option key={c.id} value={i}>
              {c.code ?? c.id.slice(0, 8)} · {c.status}
            </option>
          ))}
        </select>
      )}
      <ContractFinance contractId={contract.id} conversationId={conversationId} onSent={onSent} />
    </div>
  );
}

function ContractFinance({
  contractId,
  conversationId,
  onSent,
}: {
  contractId: string;
  conversationId: string;
  onSent: () => void;
}) {
  const inv = useSWR(contractInvoicesApi.byContractPath(contractId), () =>
    contractInvoicesApi.byContract(contractId),
  );
  const tenant = useTenantConfig();
  const isBR = (tenant?.tenant?.country ?? null) === 'BR';
  const canEfi = isBR && hasPermission('efi.charges.write');
  const canBtg = isBR && hasPermission('btg.charges.write');
  const [busyId, setBusyId] = useState<string | null>(null);

  const invoices = (inv.data?.data ?? []) as ContractInvoice[];
  const open = invoices.filter((i) => i.status === 'OPEN' || i.status === 'OVERDUE');
  const paid = invoices.filter((i) => i.status === 'PAID').slice(0, 5);

  async function sendCharge(invoice: ContractInvoice, provider: 'efi' | 'btg', kind: string) {
    setBusyId(invoice.id);
    try {
      const charge =
        provider === 'efi'
          ? await efiApi.generate(invoice.id, { kind: kind as 'PIX' | 'BOLIX' })
          : await btgApi.generate(invoice.id, { kind: kind as 'PIX' | 'BOLETO' });
      const text = buildChargeMessage(charge, invoice);
      if (!text) {
        toast.error('Cobrança gerada mas sem dados pra enviar.');
        return;
      }
      await sendMessage(conversationId, text);
      toast.success('Cobrança enviada na conversa');
      onSent();
      void inv.mutate();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.friendlyMessage : (e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (inv.isLoading)
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );

  return (
    <div className="space-y-3 text-xs">
      <section>
        <h4 className="mb-1 font-semibold">Em aberto ({open.length})</h4>
        {open.length === 0 ? (
          <p className="text-text-muted">Nenhuma fatura em aberto.</p>
        ) : (
          <ul className="space-y-2">
            {open.map((i) => (
              <li key={i.id} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                <div className="flex justify-between">
                  <span className="font-medium">{fmtMoney(i.amount)}</span>
                  <span className={i.status === 'OVERDUE' ? 'text-rose-600' : 'text-text-muted'}>
                    vence {new Date(i.dueDate).toLocaleDateString()}
                  </span>
                </div>
                {(canEfi || canBtg) && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {canEfi && (
                      <>
                        <ChargeBtn busy={busyId === i.id} onClick={() => sendCharge(i, 'efi', 'PIX')} label="Pix" />
                        <ChargeBtn busy={busyId === i.id} onClick={() => sendCharge(i, 'efi', 'BOLIX')} label="Boleto" />
                      </>
                    )}
                    {!canEfi && canBtg && (
                      <>
                        <ChargeBtn busy={busyId === i.id} onClick={() => sendCharge(i, 'btg', 'PIX')} label="Pix" />
                        <ChargeBtn busy={busyId === i.id} onClick={() => sendCharge(i, 'btg', 'BOLETO')} label="Boleto" />
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {paid.length > 0 && (
        <section>
          <h4 className="mb-1 font-semibold">Pagas (recentes)</h4>
          <ul className="space-y-1">
            {paid.map((i) => (
              <li key={i.id} className="flex justify-between text-text-muted">
                <span>{fmtMoney(i.amount)}</span>
                <span>{i.paidAt ? new Date(i.paidAt).toLocaleDateString() : '✓'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ChargeBtn({ busy, onClick, label }: { busy: boolean; onClick: () => void; label: string }) {
  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={onClick}>
      <Zap className="mr-1 h-3 w-3" /> {label}
    </Button>
  );
}

// ============================ helpers ============================

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-text-muted">{label}</dt>
      <dd className="truncate text-right">{value}</dd>
    </div>
  );
}

function Hint({ text }: { text: string }) {
  return <p className="py-6 text-center text-xs text-text-muted">{text}</p>;
}

function rxClass(h: ReturnType<typeof classifyRxPower>): string {
  if (h === 'OK') return 'text-emerald-600 dark:text-emerald-400';
  if (h === 'WARNING') return 'text-amber-600 dark:text-amber-400';
  if (h === 'CRITICAL') return 'text-rose-600 dark:text-rose-400';
  return 'text-text-muted';
}

function fmtBytes(n: number | undefined | null): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}

function fmtUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function fmtMoney(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Monta a mensagem de cobrança pro WhatsApp (Pix copia-e-cola ou boleto). */
function buildChargeMessage(
  charge: { pixCopiaECola?: string | null; pixEmv?: string | null; barcode?: string | null; digitableLine?: string | null; pdfUrl?: string | null; paymentLink?: string | null },
  invoice: ContractInvoice,
): string | null {
  const pix = charge.pixCopiaECola ?? charge.pixEmv ?? null;
  const line = charge.digitableLine ?? charge.barcode ?? null;
  const val = fmtMoney(invoice.amount);
  const due = new Date(invoice.dueDate).toLocaleDateString('pt-BR');
  if (pix) {
    return `Olá! Segue o Pix da sua fatura de ${val} (vencimento ${due}).\n\nCopie e cole no app do banco:\n\n${pix}`;
  }
  if (line) {
    let msg = `Olá! Segue o boleto da sua fatura de ${val} (vencimento ${due}).\n\nLinha digitável:\n${line}`;
    if (charge.pdfUrl || charge.paymentLink) msg += `\n\nPDF: ${charge.pdfUrl ?? charge.paymentLink}`;
    return msg;
  }
  if (charge.paymentLink) return `Olá! Link de pagamento da fatura de ${val} (venc. ${due}):\n${charge.paymentLink}`;
  return null;
}

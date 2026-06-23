'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { portalApi, portalToken, date, money, HubApiError } from '@/lib/api';
import { Badge, Card } from '@/components/ui';

function PixModal({ pix, onClose }: { pix: any; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-lg bg-white p-5 text-center shadow-xl">
        <h2 className="text-lg font-semibold">Pague com Pix</h2>
        <p className="mb-3 text-sm text-slate-500">{money(pix.amountCents, pix.currency)}</p>
        {pix.qrImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pix.qrImage} alt="QR Code Pix" className="mx-auto mb-3 h-48 w-48" />
        )}
        {pix.pixCopiaECola && (
          <>
            <textarea readOnly value={pix.pixCopiaECola} className="h-20 w-full rounded-md border border-slate-300 p-2 text-xs" />
            <button
              onClick={() => { void navigator.clipboard?.writeText(pix.pixCopiaECola); setCopied(true); }}
              className="mt-2 w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
            >
              {copied ? 'Copiado ✓' : 'Copiar código Pix'}
            </button>
          </>
        )}
        <p className="mt-3 text-xs text-slate-400">
          A baixa é automática ao confirmar o pagamento. Expira em {date(pix.expiresAt)}.
        </p>
        <button onClick={onClose} className="mt-3 text-sm text-slate-500 hover:underline">Fechar</button>
      </div>
    </div>
  );
}

export default function PortalHome() {
  const router = useRouter();
  const [me, setMe] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pix, setPix] = useState<any>(null);

  async function load() {
    try {
      const [m, inv] = await Promise.all([portalApi.me(), portalApi.invoices()]);
      setMe(m);
      setInvoices(inv);
    } catch (e) {
      if (e instanceof HubApiError && e.status === 401) router.replace('/portal/login');
      else setErr('Falha ao carregar.');
    }
  }
  useEffect(() => {
    if (!portalToken.get()) router.replace('/portal/login');
    else void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function flash(m: string) {
    setMsg(m);
    setTimeout(() => setMsg(null), 6000);
  }

  async function trustUnlock() {
    setBusy(true);
    try {
      const r = await portalApi.trustUnlock();
      flash(`Desbloqueado em confiança até ${date(r.grantedUntil)}. Regularize o pagamento.`);
      await load();
    } catch (e) {
      flash(e instanceof HubApiError ? e.message : 'Falha no desbloqueio.');
    } finally {
      setBusy(false);
    }
  }

  async function pay(inv: any) {
    setBusy(true);
    try {
      const charge = await portalApi.pay(inv.id, 'PIX');
      setPix({ ...charge, amountCents: inv.amountCents, currency: inv.currency });
    } catch (e) {
      // EFI não configurada → mensagem orientando pagamento por fora.
      flash(e instanceof HubApiError ? e.message : 'Pagamento indisponível.');
    } finally {
      setBusy(false);
    }
  }

  if (!me) return <main className="px-6 py-8 text-sm text-slate-500">{err ?? 'Carregando…'}</main>;

  const lic = me.licensee;
  const tu = me.trustUnlock;

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{lic.name}</h1>
          <p className="text-sm text-slate-500">Central do cliente NetX</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/portal/ajuda" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
            Central de ajuda
          </Link>
          <button
            onClick={() => { portalToken.clear(); router.replace('/portal/login'); }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          >
            Sair
          </button>
        </div>
      </header>

      {msg && <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p>}

      {pix && <PixModal pix={pix} onClose={() => { setPix(null); void load(); }} />}

      {/* Situação */}
      <div className="mb-5">
        {me.delinquent ? (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4">
            <p className="font-medium text-red-800">Acesso bloqueado por fatura em atraso</p>
            <p className="mt-1 text-sm text-red-700">
              Regularize o pagamento para reativar o painel. A rede dos seus assinantes não é afetada.
            </p>
            {tu?.active ? (
              <p className="mt-2 text-sm text-amber-700">
                Desbloqueio em confiança ativo até {date(tu.grantedUntil)}.
              </p>
            ) : tu?.remaining > 0 ? (
              <button
                onClick={trustUnlock}
                disabled={busy}
                className="mt-3 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Desbloquear em confiança ({tu.days} dias · {tu.remaining} restante)
              </button>
            ) : (
              <p className="mt-2 text-sm text-red-700">Limite de desbloqueios em confiança atingido.</p>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <p className="font-medium text-emerald-800">Tudo em dia ✓</p>
            <p className="text-sm text-emerald-700">Sua licença está ativa.</p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-5">
        <Card title="Plano">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-slate-500">Plano</dt><dd className="text-right">{lic.plan}</dd>
            <dt className="text-slate-500">Preço por contrato</dt>
            <dd className="text-right">{money(lic.pricePerContractCents, lic.currency)}</dd>
            <dt className="text-slate-500">Dia de vencimento</dt><dd className="text-right">dia {lic.billingDay}</dd>
          </dl>
        </Card>

        <Card title="Suas instâncias">
          {me.instances.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma instância.</p>
          ) : (
            <table className="min-w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {me.instances.map((i: any) => (
                  <tr key={i.id}>
                    <td className="py-2">{i.label ?? i.id.slice(0, 8)}</td>
                    <td className="py-2 text-xs text-slate-500">{i.lastActiveContracts ?? '—'} contratos · {date(i.lastHeartbeatAt)}</td>
                    <td className="py-2 text-right"><Badge status={i.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Faturas">
          {invoices.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma fatura.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr><th className="py-1 text-left">Período</th><th className="text-left">Venc.</th><th className="text-right">Valor</th><th className="text-left">Situação</th><th></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="py-2">{date(inv.periodStart)}</td>
                    <td className="py-2">{date(inv.dueDate)}</td>
                    <td className="py-2 text-right">{money(inv.amountCents, inv.currency)}</td>
                    <td className="py-2"><Badge status={inv.status} /></td>
                    <td className="py-2 text-right">
                      {inv.status !== 'PAID' && inv.status !== 'CANCELLED' && (
                        <button onClick={() => pay(inv)} disabled={busy} className="text-xs text-blue-700 hover:underline disabled:opacity-50">
                          Pagar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </main>
  );
}

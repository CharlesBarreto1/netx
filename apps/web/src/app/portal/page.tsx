'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import {
  type PortalBilling,
  type PortalContract,
  type PortalMe,
  type PortalSession,
  type PortalWifiStatus,
  PortalApiError,
  getPortalSession,
  portalApi,
} from '@/lib/portal-api';

/**
 * Portal /portal — dashboard read-only do cliente.
 *
 * Mostra:
 *   - Saudação + dados básicos (nome, CI/RUC, email)
 *   - Contratos ativos com mensalidade e velocidade
 *   - Faturas recentes (mensalidades + cobranças avulsas) com status
 *
 * Phase 2: pagar via PIX/boleto, mudar senha do portal, abrir chamado.
 */
export default function PortalDashboardPage() {
  const t = useTranslations('portal');
  const router = useRouter();
  const [session, setSession] = useState<PortalSession | null>(null);
  const [me, setMe] = useState<PortalMe | null>(null);
  const [contracts, setContracts] = useState<PortalContract[]>([]);
  const [billing, setBilling] = useState<PortalBilling | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const s = getPortalSession();
    if (!s) {
      router.replace('/portal/login');
      return;
    }
    setSession(s);
    Promise.all([portalApi.me(), portalApi.contracts(), portalApi.invoices()])
      .then(([meRes, contractsRes, billingRes]) => {
        setMe(meRes);
        setContracts(contractsRes);
        setBilling(billingRes);
      })
      .catch(() => {
        // 401 já redireciona via portal-api; pra outros erros caímos pra
        // login pra ser conservador.
        portalApi.logout();
        router.replace('/portal/login');
      })
      .finally(() => setLoading(false));
  }, [router]);

  if (!session || loading) {
    return (
      <main className="min-h-screen flex items-center justify-center text-sm text-slate-500">
        {t('dashboard.loading')}
      </main>
    );
  }

  const formatMoney = (n: number) =>
    new Intl.NumberFormat(session.tenant.locale ?? 'es-PY', {
      style: 'currency',
      currency: session.tenant.currency,
      maximumFractionDigits: session.tenant.currency === 'PYG' ? 0 : 2,
    }).format(n);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(session.tenant.locale ?? 'es-PY');

  function logout() {
    portalApi.logout();
    router.replace('/portal/login');
  }

  const allItems = [
    ...(billing?.invoices ?? []),
    ...(billing?.charges ?? []),
  ].sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));

  const openTotal = allItems
    .filter((i) => i.status === 'OPEN' || i.status === 'OVERDUE')
    .reduce((s, i) => s + i.amount, 0);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between border-b border-slate-200 dark:border-slate-700 pb-4">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {session.tenant.name}
          </p>
          <h1 className="text-2xl font-bold tracking-tight">
            {t('dashboard.greeting', { name: session.customer.displayName })}
          </h1>
          {me?.taxId && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {me.taxIdType}: {me.taxId}
            </p>
          )}
        </div>
        <button
          onClick={logout}
          className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
        >
          {t('dashboard.logout')}
        </button>
      </header>

      {/* Saldo aberto */}
      {openTotal > 0 && (
        <section className="rounded-lg border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
            {t('dashboard.balanceDue')}
          </p>
          <p className="mt-1 text-3xl font-bold text-amber-900 dark:text-amber-200">
            {formatMoney(openTotal)}
          </p>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
            {t('dashboard.balanceDueHint')}
          </p>
        </section>
      )}

      {/* Contratos */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
          {t('contract.sectionTitle')}
        </h2>
        {contracts.length === 0 ? (
          <p className="text-sm text-slate-500">{t('contract.empty')}</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {contracts.map((c) => (
              <div
                key={c.id}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {c.code ?? `#${c.id.slice(0, 8)}`}
                  </span>
                  <StatusBadge status={c.status} />
                </div>
                <p className="mt-2 text-2xl font-bold">{c.bandwidthMbps} Mbps</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {t('contract.monthlyLine', {
                    amount: formatMoney(c.monthlyValue),
                    day: c.dueDay,
                  })}
                </p>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {c.installationAddress}
                </p>
                <ContractWifiManager contractId={c.id} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Faturas */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
          {t('invoice.sectionTitle')}
        </h2>
        {allItems.length === 0 ? (
          <p className="text-sm text-slate-500">{t('invoice.empty')}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2">{t('invoice.colDescription')}</th>
                  <th className="px-3 py-2">{t('invoice.colDueDate')}</th>
                  <th className="px-3 py-2 text-right">{t('invoice.colAmount')}</th>
                  <th className="px-3 py-2">{t('invoice.colStatus')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {allItems.map((i) => (
                  <tr key={`${i.kind}-${i.id}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{i.description}</div>
                      <div className="text-xs text-slate-500">
                        {i.code ??
                          (i.kind === 'INVOICE'
                            ? t('invoice.kindInvoice')
                            : t('invoice.kindCharge'))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {formatDate(i.dueDate)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {formatMoney(i.amount)}
                    </td>
                    <td className="px-3 py-2">
                      <InvoiceStatusBadge status={i.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="text-center text-xs text-slate-400 pt-4">
        {t('dashboard.footer', { provider: session.tenant.name })}
      </footer>
    </main>
  );
}

/**
 * Self-service de Wi-Fi no card do contrato. O assinante vê o SSID atual e
 * troca nome/contraseña — dispara SET_PARAMS via TR-069 no backend. Some quando
 * o contrato não tem ONT TR-069 vinculada (nada pra aplicar).
 */
function ContractWifiManager({ contractId }: { contractId: string }) {
  const t = useTranslations('portal');
  const [wifi, setWifi] = useState<PortalWifiStatus | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  // Só sinaliza resultado (aplicado/falhou) de uma troca feita nesta sessão —
  // o status traz a última task TR-069 de qualquer origem, não só do Wi-Fi.
  const [touched, setTouched] = useState(false);

  const refresh = useCallback(
    () => portalApi.contractWifi(contractId).then(setWifi).catch(() => {}),
    [contractId],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Enquanto a última troca aplica, faz polling até DONE/FAILED (teto 2 min).
  useEffect(() => {
    if (!applying) return;
    const startedAt = Date.now();
    const h = setInterval(async () => {
      try {
        const w = await portalApi.contractWifi(contractId);
        setWifi(w);
        const s = w.lastTask?.status;
        if (s === 'DONE' || s === 'FAILED' || Date.now() - startedAt > 120_000) {
          setApplying(false);
        }
      } catch {
        /* mantém o polling; erro transitório */
      }
    }, 5000);
    return () => clearInterval(h);
  }, [applying, contractId]);

  if (!wifi || !wifi.hasTr069Device) return null;

  return (
    <div className="mt-3 border-t border-slate-100 dark:border-slate-700 pt-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-slate-400">Wi-Fi</p>
          <p className="truncate text-sm font-medium">{wifi.ssid ?? '—'}</p>
        </div>
        <button
          type="button"
          disabled={applying}
          onClick={() => setModalOpen(true)}
          className="shrink-0 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-700"
        >
          {t('wifi.change')}
        </button>
      </div>

      {applying && (
        <p className="mt-2 text-xs text-blue-600 dark:text-blue-400">
          {t('wifi.applying')}
        </p>
      )}
      {touched && !applying && wifi.lastTask?.status === 'DONE' && (
        <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
          {t('wifi.updated')}
        </p>
      )}
      {touched && !applying && wifi.lastTask?.status === 'FAILED' && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          {t('wifi.failed')}
        </p>
      )}

      {modalOpen && (
        <WifiChangeModal
          contractId={contractId}
          initialSsid={wifi.ssid ?? ''}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            setTouched(true);
            setApplying(true);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function generateWifiPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  const arr = new Uint8Array(10);
  crypto.getRandomValues(arr);
  for (let i = 0; i < arr.length; i++) out += alphabet[arr[i] % alphabet.length];
  return out;
}

function WifiChangeModal({
  contractId,
  initialSsid,
  onClose,
  onSaved,
}: {
  contractId: string;
  initialSsid: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('portal');
  const tCommon = useTranslations('common');
  const [ssid, setSsid] = useState(initialSsid);
  const [pwd, setPwd] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (ssid.trim().length < 1 || ssid.length > 32) {
      setError(t('wifi.errorSsid'));
      return;
    }
    if (pwd.length < 8 || pwd.length > 63) {
      setError(t('wifi.errorPassword'));
      return;
    }
    setSaving(true);
    try {
      await portalApi.updateContractWifi(contractId, { ssid: ssid.trim(), wifiPassword: pwd });
      onSaved();
    } catch (err) {
      const msg =
        err instanceof PortalApiError ? err.detail : (err as Error).message;
      setError(msg);
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-xl bg-white p-5 shadow-xl dark:bg-slate-800 sm:rounded-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold">{t('wifi.modalTitle')}</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {t('wifi.modalHint')}
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="portal-ssid">
              {t('wifi.ssidLabel')}
            </label>
            <input
              id="portal-ssid"
              value={ssid}
              onChange={(e) => setSsid(e.target.value)}
              maxLength={32}
              required
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="portal-pwd">
              {t('wifi.passwordLabel')}
            </label>
            <div className="flex gap-2">
              <input
                id="portal-pwd"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                minLength={8}
                maxLength={63}
                required
                placeholder={t('wifi.passwordPlaceholder')}
                className="block w-full flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900"
              />
              <button
                type="button"
                onClick={() => setPwd(generateWifiPassword())}
                className="shrink-0 rounded-md border border-slate-300 px-2.5 text-xs font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
              >
                {t('wifi.generate')}
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              {tCommon('cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? tCommon('saving') : tCommon('save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: PortalContract['status'] }) {
  const t = useTranslations('portal');
  const cls: Record<PortalContract['status'], string> = {
    ACTIVE: 'bg-emerald-100 text-emerald-800',
    SUSPENDED: 'bg-amber-100 text-amber-800',
    CANCELLED: 'bg-slate-200 text-slate-700',
  };
  const known = ['ACTIVE', 'SUSPENDED', 'CANCELLED'];
  const label = known.includes(status)
    ? t(`status.contract.${status}`)
    : status;
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls[status] ?? 'bg-slate-200 text-slate-700'}`}
    >
      {label}
    </span>
  );
}

function InvoiceStatusBadge({
  status,
}: {
  status: 'OPEN' | 'PAID' | 'OVERDUE' | 'CANCELLED';
}) {
  const t = useTranslations('portal');
  const cls: Record<string, string> = {
    OPEN: 'bg-blue-100 text-blue-800',
    PAID: 'bg-emerald-100 text-emerald-800',
    OVERDUE: 'bg-red-100 text-red-800',
    CANCELLED: 'bg-slate-200 text-slate-700',
  };
  const known = ['OPEN', 'PAID', 'OVERDUE', 'CANCELLED'];
  const label = known.includes(status) ? t(`status.invoice.${status}`) : status;
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls[status] ?? 'bg-slate-200 text-slate-700'}`}
    >
      {label}
    </span>
  );
}

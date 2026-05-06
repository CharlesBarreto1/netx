'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  type PortalBilling,
  type PortalContract,
  type PortalMe,
  type PortalSession,
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
        Cargando…
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
            Hola, {session.customer.displayName}
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
          Cerrar sesión
        </button>
      </header>

      {/* Saldo aberto */}
      {openTotal > 0 && (
        <section className="rounded-lg border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
            Saldo pendiente
          </p>
          <p className="mt-1 text-3xl font-bold text-amber-900 dark:text-amber-200">
            {formatMoney(openTotal)}
          </p>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
            Acercate al punto de cobro o pagá según las instrucciones de tu
            proveedor.
          </p>
        </section>
      )}

      {/* Contratos */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
          Mis servicios
        </h2>
        {contracts.length === 0 ? (
          <p className="text-sm text-slate-500">Sin contratos.</p>
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
                  {formatMoney(c.monthlyValue)} / mes · vence el día {c.dueDay}
                </p>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {c.installationAddress}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Faturas */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
          Mis facturas
        </h2>
        {allItems.length === 0 ? (
          <p className="text-sm text-slate-500">Sin facturas.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2">Descripción</th>
                  <th className="px-3 py-2">Vencimiento</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                  <th className="px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {allItems.map((i) => (
                  <tr key={`${i.kind}-${i.id}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{i.description}</div>
                      <div className="text-xs text-slate-500">
                        {i.code ?? (i.kind === 'INVOICE' ? 'Mensualidad' : 'Cargo puntual')}
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
        Portal NetX — sólo lectura. Para cambios contactá a {session.tenant.name}.
      </footer>
    </main>
  );
}

function StatusBadge({ status }: { status: PortalContract['status'] }) {
  const map: Record<PortalContract['status'], { label: string; cls: string }> = {
    ACTIVE: { label: 'Activo', cls: 'bg-emerald-100 text-emerald-800' },
    SUSPENDED: { label: 'Suspendido', cls: 'bg-amber-100 text-amber-800' },
    CANCELLED: { label: 'Cancelado', cls: 'bg-slate-200 text-slate-700' },
  };
  const m = map[status];
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${m.cls}`}>
      {m.label}
    </span>
  );
}

function InvoiceStatusBadge({
  status,
}: {
  status: 'OPEN' | 'PAID' | 'OVERDUE' | 'CANCELLED';
}) {
  const map: Record<string, { label: string; cls: string }> = {
    OPEN: { label: 'Pendiente', cls: 'bg-blue-100 text-blue-800' },
    PAID: { label: 'Pagado', cls: 'bg-emerald-100 text-emerald-800' },
    OVERDUE: { label: 'Vencido', cls: 'bg-red-100 text-red-800' },
    CANCELLED: { label: 'Anulado', cls: 'bg-slate-200 text-slate-700' },
  };
  const m = map[status];
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${m.cls}`}>
      {m.label}
    </span>
  );
}

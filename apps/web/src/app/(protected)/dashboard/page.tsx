'use client';

/**
 * Dashboard operacional — "cockpit" com 3 lentes por papel (Operador / NOC /
 * Financeiro) que reconfiguram a MESMA base (design_handoff_netx_shell §3-7).
 * Não são apps separados: a lente troca título, KPIs e painéis.
 *
 * DADOS: híbrido. Os blocos com endpoint real são cabeados via `useDashboardData`
 * (assinantes, inadimplência, recebíveis, MRR, incidentes, O.S, OLTs, faturas).
 * Os blocos SEM fonte ainda — telemetria de NOC (tráfego/latência/uptime/saúde
 * por região), aging por faixa e churn — seguem em mock, marcados com o selo
 * "exemplo" para não enganar o operador. Ver `use-dashboard-data.ts`.
 */

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { BarChart, HealthDonut, LineChart, Progress, Sparkline } from '@/components/dashboard/charts';
import { cn } from '@/lib/cn';
import { formatDate, formatMoney, relativeTime } from '@/lib/format';
import { getSession } from '@/lib/session';

import { useDashboardData, type DashboardLive, type IncidentItem, type RecentInvoice } from './use-dashboard-data';

type Lens = 'operador' | 'noc' | 'financeiro';
const LENSES: Lens[] = ['operador', 'noc', 'financeiro'];
const STORAGE_KEY = 'netx.ui.lens';

interface Kpi {
  label: string;
  value: string;
  delta: string;
  deltaTone: 'success' | 'warning' | 'danger' | 'muted';
  sub: string;
  dot: string; // classe de cor do dot
  example?: boolean; // dado mock (sem fonte real ainda)
}

const TONE_CHIP: Record<Kpi['deltaTone'], string> = {
  success: 'text-success bg-success-muted',
  warning: 'text-warning bg-warning-muted',
  danger: 'text-danger bg-danger-muted',
  muted: 'text-text-muted bg-surface-hover',
};

// ── Selo "exemplo" para blocos ainda sem fonte real ───────────────────────
function MockBadge() {
  return (
    <span
      title="Dado de exemplo — sem fonte real ainda"
      className="rounded bg-surface-hover px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-text-disabled"
    >
      exemplo
    </span>
  );
}

// ── Mocks de fallback (blocos sem endpoint ou enquanto carrega) ────────────
const REGIONS = [
  { name: 'Asunción Centro', pct: 99.8, tone: 'text-success' },
  { name: 'Asunción Norte', pct: 97.4, tone: 'text-warning' },
  { name: 'Central · Luque', pct: 99.9, tone: 'text-success' },
  { name: 'Encarnación', pct: 94.1, tone: 'text-danger' },
];

const ELEMENTS = [
  { name: 'OLT-ASU-01', vendor: 'Huawei', type: 'OLT', status: 'down', load: 0, uptime: '—' },
  { name: 'SW-CORE-02', vendor: 'Juniper', type: 'Switch', status: 'warn', load: 88, uptime: '142d' },
  { name: 'RTR-BORDER-01', vendor: 'Juniper', type: 'Router', status: 'ok', load: 41, uptime: '301d' },
  { name: 'OLT-LUQ-03', vendor: 'Parks', type: 'OLT', status: 'ok', load: 63, uptime: '88d' },
  { name: 'SW-DIST-07', vendor: 'Mikrotik', type: 'Switch', status: 'ok', load: 52, uptime: '210d' },
];

const AGING = [
  { label: '1–15d', pct: 41, value: 'R$ 89k', tone: 'text-warning' },
  { label: '16–30d', pct: 28, value: 'R$ 61k', tone: 'text-warning' },
  { label: '31–60d', pct: 20, value: 'R$ 44k', tone: 'text-warning' },
  { label: '+60d', pct: 11, value: 'R$ 24k', tone: 'text-danger' },
];

const SEV_TONE: Record<string, string> = {
  P1: 'text-danger bg-danger-muted',
  P2: 'text-warning bg-warning-muted',
  P3: 'text-text-muted bg-surface-hover',
};
const STATUS_TONE: Record<string, string> = {
  success: 'text-success bg-success-muted',
  danger: 'text-danger bg-danger-muted',
  warning: 'text-warning bg-warning-muted',
  muted: 'text-text-muted bg-surface-hover',
};
const DOT_STATUS: Record<string, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  down: 'bg-danger',
};

// ── Helpers de severidade / status (mapeiam enums do back → tom visual) ────
function sevTone(severity: string): string {
  const s = severity.toUpperCase();
  if (s.includes('CRIT') || s === 'P1' || s === 'HIGH') return 'text-danger bg-danger-muted';
  if (s.includes('MAJOR') || s === 'P2' || s === 'MEDIUM' || s === 'WARN') return 'text-warning bg-warning-muted';
  return 'text-text-muted bg-surface-hover';
}
function sevIsDanger(severity: string): boolean {
  const s = severity.toUpperCase();
  return s.includes('CRIT') || s === 'P1' || s === 'HIGH';
}

const INVOICE_STATUS: Record<string, { label: string; tone: keyof typeof STATUS_TONE }> = {
  PAID: { label: 'Pago', tone: 'success' },
  OVERDUE: { label: 'Atraso', tone: 'danger' },
  OPEN: { label: 'Aberta', tone: 'muted' },
  CANCELLED: { label: 'Cancelada', tone: 'muted' },
};

export default function DashboardPage() {
  const t = useTranslations('dashboardCockpit');
  const [lens, setLens] = useState<Lens>('operador');
  const live = useDashboardData(lens);

  const session = getSession();
  const currency = session?.tenant.currency ?? 'BRL';
  const tenantName = session?.tenant.name ?? 'NetX';

  useEffect(() => {
    const s = localStorage.getItem(STORAGE_KEY) as Lens | null;
    if (s && LENSES.includes(s)) setLens(s);
  }, []);

  const changeLens = (l: Lens) => {
    setLens(l);
    localStorage.setItem(STORAGE_KEY, l);
  };

  const moneyShort = (v?: number) => formatMoney(v ?? 0, currency, { short: true });
  const money = (v?: number) => formatMoney(v ?? 0, currency);
  const nf = (n?: number) => (n ?? 0).toLocaleString('pt-BR');

  const kpis = buildKpis(lens, live, { moneyShort, money, nf });

  return (
    <div className="mx-auto w-full max-w-[1180px]">
      {/* Header + lens switcher */}
      <div className="flex flex-wrap items-end justify-between gap-3 pb-5">
        <div>
          <div className="text-xs text-text-subtle">{tenantName} / {t('breadcrumb')}</div>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-text-strong">
            {t(`${lens}.title`)}
          </h1>
          <p className="text-sm text-text-subtle">{t(`${lens}.subtitle`)}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xs font-semibold uppercase tracking-wider text-text-disabled">
            {t('lens')}
          </span>
          <div className="flex rounded-[10px] border border-border bg-card p-[3px]">
            {LENSES.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => changeLens(l)}
                className={cn(
                  'rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all',
                  lens === l
                    ? 'bg-surface-hover text-text-strong shadow-sm'
                    : 'text-text-subtle hover:text-text',
                )}
              >
                {t(`lensName.${l}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 pb-4 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-border bg-card p-3.5">
            <div className="flex items-center gap-1.5">
              <span className={cn('h-1.5 w-1.5 rounded-full bg-current', k.dot)} />
              <span className="truncate text-xs text-text-subtle">{k.label}</span>
              {k.example && <span className="ml-auto"><MockBadge /></span>}
            </div>
            <div className="mt-1.5 font-mono text-xl font-semibold text-text-strong">{k.value}</div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className={cn('rounded px-1 py-px font-mono text-[10px] font-semibold', TONE_CHIP[k.deltaTone])}>
                {k.delta}
              </span>
              <span className="truncate text-[10px] text-text-subtle">{k.sub}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Painéis por lente */}
      {lens === 'operador' && <OperadorPanels live={live} moneyShort={moneyShort} nf={nf} />}
      {lens === 'noc' && <NocPanels live={live} />}
      {lens === 'financeiro' && <FinanceiroPanels live={live} money={money} moneyShort={moneyShort} nf={nf} />}
    </div>
  );
}

// ── Builders de KPI (real onde há fonte; mock marcado onde não há) ─────────
interface Fmt {
  moneyShort: (v?: number) => string;
  money: (v?: number) => string;
  nf: (n?: number) => string;
}

function buildKpis(lens: Lens, live: DashboardLive, f: Fmt): Kpi[] {
  if (lens === 'operador') {
    const overdueAmount = live.finance?.overdue.amount;
    return [
      {
        label: 'Assinantes ativos',
        value: live.activeContracts != null ? f.nf(live.activeContracts) : '—',
        delta: 'ativos', deltaTone: 'success', sub: 'contratos', dot: 'text-accent',
      },
      {
        label: 'Inadimplência',
        value: overdueAmount != null ? f.moneyShort(overdueAmount) : (live.overdueCount != null ? f.nf(live.overdueCount) : '—'),
        delta: live.overdueCount != null ? `${f.nf(live.overdueCount)}` : '—',
        deltaTone: 'warning', sub: 'faturas vencidas', dot: 'text-warning',
      },
      {
        label: 'Saúde da rede', value: '99,2%', delta: 'estável', deltaTone: 'success', sub: '2.341 nós', dot: 'text-success', example: true,
      },
      {
        label: 'Incidentes',
        value: live.incidents != null ? f.nf(live.incidents.pagination?.total ?? live.incidents.data.length) : '—',
        delta: 'abertos', deltaTone: 'danger', sub: 'correlacionados', dot: 'text-danger',
        example: live.incidents == null,
      },
      {
        label: 'O.S do dia',
        value: live.serviceOrdersOpen != null ? f.nf(live.serviceOrdersOpen) : '—',
        delta: live.serviceOrdersOverdue != null ? `${f.nf(live.serviceOrdersOverdue)} venc.` : '—',
        deltaTone: 'warning', sub: 'abertas', dot: 'text-info',
      },
      {
        label: 'Recebido (mês)',
        value: f.moneyShort(live.finance?.receivedInPeriod.amount),
        delta: live.finance ? `${live.finance.receivedInPeriod.count}` : '—',
        deltaTone: 'success', sub: 'faturas pagas', dot: 'text-accent',
        example: live.finance == null,
      },
    ];
  }
  if (lens === 'financeiro') {
    const mrr = live.monthlyBaseline;
    const ticket = mrr != null && live.activeContracts ? mrr / live.activeContracts : undefined;
    return [
      { label: 'MRR', value: mrr != null ? f.moneyShort(mrr) : '—', delta: 'baseline', deltaTone: 'success', sub: '/mês', dot: 'text-accent', example: mrr == null },
      { label: 'Inadimplência', value: f.moneyShort(live.finance?.overdue.amount), delta: live.overdueCount != null ? `${f.nf(live.overdueCount)}` : '—', deltaTone: 'danger', sub: 'faturas vencidas', dot: 'text-warning', example: live.finance == null },
      { label: 'Ticket médio', value: ticket != null ? f.money(ticket) : '—', delta: 'por contrato', deltaTone: 'muted', sub: 'ativo', dot: 'text-info', example: ticket == null },
      { label: 'Recebido (mês)', value: f.moneyShort(live.finance?.receivedInPeriod.amount), delta: live.finance ? `${live.finance.receivedInPeriod.count}` : '—', deltaTone: 'success', sub: 'faturas pagas', dot: 'text-success', example: live.finance == null },
      { label: 'A receber', value: f.moneyShort(live.finance?.open.amount), delta: live.finance ? `${live.finance.open.count}` : '—', deltaTone: 'muted', sub: 'em aberto', dot: 'text-accent', example: live.finance == null },
      { label: 'Churn', value: live.churnPct != null ? `${live.churnPct.toLocaleString('pt-BR')}%` : '—', delta: 'média 12m', deltaTone: 'success', sub: 'cancelamentos', dot: 'text-success', example: live.churnPct == null },
    ];
  }
  // NOC — só Alarmes e OLTs têm fonte; o resto é telemetria sem coleta ainda.
  return [
    { label: 'Tráfego pico', value: '428,6 Gbps', delta: '+6,1%', deltaTone: 'warning', sub: 'agregado', dot: 'text-accent', example: true },
    { label: 'Elementos online', value: '2.338', delta: '3 down', deltaTone: 'danger', sub: 'de 2.341', dot: 'text-success', example: true },
    {
      label: 'Alarmes ativos',
      value: live.incidents != null ? f.nf(live.incidents.pagination?.total ?? live.incidents.data.length) : '—',
      delta: 'abertos', deltaTone: 'danger', sub: 'agora', dot: 'text-danger',
      example: live.incidents == null,
    },
    { label: 'Latência média', value: '8,4 ms', delta: '-0,6ms', deltaTone: 'success', sub: 'backbone', dot: 'text-info', example: true },
    { label: 'Uptime 30d', value: '99,94%', delta: 'SLA ok', deltaTone: 'success', sub: 'core', dot: 'text-success', example: true },
    {
      label: 'OLTs',
      value: live.oltCount != null ? f.nf(live.oltCount) : '—',
      delta: 'ativas', deltaTone: 'success', sub: 'cadastradas', dot: 'text-accent',
      example: live.oltCount == null,
    },
  ];
}

// ── Wrapper de card ───────────────────────────────────────────────────────
function Panel({
  title,
  link,
  badge,
  children,
  className,
}: {
  title: string;
  link?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-2xl border border-border bg-card p-[18px]', className)}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text">{title}</h2>
          {badge}
        </div>
        {link && (
          <span className="inline-flex items-center gap-0.5 text-xs text-accent-strong">
            {link} <ArrowRight className="h-3 w-3" />
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

// ── OPERADOR ──────────────────────────────────────────────────────────────
function OperadorPanels({ live, moneyShort, nf }: { live: DashboardLive; moneyShort: (v?: number) => string; nf: (n?: number) => string }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
        <Panel title="Saúde da rede" link="Ver topologia" badge={<MockBadge />}>
          <div className="flex items-center gap-5">
            <HealthDonut
              segments={[
                { value: 95.1, className: 'text-success' },
                { value: 3.3, className: 'text-warning' },
                { value: 1.6, className: 'text-danger' },
              ]}
              centerValue="99,2%"
              centerSub="2.341 nós"
            />
            <div className="flex-1 space-y-2.5">
              {REGIONS.map((r) => (
                <div key={r.name}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-text-muted">{r.name}</span>
                    <span className={cn('font-mono', r.tone)}>{r.pct}%</span>
                  </div>
                  <Progress value={r.pct} className={r.tone} />
                </div>
              ))}
            </div>
          </div>
        </Panel>
        <Panel title="Faturamento do mês">
          <div className="font-mono text-[27px] font-semibold text-text-strong">
            {moneyShort(live.finance?.receivedInPeriod.amount)}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded px-1 py-px text-[10px] font-semibold text-success bg-success-muted">recebido</span>
            <span className="text-xs text-text-subtle">
              Em aberto {moneyShort(live.finance?.open.amount)} · {nf(live.finance?.open.count)} faturas
            </span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Sparkline data={[40, 52, 48, 61, 58, 72, 69, 80, 84, 92]} className="text-accent" />
            <MockBadge />
          </div>
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.45fr]">
        <Panel title="Base de assinantes">
          <div className="flex gap-6">
            <div>
              <div className="font-mono text-xl font-semibold text-text-strong">{live.activeContracts != null ? nf(live.activeContracts) : '—'}</div>
              <div className="flex items-center gap-1 text-2xs text-text-subtle">
                <span className="h-2 w-2 rounded-sm bg-success" /> ativos
              </div>
            </div>
            <div>
              <div className="font-mono text-xl font-semibold text-text-strong">{live.overdueCount != null ? nf(live.overdueCount) : '—'}</div>
              <div className="flex items-center gap-1 text-2xs text-text-subtle">
                <span className="h-2 w-2 rounded-sm bg-warning" /> inadimpl.
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <LineChart
              series={[
                { data: [60, 62, 65, 64, 68, 72, 75], className: 'text-success' },
                { data: [12, 14, 13, 15, 14, 13, 12], className: 'text-warning', dashed: true },
              ]}
            />
            <MockBadge />
          </div>
        </Panel>
        <Panel title="Incidentes abertos" link="Abrir NOC" badge={live.incidents == null ? <MockBadge /> : undefined}>
          <IncidentsTable incidents={live.incidents?.data} />
        </Panel>
      </div>
    </div>
  );
}

function IncidentsTable({ incidents }: { incidents?: IncidentItem[] }) {
  const rows = incidents ?? [];
  return (
    <div className="text-xs">
      <div className="grid grid-cols-[1fr_92px_72px_64px] gap-2 border-b border-border pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-disabled">
        <span>Incidente</span>
        <span>Escopo</span>
        <span>Desde</span>
        <span>Sev</span>
      </div>
      {rows.length === 0 && (
        <div className="py-6 text-center text-text-subtle">Nenhum incidente aberto.</div>
      )}
      {rows.map((i) => (
        <div key={i.id} className="grid grid-cols-[1fr_92px_72px_64px] items-center gap-2 border-b border-border/60 py-2">
          <div className="min-w-0">
            <div className="truncate text-text">{i.scopeLabel ?? i.rootCause ?? i.scope}</div>
            <div className="font-mono text-[10px] text-text-subtle">{i.affectedCount}/{i.totalInScope} afetados</div>
          </div>
          <span className="truncate text-text-muted">{i.scope}</span>
          <span className="font-mono text-text-muted">{relativeTime(i.firstEventAt)}</span>
          <span className={cn('w-fit rounded px-1.5 py-px text-[10px] font-semibold', sevTone(i.severity))}>
            {i.severity}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── NOC ───────────────────────────────────────────────────────────────────
function NocPanels({ live }: { live: DashboardLive }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
        <Panel title="Tráfego agregado" badge={<MockBadge />}>
          <div className="mb-2 flex items-center gap-4 text-2xs text-text-subtle">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-accent" /> Ingress</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-ai" /> Egress</span>
            <span className="ml-auto font-mono text-text-muted">428,6 Gbps pico</span>
          </div>
          <LineChart
            series={[
              { data: [180, 220, 260, 320, 300, 380, 428], className: 'text-accent' },
              { data: [120, 150, 170, 210, 200, 250, 280], className: 'text-ai' },
            ]}
            height={140}
          />
        </Panel>
        <Panel title="Alarmes ativos" badge={live.incidents == null ? <MockBadge /> : undefined}>
          <AlarmsList incidents={live.incidents?.data} />
        </Panel>
      </div>
      <Panel title="Elementos de rede" link={live.oltCount != null ? `${live.oltCount} OLTs` : 'Ver todos'} badge={<MockBadge />}>
        <div className="text-xs">
          <div className="grid grid-cols-[1.4fr_84px_72px_1fr_72px] gap-2 border-b border-border pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-disabled">
            <span>Elemento</span><span>Tipo</span><span>Status</span><span>Carga</span><span>Uptime</span>
          </div>
          {ELEMENTS.map((e) => (
            <div key={e.name} className="grid grid-cols-[1.4fr_84px_72px_1fr_72px] items-center gap-2 border-b border-border/60 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT_STATUS[e.status])} />
                <span className="truncate font-mono text-text">{e.name}</span>
                <span className="truncate text-[10px] text-text-subtle">{e.vendor}</span>
              </div>
              <span className="text-text-muted">{e.type}</span>
              <span className={cn('w-fit rounded px-1.5 py-px text-[10px] font-semibold', e.status === 'down' ? STATUS_TONE.danger : e.status === 'warn' ? STATUS_TONE.warning : STATUS_TONE.success)}>
                {e.status}
              </span>
              <div className="flex items-center gap-1.5">
                <Progress value={e.load} className={e.load > 80 ? 'text-warning' : 'text-accent'} />
                <span className="font-mono text-[10px] text-text-subtle">{e.load}%</span>
              </div>
              <span className="font-mono text-text-muted">{e.uptime}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function AlarmsList({ incidents }: { incidents?: IncidentItem[] }) {
  const rows = incidents ?? [];
  if (rows.length === 0) {
    return <div className="py-6 text-center text-xs text-text-subtle">Nenhum alarme ativo.</div>;
  }
  return (
    <div className="space-y-2">
      {rows.slice(0, 5).map((a) => {
        const danger = sevIsDanger(a.severity);
        return (
          <div
            key={a.id}
            className={cn(
              'rounded-lg border border-border bg-card-inset px-2.5 py-2',
              danger ? 'border-l-2 border-l-danger' : 'border-l-2 border-l-warning',
            )}
          >
            <div className="flex items-center gap-1.5">
              <span className={cn('h-1.5 w-1.5 rounded-full', danger ? 'bg-danger' : 'bg-warning')} />
              <span className="truncate text-xs text-text">{a.scopeLabel ?? a.rootCause ?? a.scope}</span>
              <span className="ml-auto whitespace-nowrap text-[10px] text-text-subtle">{relativeTime(a.lastEventAt)}</span>
            </div>
            <span className="font-mono text-[10px] text-text-subtle">{a.scope} · {a.affectedCount}/{a.totalInScope}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── FINANCEIRO ────────────────────────────────────────────────────────────
function FinanceiroPanels({ live, money, moneyShort, nf }: { live: DashboardLive; money: (v?: number) => string; moneyShort: (v?: number) => string; nf: (n?: number) => string }) {
  const mrr = live.mrrSeries;
  const mrrData = mrr ? mrr.map((p) => Math.round(p.mrr)) : [120, 128, 132, 140, 145, 150, 158, 162, 168, 175, 178, 184];
  const mrrLabels = mrr ? mrr.map((p) => p.yearMonth.slice(5)) : ['j', 'f', 'm', 'a', 'm', 'j', 'j', 'a', 's', 'o', 'n', 'd'];

  const aging = live.aging?.buckets ?? AGING.map((a) => ({ label: a.label, count: 0, amount: 0 }));
  const agingMax = Math.max(1, ...aging.map((b) => b.amount));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
        <Panel title="MRR (12 meses)" badge={mrr == null ? <MockBadge /> : undefined}>
          <div className="font-mono text-[27px] font-semibold text-text-strong">
            {moneyShort(live.monthlyBaseline)}<span className="text-base text-text-subtle">/mês</span>
          </div>
          <div className="mt-1 text-xs text-text-subtle">
            {live.activeContracts != null ? `${nf(live.activeContracts)} contratos ativos` : 'soma do plano mensal dos contratos ativos'}
          </div>
          <div className="mt-3">
            <BarChart data={mrrData} labels={mrrLabels} />
          </div>
        </Panel>
        <Panel title="Inadimplência por faixa" badge={live.aging == null ? <MockBadge /> : undefined}>
          <div className="text-xs text-text-subtle">
            {moneyShort(live.aging?.totalAmount ?? live.finance?.overdue.amount)} em {nf(live.aging?.totalCount ?? live.overdueCount)} faturas vencidas
          </div>
          <div className="mt-3 space-y-2.5">
            {aging.map((b, idx) => {
              const tone = idx === aging.length - 1 ? 'text-danger' : 'text-warning';
              return (
                <div key={b.label}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-text-muted">{b.label}</span>
                    <span className="font-mono text-text-muted">{moneyShort(b.amount)} · {b.count}</span>
                  </div>
                  <Progress value={(b.amount / agingMax) * 100} className={tone} />
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
      <Panel title="Faturas recentes" link="Ver financeiro" badge={live.recentInvoices == null ? <MockBadge /> : undefined}>
        <InvoicesTable invoices={live.recentInvoices} money={money} />
      </Panel>
    </div>
  );
}

function InvoicesTable({ invoices, money }: { invoices?: RecentInvoice[]; money: (v?: number) => string }) {
  const rows = invoices ?? [];
  return (
    <div className="text-xs">
      <div className="grid grid-cols-[1.3fr_1fr_84px_92px_84px] gap-2 border-b border-border pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-disabled">
        <span>Contrato</span><span>Fatura</span><span>Venc.</span><span>Valor</span><span>Status</span>
      </div>
      {rows.length === 0 && (
        <div className="py-6 text-center text-text-subtle">Nenhuma fatura.</div>
      )}
      {rows.map((inv) => {
        const ident = inv.contract?.pppoeUsername ?? inv.contract?.code ?? inv.contract?.customerId.slice(0, 8) ?? '—';
        const st = INVOICE_STATUS[inv.status] ?? { label: inv.status, tone: 'muted' as const };
        return (
          <div key={inv.id} className="grid grid-cols-[1.3fr_1fr_84px_92px_84px] items-center gap-2 border-b border-border/60 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-hover text-[10px] font-semibold text-text-muted">
                {ident.slice(0, 2).toUpperCase()}
              </span>
              <span className="truncate text-text">{ident}</span>
            </div>
            <span className="font-mono text-text-muted">{inv.contract?.code ?? inv.id.slice(0, 8)}</span>
            <span className="font-mono text-text-muted">{formatDate(inv.dueDate)}</span>
            <span className="font-mono text-text">{money(inv.amount)}</span>
            <span className={cn('w-fit rounded px-1.5 py-px text-[10px] font-semibold', STATUS_TONE[st.tone])}>
              {st.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

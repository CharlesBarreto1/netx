'use client';

/**
 * Dashboard operacional — "cockpit" com 3 lentes por papel (Operador / NOC /
 * Financeiro) que reconfiguram a MESMA base (design_handoff_netx_shell §3-7).
 * Não são apps separados: a lente troca título, KPIs e painéis.
 *
 * DADOS: mock por ora (fiel ao protótipo). TODO: ligar nas APIs reais — os KPIs
 * de Operador (clientes/contratos/inadimplência/online) já existiam no dashboard
 * antigo e devem ser re-cabeados aqui.
 */

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { BarChart, HealthDonut, LineChart, Progress, Sparkline } from '@/components/dashboard/charts';
import { cn } from '@/lib/cn';

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
}

const TONE_CHIP: Record<Kpi['deltaTone'], string> = {
  success: 'text-success bg-success-muted',
  warning: 'text-warning bg-warning-muted',
  danger: 'text-danger bg-danger-muted',
  muted: 'text-text-muted bg-surface-hover',
};

// ── Dados mock por lente ──────────────────────────────────────────────────
const KPIS: Record<Lens, Kpi[]> = {
  operador: [
    { label: 'Assinantes ativos', value: '18.432', delta: '+124', deltaTone: 'success', sub: 'no mês', dot: 'text-accent' },
    { label: 'Inadimplência', value: '6,9%', delta: '-0,4pp', deltaTone: 'success', sub: '1.287 contratos', dot: 'text-warning' },
    { label: 'Saúde da rede', value: '99,2%', delta: 'estável', deltaTone: 'success', sub: '2.341 nós', dot: 'text-success' },
    { label: 'Incidentes', value: '5', delta: '2 P1', deltaTone: 'danger', sub: 'abertos', dot: 'text-danger' },
    { label: 'O.S do dia', value: '38', delta: '12 pend.', deltaTone: 'warning', sub: 'campo', dot: 'text-info' },
    { label: 'Faturamento', value: 'R$ 1,84M', delta: '+4,8%', deltaTone: 'success', sub: '88% recebido', dot: 'text-accent' },
  ],
  noc: [
    { label: 'Tráfego pico', value: '428,6 Gbps', delta: '+6,1%', deltaTone: 'warning', sub: 'agregado', dot: 'text-accent' },
    { label: 'Elementos online', value: '2.338', delta: '3 down', deltaTone: 'danger', sub: 'de 2.341', dot: 'text-success' },
    { label: 'Alarmes ativos', value: '7', delta: '4 críticos', deltaTone: 'danger', sub: 'agora', dot: 'text-danger' },
    { label: 'Latência média', value: '8,4 ms', delta: '-0,6ms', deltaTone: 'success', sub: 'backbone', dot: 'text-info' },
    { label: 'Uptime 30d', value: '99,94%', delta: 'SLA ok', deltaTone: 'success', sub: 'core', dot: 'text-success' },
    { label: 'OLTs', value: '46', delta: '1 alerta', deltaTone: 'warning', sub: 'ativas', dot: 'text-accent' },
  ],
  financeiro: [
    { label: 'MRR', value: 'R$ 1,84M', delta: '+4,8%', deltaTone: 'success', sub: '/mês', dot: 'text-accent' },
    { label: 'Inadimplência', value: 'R$ 218k', delta: '+2,1%', deltaTone: 'danger', sub: '1.287 contratos', dot: 'text-warning' },
    { label: 'Ticket médio', value: 'R$ 99,80', delta: '+1,2%', deltaTone: 'success', sub: 'por contrato', dot: 'text-info' },
    { label: 'Recebido (mês)', value: '88%', delta: 'R$ 1,62M', deltaTone: 'success', sub: 'da meta', dot: 'text-success' },
    { label: 'A receber', value: 'R$ 412k', delta: '7 dias', deltaTone: 'muted', sub: 'próx. ciclo', dot: 'text-accent' },
    { label: 'Churn', value: '1,3%', delta: '-0,2pp', deltaTone: 'success', sub: 'no mês', dot: 'text-success' },
  ],
};

const REGIONS = [
  { name: 'Asunción Centro', pct: 99.8, tone: 'text-success' },
  { name: 'Asunción Norte', pct: 97.4, tone: 'text-warning' },
  { name: 'Central · Luque', pct: 99.9, tone: 'text-success' },
  { name: 'Encarnación', pct: 94.1, tone: 'text-danger' },
];

const INCIDENTS = [
  { title: 'Queda PON OLT-ASU-01', id: 'INC-4821', region: 'Centro', sla: '00:42', sev: 'P1' },
  { title: 'Latência alta backbone', id: 'INC-4820', region: 'Norte', sla: '01:15', sev: 'P2' },
  { title: 'Pacotes perdidos SW-02', id: 'INC-4818', region: 'Luque', sla: '02:30', sev: 'P2' },
  { title: 'RX degradado setor 7', id: 'INC-4815', region: 'Encarn.', sla: '03:48', sev: 'P3' },
];

const ALARMS = [
  { text: 'OLT-ASU-01 sem resposta', node: 'olt-asu-01', ago: '6m', tone: 'danger' },
  { text: 'SW-CORE-02 carga 88%', node: 'sw-core-02', ago: '14m', tone: 'warning' },
  { text: 'RX baixo PON 3/12', node: 'pon-3-12', ago: '22m', tone: 'warning' },
  { text: 'Link redundante caiu', node: 'rtr-border-01', ago: '40m', tone: 'danger' },
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

const INVOICES = [
  { name: 'María González', id: 'FAT-90412', due: '23/06', val: 'R$ 149,90', status: 'Pago', tone: 'success' },
  { name: 'João Pereira', id: 'FAT-90411', due: '22/06', val: 'R$ 99,90', status: 'Atraso', tone: 'danger' },
  { name: 'Carlos Ávalos', id: 'FAT-90410', due: '24/06', val: 'R$ 199,90', status: 'Pendente', tone: 'warning' },
  { name: 'Ana Benítez', id: 'FAT-90409', due: '21/06', val: 'R$ 79,90', status: 'Pago', tone: 'success' },
  { name: 'Luis Martínez', id: 'FAT-90408', due: '25/06', val: 'R$ 129,90', status: 'Aberta', tone: 'muted' },
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

export default function DashboardPage() {
  const t = useTranslations('dashboardCockpit');
  const [lens, setLens] = useState<Lens>('operador');

  useEffect(() => {
    const s = localStorage.getItem(STORAGE_KEY) as Lens | null;
    if (s && LENSES.includes(s)) setLens(s);
  }, []);

  const changeLens = (l: Lens) => {
    setLens(l);
    localStorage.setItem(STORAGE_KEY, l);
  };

  return (
    <div className="mx-auto w-full max-w-[1180px]">
      {/* Header + lens switcher */}
      <div className="flex flex-wrap items-end justify-between gap-3 pb-5">
        <div>
          <div className="text-xs text-text-subtle">ASU Telecom / {t('breadcrumb')}</div>
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
        {KPIS[lens].map((k) => (
          <div key={k.label} className="rounded-xl border border-border bg-card p-3.5">
            <div className="flex items-center gap-1.5">
              <span className={cn('h-1.5 w-1.5 rounded-full bg-current', k.dot)} />
              <span className="truncate text-xs text-text-subtle">{k.label}</span>
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
      {lens === 'operador' && <OperadorPanels />}
      {lens === 'noc' && <NocPanels />}
      {lens === 'financeiro' && <FinanceiroPanels />}
    </div>
  );
}

// ── Wrapper de card ───────────────────────────────────────────────────────
function Panel({
  title,
  link,
  children,
  className,
}: {
  title: string;
  link?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-2xl border border-border bg-card p-[18px]', className)}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">{title}</h2>
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
function OperadorPanels() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
        <Panel title="Saúde da rede" link="Ver topologia">
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
          <div className="font-mono text-[27px] font-semibold text-text-strong">R$ 1,84M</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded px-1 py-px text-[10px] font-semibold text-success bg-success-muted">+4,8%</span>
            <span className="text-xs text-text-subtle">Meta R$ 1,90M · 88% recebido</span>
          </div>
          <div className="mt-3">
            <Sparkline data={[40, 52, 48, 61, 58, 72, 69, 80, 84, 92]} className="text-accent" />
          </div>
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.45fr]">
        <Panel title="Base de assinantes">
          <div className="flex gap-6">
            <div>
              <div className="font-mono text-xl font-semibold text-text-strong">18.432</div>
              <div className="flex items-center gap-1 text-2xs text-text-subtle">
                <span className="h-2 w-2 rounded-sm bg-success" /> ativos
              </div>
            </div>
            <div>
              <div className="font-mono text-xl font-semibold text-text-strong">1.287</div>
              <div className="flex items-center gap-1 text-2xs text-text-subtle">
                <span className="h-2 w-2 rounded-sm bg-warning" /> inadimpl.
              </div>
            </div>
          </div>
          <div className="mt-3">
            <LineChart
              series={[
                { data: [60, 62, 65, 64, 68, 72, 75], className: 'text-success' },
                { data: [12, 14, 13, 15, 14, 13, 12], className: 'text-warning', dashed: true },
              ]}
            />
          </div>
        </Panel>
        <Panel title="Incidentes abertos" link="Abrir NOC">
          <IncidentsTable />
        </Panel>
      </div>
    </div>
  );
}

function IncidentsTable() {
  return (
    <div className="text-xs">
      <div className="grid grid-cols-[1fr_92px_72px_56px] gap-2 border-b border-border pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-disabled">
        <span>Incidente</span>
        <span>Região</span>
        <span>SLA</span>
        <span>Sev</span>
      </div>
      {INCIDENTS.map((i) => (
        <div key={i.id} className="grid grid-cols-[1fr_92px_72px_56px] items-center gap-2 border-b border-border/60 py-2">
          <div className="min-w-0">
            <div className="truncate text-text">{i.title}</div>
            <div className="font-mono text-[10px] text-text-subtle">{i.id}</div>
          </div>
          <span className="text-text-muted">{i.region}</span>
          <span className="font-mono text-text-muted">{i.sla}</span>
          <span className={cn('w-fit rounded px-1.5 py-px text-[10px] font-semibold', SEV_TONE[i.sev])}>
            {i.sev}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── NOC ───────────────────────────────────────────────────────────────────
function NocPanels() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
        <Panel title="Tráfego agregado">
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
        <Panel title="Alarmes ativos">
          <div className="space-y-2">
            {ALARMS.map((a) => (
              <div
                key={a.node}
                className={cn(
                  'rounded-lg border border-border bg-card-inset px-2.5 py-2',
                  a.tone === 'danger' ? 'border-l-2 border-l-danger' : 'border-l-2 border-l-warning',
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span className={cn('h-1.5 w-1.5 rounded-full', a.tone === 'danger' ? 'bg-danger' : 'bg-warning')} />
                  <span className="text-xs text-text">{a.text}</span>
                  <span className="ml-auto text-[10px] text-text-subtle">há {a.ago}</span>
                </div>
                <span className="font-mono text-[10px] text-text-subtle">{a.node}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <Panel title="Elementos de rede" link="Ver todos (2.341)">
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

// ── FINANCEIRO ────────────────────────────────────────────────────────────
function FinanceiroPanels() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
        <Panel title="MRR (12 meses)">
          <div className="font-mono text-[27px] font-semibold text-text-strong">R$ 1,84M<span className="text-base text-text-subtle">/mês</span></div>
          <div className="mt-1"><span className="rounded px-1 py-px text-[10px] font-semibold text-success bg-success-muted">+4,8%</span></div>
          <div className="mt-3">
            <BarChart
              data={[120, 128, 132, 140, 145, 150, 158, 162, 168, 175, 178, 184]}
              labels={['j', 'f', 'm', 'a', 'm', 'j', 'j', 'a', 's', 'o', 'n', 'd']}
            />
          </div>
        </Panel>
        <Panel title="Inadimplência por faixa">
          <div className="text-xs text-text-subtle">R$ 218k em 1.287 contratos</div>
          <div className="mt-3 space-y-2.5">
            {AGING.map((a) => (
              <div key={a.label}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-text-muted">{a.label}</span>
                  <span className="font-mono text-text-muted">{a.value}</span>
                </div>
                <Progress value={a.pct * 2} className={a.tone} />
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <Panel title="Faturas recentes" link="Ver financeiro">
        <div className="text-xs">
          <div className="grid grid-cols-[1.3fr_1fr_84px_92px_84px] gap-2 border-b border-border pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-disabled">
            <span>Assinante</span><span>Fatura</span><span>Venc.</span><span>Valor</span><span>Status</span>
          </div>
          {INVOICES.map((inv) => (
            <div key={inv.id} className="grid grid-cols-[1.3fr_1fr_84px_92px_84px] items-center gap-2 border-b border-border/60 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-hover text-[10px] font-semibold text-text-muted">
                  {inv.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                </span>
                <span className="truncate text-text">{inv.name}</span>
              </div>
              <span className="font-mono text-text-muted">{inv.id}</span>
              <span className="font-mono text-text-muted">{inv.due}</span>
              <span className="font-mono text-text">{inv.val}</span>
              <span className={cn('w-fit rounded px-1.5 py-px text-[10px] font-semibold', STATUS_TONE[inv.tone])}>
                {inv.status}
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

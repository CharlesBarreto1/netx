'use client';

import {
  ArrowRight,
  FileText,
  HardHat,
  Heart,
  Plus,
  Sparkles,
  UserPlus,
  Users,
  Wallet,
  Wifi,
  WifiOff,
  Wrench,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo } from 'react';
import type { ComponentType, ReactNode } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { getSession } from '@/lib/session';

/**
 * Dashboard — landing pós-login.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 *
 * Layout: hero com saudação + métricas rápidas em cards animados +
 * shortcuts pra ações comuns. Cada card carrega individualmente (SWR) e
 * mostra skeleton enquanto buscamos.
 */

interface CustomersListResponse {
  data: Array<{ id: string; status: string; type: string }>;
  pagination: { total: number; page: number; pageSize: number };
}

interface ContractsListResponse {
  pagination: { total: number };
}

interface InvoicesListResponse {
  pagination: { total: number };
}

interface OnlineSnapshotResponse {
  online: number;
  offline: number;
  totalActive: number;
  snapshotAt: string;
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const session = getSession();
  const canReadCustomers = session?.user.permissions.includes('customers.read') ?? false;
  const canReadContracts = session?.user.permissions.includes('contracts.read') ?? false;
  const canCreateCustomer = session?.user.permissions.includes('customers.create') ?? false;

  const { data: cust, isLoading: lCust } = useSWR<CustomersListResponse>(
    canReadCustomers ? '/v1/customers?pageSize=1' : null,
  );
  const { data: contracts, isLoading: lContracts } = useSWR<ContractsListResponse>(
    canReadContracts ? '/v1/contracts?pageSize=1' : null,
  );
  // Faturas em atraso: endpoint correto é `/v1/contract-invoices` (faturas
  // mensais recorrentes), não `/v1/finance/charges` (cobranças avulsas, que
  // tem enum sem OVERDUE — chamada antiga voltava 400 e o card ficava em branco).
  const { data: overdue, isLoading: lOverdue } = useSWR<InvoicesListResponse>(
    canReadContracts ? '/v1/contract-invoices?status=OVERDUE&pageSize=1' : null,
  );
  // Snapshot de online/offline — refresh cada 30min pra não pesar o DB
  // (cross join contracts × radius.radacct).
  const { data: snapshot, isLoading: lSnapshot } = useSWR<OnlineSnapshotResponse>(
    canReadContracts ? '/v1/radius/stats/online' : null,
    { refreshInterval: 30 * 60 * 1000, dedupingInterval: 5 * 60 * 1000 },
  );

  const greeting = t(greetingKeyFromHour());
  const quoteOfDay = useMemo(() => pickQuoteOfDay(), []);

  return (
    <div className="animate-fade-in-up space-y-6">
      {/* Hero */}
      <header className="card surface-aurora overflow-hidden p-6">
        <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-2xs font-semibold uppercase tracking-wider text-text-subtle">
              {greeting}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-text">
              {t('hello', { name: session?.user.firstName || t('defaultOperator') })}
            </h1>
            <p className="mt-1 text-sm text-text-muted">
              {session?.tenant.name} — {session?.tenant.locale} ·{' '}
              <span className="tabular">{session?.tenant.currency}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canCreateCustomer && (
              <Link href="/customers/new">
                <Button>
                  <UserPlus className="mr-1.5 h-4 w-4" />
                  {t('newCustomer')}
                </Button>
              </Link>
            )}
            <Link href="/customers">
              <Button variant="secondary">
                {t('viewCustomers')}
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* KPIs — primeira linha: negócio */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard
          icon={Users}
          label={t('activeCustomers')}
          value={cust?.pagination.total}
          loading={lCust && canReadCustomers}
          disabled={!canReadCustomers}
          href="/customers"
          tone="accent"
          delay={0}
        />
        <MetricCard
          icon={FileText}
          label={t('activeContracts')}
          value={contracts?.pagination.total}
          loading={lContracts && canReadContracts}
          disabled={!canReadContracts}
          href="/contracts"
          tone="info"
          delay={60}
        />
        <MetricCard
          icon={Wallet}
          label={t('overdueInvoices')}
          value={overdue?.pagination.total}
          loading={lOverdue && canReadContracts}
          disabled={!canReadContracts}
          href="/contracts?invoiceStatus=OVERDUE"
          tone={(overdue?.pagination.total ?? 0) > 0 ? 'danger' : 'success'}
          delay={120}
        />
      </section>

      {/* KPIs — segunda linha: técnico (RADIUS snapshot) */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <MetricCard
          icon={Wifi}
          label={t('customersOnline')}
          value={snapshot?.online}
          loading={lSnapshot && canReadContracts}
          disabled={!canReadContracts}
          href="/network/radius-log"
          tone="success"
          delay={180}
          footer={
            snapshot
              ? t('footerOnline', {
                  pct: pct(snapshot.online, snapshot.totalActive),
                  age: formatSnapshotAge(snapshot.snapshotAt, t),
                })
              : undefined
          }
        />
        <MetricCard
          icon={WifiOff}
          label={t('customersOffline')}
          value={snapshot?.offline}
          loading={lSnapshot && canReadContracts}
          disabled={!canReadContracts}
          href="/network/radius-log"
          tone={(snapshot?.offline ?? 0) > (snapshot?.online ?? 0) ? 'warning' : 'info'}
          delay={240}
          footer={
            snapshot
              ? t('footerOffline', { pct: pct(snapshot.offline, snapshot.totalActive) })
              : undefined
          }
        />
      </section>

      {/* Quick actions + Roadmap */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <ShortcutCard
          icon={UserPlus}
          title={t('shortcutCustomerTitle')}
          description={t('shortcutCustomerDesc')}
          href="/customers/new"
          show={canCreateCustomer}
        />
        <ShortcutCard
          icon={Plus}
          title={t('shortcutContractTitle')}
          description={t('shortcutContractDesc')}
          href="/contracts/new"
          show={session?.user.permissions.includes('contracts.create') ?? false}
        />
        <ShortcutCard
          icon={Wrench}
          title={t('shortcutServiceOrderTitle')}
          description={t('shortcutServiceOrderDesc')}
          href="/service-orders"
          show={session?.user.permissions.includes('service_orders.read') ?? false}
        />
        <ShortcutCard
          icon={HardHat}
          title={t('shortcutFieldOsTitle')}
          description={t('shortcutFieldOsDesc')}
          href="/os"
          show={session?.user.permissions.includes('service_orders.read') ?? false}
        />
      </section>

      {/* Dica do dia + frase motivacional, lado a lado */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card flex items-start gap-3 p-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-muted text-accent-strong">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-md font-semibold text-text">{t('tipOfTheDay')}</h2>
            <p className="mt-1 text-sm text-text-muted">
              {t.rich('tipShortcut', {
                cmd: () => <kbd className="kbd">⌘</kbd>,
                k: () => <kbd className="kbd">K</kbd>,
              })}
            </p>
          </div>
        </div>

        <div className="card flex items-start gap-3 p-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-success-muted text-success">
            <Heart className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-md font-semibold text-text">{t('thoughtOfTheDay')}</h2>
            <p className="mt-1 text-sm italic text-text-muted">
              &ldquo;{t(`quote${quoteOfDay.n}`)}&rdquo;
            </p>
            {quoteOfDay.author && (
              <p className="mt-1 text-xs text-text-subtle">— {quoteOfDay.author}</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

const TONE_BG: Record<string, string> = {
  accent: 'bg-accent-muted text-accent-strong',
  info: 'bg-info-muted text-info',
  success: 'bg-success-muted text-success',
  danger: 'bg-danger-muted text-danger',
  warning: 'bg-warning-muted text-warning',
};

function MetricCard({
  icon: Icon,
  label,
  value,
  loading,
  disabled,
  href,
  tone = 'accent',
  delay = 0,
  footer,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number | undefined;
  loading?: boolean;
  disabled?: boolean;
  href: string;
  tone?: 'accent' | 'info' | 'success' | 'danger' | 'warning';
  delay?: number;
  /** Linha extra abaixo do valor (ex: "37% dos ativos · snapshot há 4 min"). */
  footer?: string;
}) {
  const t = useTranslations('dashboard');
  const Body = (
    <div
      className={cn(
        'card card-interactive flex flex-col gap-3 p-5',
        'animate-fade-in-up',
        disabled && 'pointer-events-none opacity-50',
      )}
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'backwards' }}
    >
      <div className="flex items-center justify-between">
        <span className="text-2xs font-semibold uppercase tracking-wider text-text-subtle">
          {label}
        </span>
        <div
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md',
            TONE_BG[tone],
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      {loading ? (
        <Skeleton className="h-9 w-20" />
      ) : (
        <div className="tabular text-3xl font-bold leading-none text-text">
          {value ?? '—'}
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-text-subtle">
        <span>{disabled ? t('noPermission') : (footer ?? t('updatedNow'))}</span>
        {!disabled && (
          <span className="inline-flex items-center gap-0.5 text-text-muted">
            {t('view')}
            <ArrowRight className="h-3 w-3" />
          </span>
        )}
      </div>
    </div>
  );

  if (disabled) return Body;
  return <Link href={href}>{Body}</Link>;
}

function ShortcutCard({
  icon: Icon,
  title,
  description,
  href,
  show,
}: {
  icon: ComponentType<{ className?: string }>;
  title: ReactNode;
  description: ReactNode;
  href: string;
  show?: boolean;
}) {
  const t = useTranslations('dashboard');
  if (!show) return null;
  return (
    <Link href={href}>
      <div className="card card-interactive group flex flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-text-subtle transition-colors group-hover:text-accent" />
          <h3 className="text-sm font-semibold text-text">{title}</h3>
        </div>
        <p className="text-xs text-text-muted">{description}</p>
        <span className="mt-1 inline-flex items-center gap-1 text-2xs font-medium text-text-subtle transition-colors group-hover:text-accent">
          {t('open')}
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}

function greetingKeyFromHour(): 'greetingDawn' | 'greetingMorning' | 'greetingAfternoon' | 'greetingEvening' {
  const h = new Date().getHours();
  if (h < 5) return 'greetingDawn';
  if (h < 12) return 'greetingMorning';
  if (h < 18) return 'greetingAfternoon';
  return 'greetingEvening';
}

function pct(part: number | undefined, total: number | undefined): string {
  if (!total || total === 0) return '0';
  return Math.round(((part ?? 0) / total) * 100).toString();
}

function formatSnapshotAge(
  isoDate: string,
  t: (key: 'ageNow' | 'ageMinutes' | 'ageHours', values?: Record<string, number>) => string,
): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  if (ms < 60_000) return t('ageNow');
  const min = Math.floor(ms / 60_000);
  if (min < 60) return t('ageMinutes', { min });
  const h = Math.floor(min / 60);
  return t('ageHours', { h });
}

// ---------------------------------------------------------------------------
// Frases motivacionais — rotaciona por dia do ano (estável dentro do mesmo dia,
// muda automaticamente quando vira meia-noite). Misto de autores reais
// (Drucker, Bezos, etc) e frases anônimas focadas em operação de ISP.
// ---------------------------------------------------------------------------
interface Quote {
  /** Índice da chave de tradução: t(`quote${n}`). */
  n: number;
  author?: string;
}
const QUOTES: Quote[] = [
  { n: 1, author: 'Peter Drucker' },
  { n: 2, author: 'Jeff Bezos' },
  { n: 3, author: 'Steve Jobs' },
  { n: 4, author: 'Jim Rohn' },
  { n: 5 },
  { n: 6 },
  { n: 7 },
  { n: 8 },
  { n: 9 },
  { n: 10, author: 'Peter Drucker' },
  { n: 11, author: 'John Ruskin' },
  { n: 12 },
  { n: 13, author: 'Robert Collier' },
  { n: 14 },
  { n: 15, author: 'John Rockefeller' },
  { n: 16 },
  { n: 17, author: 'Steve Jobs' },
  { n: 18 },
  { n: 19, author: 'Marie Forleo' },
  { n: 20 },
  { n: 21 },
  { n: 22 },
  { n: 23, author: 'Muhammad Ali' },
  { n: 24, author: 'Bill Gates' },
  { n: 25 },
  { n: 26 },
  { n: 27 },
  { n: 28 },
  { n: 29 },
  { n: 30 },
  { n: 31 },
  { n: 32 },
];

function pickQuoteOfDay(): Quote {
  // Dia do ano (0-365) → índice estável durante o dia, troca à meia-noite.
  const start = new Date(new Date().getFullYear(), 0, 0);
  const diff = Date.now() - start.getTime();
  const dayOfYear = Math.floor(diff / 86_400_000);
  return QUOTES[dayOfYear % QUOTES.length];
}

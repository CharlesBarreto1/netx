'use client';

import {
  ArrowRight,
  FileText,
  Plus,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
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

interface ChargesListResponse {
  pagination: { total: number };
}

export default function DashboardPage() {
  const session = getSession();
  const canReadCustomers = session?.user.permissions.includes('customers.read') ?? false;
  const canReadContracts = session?.user.permissions.includes('contracts.read') ?? false;
  const canReadCharges = session?.user.permissions.includes('finance.charges.read') ?? false;
  const canCreateCustomer = session?.user.permissions.includes('customers.create') ?? false;

  const { data: cust, isLoading: lCust } = useSWR<CustomersListResponse>(
    canReadCustomers ? '/v1/customers?pageSize=1' : null,
  );
  const { data: contracts, isLoading: lContracts } = useSWR<ContractsListResponse>(
    canReadContracts ? '/v1/contracts?pageSize=1' : null,
  );
  const { data: overdue, isLoading: lOverdue } = useSWR<ChargesListResponse>(
    canReadCharges ? '/v1/finance/charges?status=OVERDUE&pageSize=1' : null,
  );

  const greeting = greetingFromHour();

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
              Olá, {session?.user.firstName || 'operador'}
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
                  Novo cliente
                </Button>
              </Link>
            )}
            <Link href="/customers">
              <Button variant="secondary">
                Ver clientes
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* KPIs */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard
          icon={Users}
          label="Clientes ativos"
          value={cust?.pagination.total}
          loading={lCust && canReadCustomers}
          disabled={!canReadCustomers}
          href="/customers"
          tone="accent"
          delay={0}
        />
        <MetricCard
          icon={FileText}
          label="Contratos vigentes"
          value={contracts?.pagination.total}
          loading={lContracts && canReadContracts}
          disabled={!canReadContracts}
          href="/contracts"
          tone="info"
          delay={60}
        />
        <MetricCard
          icon={Wallet}
          label="Faturas em atraso"
          value={overdue?.pagination.total}
          loading={lOverdue && canReadCharges}
          disabled={!canReadCharges}
          href="/finance/charges?status=OVERDUE"
          tone={(overdue?.pagination.total ?? 0) > 0 ? 'danger' : 'success'}
          delay={120}
        />
      </section>

      {/* Quick actions + Roadmap */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <ShortcutCard
          icon={UserPlus}
          title="Cadastrar cliente"
          description="Pessoa física ou jurídica, com endereço, contatos e tags."
          href="/customers/new"
          show={canCreateCustomer}
        />
        <ShortcutCard
          icon={Plus}
          title="Novo contrato"
          description="Plano, IPoE/PPPoE e ciclo de faturamento — em <30s."
          href="/contracts/new"
          show={session?.user.permissions.includes('contracts.create') ?? false}
        />
        <ShortcutCard
          icon={Wrench}
          title="Abrir O.S"
          description="Visita técnica, mudança de endereço ou instalação."
          href="/service-orders"
          show={session?.user.permissions.includes('service_orders.read') ?? false}
        />
      </section>

      <section className="card flex items-start gap-3 p-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-muted text-accent-strong">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-md font-semibold text-text">Dica do dia</h2>
          <p className="mt-1 text-sm text-text-muted">
            Pressione{' '}
            <kbd className="kbd">⌘</kbd> <kbd className="kbd">K</kbd> em qualquer
            lugar pra abrir a busca global e navegar por clientes, contratos,
            faturas ou pular pra qualquer página da operação.
          </p>
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
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number | undefined;
  loading?: boolean;
  disabled?: boolean;
  href: string;
  tone?: 'accent' | 'info' | 'success' | 'danger' | 'warning';
  delay?: number;
}) {
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
        <span>{disabled ? 'Sem permissão' : 'Atualizado agora'}</span>
        {!disabled && (
          <span className="inline-flex items-center gap-0.5 text-text-muted">
            Ver
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
          Abrir
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}

function greetingFromHour(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Madrugada produtiva';
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

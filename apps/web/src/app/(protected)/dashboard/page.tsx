'use client';

import Link from 'next/link';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { InlineLoader } from '@/components/ui/Spinner';
import { getSession } from '@/lib/session';

interface CustomersListResponse {
  data: Array<{ id: string; status: string; type: string }>;
  pagination: { total: number; page: number; pageSize: number };
}

export default function DashboardPage() {
  const session = getSession();
  const canReadCustomers = session?.user.permissions.includes('customers.read') ?? false;

  const { data, isLoading, error } = useSWR<CustomersListResponse>(
    canReadCustomers ? '/v1/customers?pageSize=1' : null,
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Bem-vindo, {session?.user.firstName || 'operador'}!
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {session?.tenant.name} — {session?.tenant.locale} · {session?.tenant.timezone} ·{' '}
            {session?.tenant.currency}
          </p>
        </div>
        {canReadCustomers && (
          <div className="flex items-center gap-2">
            <Link href="/customers">
              <Button variant="secondary" size="sm">
                Ver clientes
              </Button>
            </Link>
            {session?.user.permissions.includes('customers.create') && (
              <Link href="/customers/new">
                <Button size="sm">Novo cliente</Button>
              </Link>
            )}
          </div>
        )}
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <InfoCard title="Seu acesso">
          <p className="text-sm">
            <strong>Email:</strong> {session?.user.email}
          </p>
          <p className="text-sm">
            <strong>Papéis:</strong> {session?.user.roles.join(', ') || '—'}
          </p>
          <p className="text-sm">
            <strong>Permissões:</strong> {session?.user.permissions.length ?? 0}
          </p>
        </InfoCard>

        <InfoCard title="Tenant">
          <p className="text-sm">
            <strong>Slug:</strong> {session?.tenant.slug}
          </p>
          <p className="text-sm">
            <strong>Idioma:</strong> {session?.tenant.locale}
          </p>
          <p className="text-sm">
            <strong>Fuso:</strong> {session?.tenant.timezone}
          </p>
          <p className="text-sm">
            <strong>Moeda:</strong> {session?.tenant.currency}
          </p>
        </InfoCard>

        <InfoCard title="CRM">
          {!canReadCustomers ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Você não tem permissão <code className="font-mono">customers.read</code>.
            </p>
          ) : isLoading ? (
            <InlineLoader label="Carregando indicadores…" />
          ) : error ? (
            <p className="text-sm text-red-600 dark:text-red-400">Falha ao carregar indicadores.</p>
          ) : (
            <>
              <p className="text-3xl font-bold leading-none">{data?.pagination.total ?? 0}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">clientes cadastrados</p>
              <div className="pt-2">
                <Badge tone="info">Módulo 02 ativo</Badge>
              </div>
            </>
          )}
        </InfoCard>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-base font-semibold">Próximos módulos</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          O Módulo Core (01) e o CRM (02) estão ativos. Contratos, Financeiro, RADIUS, OLT e demais
          módulos serão habilitados conforme o roadmap.
        </p>
      </section>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <h3 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      {children}
    </div>
  );
}

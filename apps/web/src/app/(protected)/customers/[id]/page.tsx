'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { AddressesTab } from '@/components/crm/AddressesTab';
import { ConsentsTab } from '@/components/crm/ConsentsTab';
import { ContactsTab } from '@/components/crm/ContactsTab';
import { ContractsTab } from '@/components/crm/ContractsTab';
import { CustomerTagsTab } from '@/components/crm/CustomerTagsTab';
import { FinanceTab } from '@/components/crm/FinanceTab';
import { NotesTab } from '@/components/crm/NotesTab';
import { Badge, STATUS_LABEL, statusTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { api } from '@/lib/api';
import { formatDateTime, formatPhone, formatTaxId } from '@/lib/format';
import { hasPermission } from '@/lib/session';
import type { Customer } from '@/lib/crm-types';

type TabKey =
  | 'dados'
  | 'enderecos'
  | 'contatos'
  | 'contratos'
  | 'financeiro'
  | 'tags'
  | 'consentimentos'
  | 'anotacoes';

const DEFAULT_TAB: TabKey = 'dados';

function validTab(t: string | null): TabKey {
  const all: TabKey[] = [
    'dados',
    'enderecos',
    'contatos',
    'contratos',
    'financeiro',
    'tags',
    'consentimentos',
    'anotacoes',
  ];
  return (all as string[]).includes(t ?? '') ? (t as TabKey) : DEFAULT_TAB;
}

export default function CustomerDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const tTabs = useTranslations('customers.tabs');
  const id = params?.id;
  const key = id ? `/v1/customers/${id}` : null;

  const { data: customer, isLoading, error, mutate } = useSWR<Customer>(key);
  const canUpdate = hasPermission('customers.update');
  const canDelete = hasPermission('customers.delete');

  const activeTab = validTab(searchParams.get('tab'));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function switchTab(next: TabKey) {
    if (!id) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/customers/${id}?${params.toString()}`);
  }

  async function handleDelete() {
    if (!id) return;
    setDeleting(true);
    try {
      await api.delete(`/v1/customers/${id}`);
      router.replace('/customers');
    } finally {
      setDeleting(false);
    }
  }

  if (isLoading) return <PageLoader />;
  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        Falha ao carregar cliente.
      </div>
    );
  }
  if (!customer) return null;

  const items: TabItem<TabKey>[] = [
    { value: 'dados', label: tTabs('data') },
    { value: 'enderecos', label: tTabs('addresses') },
    { value: 'contatos', label: tTabs('contacts') },
    { value: 'contratos', label: tTabs('contracts') },
    { value: 'financeiro', label: tTabs('finance') },
    { value: 'tags', label: tTabs('tags'), badge: customer.tags?.length ?? 0 },
    { value: 'consentimentos', label: tTabs('consents') },
    { value: 'anotacoes', label: tTabs('notes') },
  ];

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <nav className="text-xs text-slate-500 dark:text-slate-400">
          <Link href="/customers" className="hover:underline">
            Clientes
          </Link>{' '}
          › {customer.displayName}
        </nav>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{customer.displayName}</h1>
              <Badge tone={customer.type === 'INDIVIDUAL' ? 'info' : 'brand'}>
                {customer.type === 'INDIVIDUAL' ? 'PF' : 'PJ'}
              </Badge>
              <Badge tone={statusTone(customer.status)}>
                {STATUS_LABEL[customer.status] ?? customer.status}
              </Badge>
              {customer.code && (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Código: {customer.code}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {formatTaxId(customer.taxIdType, customer.taxId)}
              {customer.taxIdCountry ? ` · ${customer.taxIdType} · ${customer.taxIdCountry}` : ''}
            </p>
            {customer.tags && customer.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {customer.tags.map((t) => (
                  <Badge key={t.id} tone="neutral" dot={t.color ?? undefined}>
                    {t.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canUpdate && (
              <Link href={`/customers/${customer.id}/edit`}>
                <Button variant="secondary">Editar</Button>
              </Link>
            )}
            {canDelete && (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Excluir
              </Button>
            )}
          </div>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <InfoChip label="Email" value={customer.primaryEmail ?? '—'} />
        <InfoChip label="Telefone" value={customer.primaryPhone ? formatPhone(customer.primaryPhone) : '—'} />
        <InfoChip label="Criado" value={formatDateTime(customer.createdAt)} />
        <InfoChip label="Atualizado" value={formatDateTime(customer.updatedAt)} />
      </section>

      <Tabs value={activeTab} onChange={switchTab} items={items} />

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        {activeTab === 'dados' && <DataTab customer={customer} />}
        {activeTab === 'enderecos' && <AddressesTab customerId={customer.id} />}
        {activeTab === 'contatos' && <ContactsTab customerId={customer.id} />}
        {activeTab === 'contratos' && <ContractsTab customerId={customer.id} />}
        {activeTab === 'financeiro' && <FinanceTab customerId={customer.id} />}
        {activeTab === 'tags' && (
          <CustomerTagsTab
            customerId={customer.id}
            assigned={customer.tags ?? []}
            onChanged={() => mutate()}
          />
        )}
        {activeTab === 'consentimentos' && <ConsentsTab customerId={customer.id} />}
        {activeTab === 'anotacoes' && <NotesTab customerId={customer.id} />}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Excluir cliente"
        message={`Tem certeza que deseja excluir "${customer.displayName}"? O cliente será arquivado (soft-delete).`}
        confirmLabel="Excluir"
        variant="danger"
        loading={deleting}
      />
    </div>
  );
}

function InfoChip({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-0.5 truncate text-sm text-slate-800 dark:text-slate-100">{value}</div>
    </div>
  );
}

function DataTab({ customer }: { customer: Customer }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm md:grid-cols-2">
      {customer.type === 'INDIVIDUAL' ? (
        <>
          <Row label="Nome" value={customer.firstName} />
          <Row label="Sobrenome" value={customer.lastName} />
          <Row label="Data de nascimento" value={customer.birthDate} />
          <Row label="Gênero" value={customer.gender} />
          <Row label="Nome da mãe" value={customer.motherName} className="md:col-span-2" />
        </>
      ) : (
        <>
          <Row label="Razão social" value={customer.companyName} />
          <Row label="Nome fantasia" value={customer.tradeName} />
          <Row label="Fundação" value={customer.foundedAt} />
          <Row label="Inscrição estadual" value={customer.stateRegistration} />
          <Row label="Inscrição municipal" value={customer.municipalRegistration} />
        </>
      )}

      <Row label="Idioma preferido" value={customer.preferredLanguage} />
      <Row label="Fuso horário" value={customer.timezone} />

      {customer.shortNote && (
        <div className="md:col-span-2">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Observações rápidas
          </dt>
          <dd className="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-800 dark:bg-slate-900/40 dark:text-slate-100">
            {customer.shortNote}
          </dd>
        </div>
      )}
    </dl>
  );
}

function Row({
  label,
  value,
  className,
}: {
  label: string;
  value: string | null | undefined;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </dt>
      <dd className="text-sm text-slate-800 dark:text-slate-100">
        {value && value.length ? value : <span className="text-slate-400">—</span>}
      </dd>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Badge, STATUS_LABEL, statusTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { formatDate, formatPhone, formatTaxId } from '@/lib/format';
import { hasPermission } from '@/lib/session';
import {
  CUSTOMER_STATUSES,
  CUSTOMER_TYPES,
  COUNTRY_OPTIONS,
  type Customer,
  type CustomerTag,
  type Paginated,
} from '@/lib/crm-types';

type Filters = {
  search: string;
  status: string;
  type: string;
  tag: string;
  country: string;
  page: number;
  pageSize: number;
};

function readFilters(sp: URLSearchParams): Filters {
  return {
    search: sp.get('search') ?? '',
    status: sp.get('status') ?? '',
    type: sp.get('type') ?? '',
    tag: sp.get('tag') ?? '',
    country: sp.get('country') ?? '',
    page: Number(sp.get('page') ?? '1') || 1,
    pageSize: Number(sp.get('pageSize') ?? '20') || 20,
  };
}

function toQuery(f: Filters): string {
  const qs = new URLSearchParams();
  if (f.search) qs.set('search', f.search);
  if (f.status) qs.set('status', f.status);
  if (f.type) qs.set('type', f.type);
  if (f.tag) qs.set('tag', f.tag);
  if (f.country) qs.set('country', f.country);
  qs.set('page', String(f.page));
  qs.set('pageSize', String(f.pageSize));
  return qs.toString();
}

export default function CustomersListPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const filters = useMemo(() => readFilters(sp), [sp]);
  const canCreate = hasPermission('customers.create');
  const tCustomers = useTranslations('customers');

  const apiQs = toQuery(filters);
  const { data, isLoading, error } = useSWR<Paginated<Customer>>(
    `/v1/customers?${apiQs}`,
  );

  const { data: tags } = useSWR<CustomerTag[]>('/v1/crm/tags');

  function applyFilters(next: Partial<Filters>) {
    const merged = { ...filters, ...next };
    // Qualquer mudança de filtro reseta paginação.
    if (next.page === undefined) merged.page = 1;
    router.replace(`/customers?${toQuery(merged)}`);
  }

  function clear() {
    router.replace('/customers');
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{tCustomers('title')}</h1>
        </div>
        {canCreate && (
          <Link href="/customers/new">
            <Button>{tCustomers('new')}</Button>
          </Link>
        )}
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <form
          className="grid grid-cols-1 gap-3 md:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            applyFilters({
              search: (fd.get('search') as string) || '',
              status: (fd.get('status') as string) || '',
              type: (fd.get('type') as string) || '',
              tag: (fd.get('tag') as string) || '',
              country: (fd.get('country') as string) || '',
            });
          }}
        >
          <div className="md:col-span-2">
            <Label htmlFor="search">Buscar</Label>
            <Input
              id="search"
              name="search"
              placeholder="Nome, email, telefone, documento…"
              defaultValue={filters.search}
            />
          </div>
          <div>
            <Label htmlFor="status">Status</Label>
            <Select id="status" name="status" defaultValue={filters.status}>
              <option value="">Todos</option>
              {CUSTOMER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s] ?? s}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="type">Tipo</Label>
            <Select id="type" name="type" defaultValue={filters.type}>
              <option value="">Todos</option>
              {CUSTOMER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t === 'INDIVIDUAL' ? 'Pessoa Física' : 'Pessoa Jurídica'}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="country">País do documento</Label>
            <Select id="country" name="country" defaultValue={filters.country}>
              <option value="">Todos</option>
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="tag">Tag</Label>
            <Select id="tag" name="tag" defaultValue={filters.tag}>
              <option value="">Todas</option>
              {tags?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="md:col-span-6 flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={clear}>
              Limpar
            </Button>
            <Button type="submit" variant="secondary">
              Aplicar
            </Button>
          </div>
        </form>
      </section>

      {isLoading && <PageLoader label="Buscando clientes…" />}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          Falha ao carregar clientes. {String((error as Error).message ?? '')}
        </div>
      )}

      {data && !isLoading && (
        <>
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead className="bg-slate-50 dark:bg-slate-900/40">
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Documento</th>
                    <th className="px-4 py-3">Contato</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Criado</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {data.data.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400"
                      >
                        Nenhum cliente encontrado com os filtros atuais.
                      </td>
                    </tr>
                  )}
                  {data.data.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                      <td className="px-4 py-3">
                        <Link
                          href={`/customers/${c.id}`}
                          className="font-medium text-brand-700 hover:underline dark:text-brand-300"
                        >
                          {c.displayName}
                        </Link>
                        {c.code && (
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            Código: {c.code}
                          </div>
                        )}
                        {c.tags && c.tags.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {c.tags.map((t) => (
                              <Badge key={t.id} tone="neutral" dot={t.color ?? undefined}>
                                {t.name}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={c.type === 'INDIVIDUAL' ? 'info' : 'brand'}>
                          {c.type === 'INDIVIDUAL' ? 'PF' : 'PJ'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                        {formatTaxId(c.taxIdType, c.taxId)}
                        {c.taxIdCountry && (
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {c.taxIdType} · {c.taxIdCountry}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                        {c.primaryEmail && <div className="truncate max-w-[220px]">{c.primaryEmail}</div>}
                        {c.primaryPhone && (
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {formatPhone(c.primaryPhone)}
                          </div>
                        )}
                        {!c.primaryEmail && !c.primaryPhone && (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={statusTone(c.status)}>
                          {STATUS_LABEL[c.status] ?? c.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {formatDate(c.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/customers/${c.id}`}
                          className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
                        >
                          Abrir
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <Pagination
            page={data.pagination.page}
            totalPages={data.pagination.totalPages}
            total={data.pagination.total}
            pageSize={data.pagination.pageSize}
            onPageChange={(page) => applyFilters({ page })}
          />
        </>
      )}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (p: number) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600 dark:text-slate-300">
      <span>
        Mostrando <strong>{from}</strong>–<strong>{to}</strong> de{' '}
        <strong>{total}</strong>
      </span>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Anterior
        </Button>
        <span>
          Página <strong>{page}</strong> de {totalPages}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Próxima
        </Button>
      </div>
    </div>
  );
}

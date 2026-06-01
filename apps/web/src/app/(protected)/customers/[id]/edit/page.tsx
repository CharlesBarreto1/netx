'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { CustomerForm } from '@/components/crm/CustomerForm';
import { PageLoader } from '@/components/ui/Spinner';
import { api } from '@/lib/api';
import type { Customer } from '@/lib/crm-types';

export default function EditCustomerPage() {
  const t = useTranslations('customersEdit');
  const tc = useTranslations('common');
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const key = id ? `/v1/customers/${id}` : null;

  const { data, isLoading, error, mutate } = useSWR<Customer>(key);

  async function handleSubmit(body: Record<string, unknown>) {
    if (!id) return;
    const updated = await api.patch<Customer>(`/v1/customers/${id}`, body);
    await mutate(updated, { revalidate: false });
    router.replace(`/customers/${id}`);
  }

  if (isLoading) return <PageLoader />;
  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        {t('loadFailed')}
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-5">
      <header>
        <nav className="text-xs text-slate-500 dark:text-slate-400">
          <Link href="/customers" className="hover:underline">
            {t('breadcrumbCustomers')}
          </Link>{' '}
          ›{' '}
          <Link href={`/customers/${data.id}`} className="hover:underline">
            {data.displayName}
          </Link>{' '}
          › {tc('edit')}
        </nav>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{t('title')}</h1>
      </header>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <CustomerForm
          mode="edit"
          initial={data}
          onSubmit={handleSubmit}
          onCancel={() => router.push(`/customers/${data.id}`)}
        />
      </div>
    </div>
  );
}

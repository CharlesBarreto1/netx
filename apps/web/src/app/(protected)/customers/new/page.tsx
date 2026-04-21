'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CustomerForm } from '@/components/crm/CustomerForm';
import { api } from '@/lib/api';
import type { Customer } from '@/lib/crm-types';

export default function NewCustomerPage() {
  const router = useRouter();

  async function handleSubmit(body: Record<string, unknown>) {
    const created = await api.post<Customer>('/v1/customers', body);
    router.replace(`/customers/${created.id}`);
  }

  return (
    <div className="space-y-5">
      <header>
        <nav className="text-xs text-slate-500 dark:text-slate-400">
          <Link href="/customers" className="hover:underline">
            Clientes
          </Link>{' '}
          › Novo
        </nav>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Novo cliente</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Cadastre um cliente Pessoa Física ou Pessoa Jurídica. Endereços, contatos adicionais e
          tags podem ser gerenciados depois no detalhe do cliente.
        </p>
      </header>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <CustomerForm
          mode="create"
          onSubmit={handleSubmit}
          onCancel={() => router.push('/customers')}
        />
      </div>
    </div>
  );
}

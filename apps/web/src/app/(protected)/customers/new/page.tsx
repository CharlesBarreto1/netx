'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { NewContractInline } from '@/components/contracts/NewContractInline';
import { CustomerForm } from '@/components/crm/CustomerForm';
import { Badge } from '@/components/ui/Badge';
import { api } from '@/lib/api';
import type { Contract } from '@/lib/contracts-api';
import type { Customer } from '@/lib/crm-types';

// Mesmo motivo de /contracts/new e /service-orders/new: usa providers
// (TenantConfig, I18n) só montados em runtime. Sem isso, Next 16 quebra o
// prerender com "useContext null".
export const dynamic = 'force-dynamic';

type Step = 'customer' | 'contract';

/**
 * /customers/new — fluxo unificado de criação.
 *
 * Passo 1: cadastra o cliente.
 * Passo 2 (opcional): logo após salvar, oferece criar o contrato já vinculado
 *   ao cliente recém-criado. Botão "Pular" leva direto pro detalhe do cliente.
 *
 * Esse fluxo é o mesmo aplicado quando o usuário converte um deal em cliente
 * (ver `ConvertDealDialog`), garantindo consistência.
 */
export default function NewCustomerPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('customer');
  const [customer, setCustomer] = useState<Customer | null>(null);

  async function handleCustomerSubmit(body: Record<string, unknown>) {
    const created = await api.post<Customer>('/v1/customers', body);
    setCustomer(created);
    setStep('contract');
  }

  function handleContractCreated(contract: Contract) {
    router.replace(`/contracts/${contract.id}`);
  }

  function handleSkipContract() {
    if (customer) router.replace(`/customers/${customer.id}`);
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
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">
            {step === 'customer' ? 'Novo cliente' : 'Novo cliente + contrato'}
          </h1>
          <Badge tone={step === 'customer' ? 'info' : 'success'}>
            {step === 'customer' ? '1/2 — Cliente' : '2/2 — Contrato (opcional)'}
          </Badge>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {step === 'customer'
            ? 'Cadastre um cliente Pessoa Física ou Pessoa Jurídica. Endereços, contatos adicionais e tags podem ser gerenciados depois no detalhe do cliente.'
            : 'Quer criar o contrato agora? Os campos básicos abaixo são suficientes para gerar a 1ª fatura e provisionar o RADIUS. Você pode pular e fazer isso depois.'}
        </p>
      </header>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        {step === 'customer' && (
          <CustomerForm
            mode="create"
            onSubmit={handleCustomerSubmit}
            onCancel={() => router.push('/customers')}
          />
        )}

        {step === 'contract' && customer && (
          <div className="flex flex-col gap-5">
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
              Cliente <strong>{customer.displayName}</strong> criado com sucesso. Quer
              gerar o contrato agora?
            </div>

            <NewContractInline
              lockedCustomerId={customer.id}
              submitLabel="Criar contrato"
              onCreated={handleContractCreated}
              onSkip={handleSkipContract}
              skipLabel="Pular — ir para o cliente"
            />
          </div>
        )}
      </div>
    </div>
  );
}

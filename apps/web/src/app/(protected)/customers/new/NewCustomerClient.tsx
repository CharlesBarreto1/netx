'use client';

/**
 * NewCustomerClient — conteúdo client da rota `/customers/new`.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Padrão server-wrapper: ver `page.tsx`.
 */
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { NewContractInline } from '@/components/contracts/NewContractInline';
import { NewInstallOrderInline } from '@/components/contracts/NewInstallOrderInline';
import { CustomerForm } from '@/components/crm/CustomerForm';
import { Badge } from '@/components/ui/Badge';
import { api } from '@/lib/api';
import type { Contract } from '@/lib/contracts-api';
import type { Customer } from '@/lib/crm-types';

type Step = 'customer' | 'contract' | 'serviceOrder';

/**
 * Wizard de criação de novo cliente — 3 passos:
 *
 *   1. Cliente   — cadastra o cliente (PF/PJ).
 *   2. Contrato  — cria o contrato já vinculado (nasce PENDING_INSTALL).
 *   3. O.S.      — gera a ordem de serviço de instalação (motivo padrão
 *                  "Instalação") pra o técnico executar em campo.
 *
 * Cada passo pode ser pulado. O fluxo conecta venda → contrato → instalação,
 * fechando o ciclo sem pontas soltas.
 */
export default function NewCustomerClient() {
  const t = useTranslations('customersNew');
  const router = useRouter();
  const [step, setStep] = useState<Step>('customer');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [contract, setContract] = useState<Contract | null>(null);

  async function handleCustomerSubmit(body: Record<string, unknown>) {
    const created = await api.post<Customer>('/v1/customers', body);
    setCustomer(created);
    setStep('contract');
  }

  function handleContractCreated(c: Contract) {
    setContract(c);
    setStep('serviceOrder');
  }

  function handleSkipContract() {
    if (customer) router.replace(`/customers/${customer.id}`);
  }

  function finishToContract() {
    if (contract) router.replace(`/contracts/${contract.id}`);
  }

  return (
    <div className="space-y-5">
      <header>
        <nav className="text-xs text-slate-500 dark:text-slate-400">
          <Link href="/customers" className="hover:underline">
            {t('breadcrumbCustomers')}
          </Link>{' '}
          › {t('breadcrumbNew')}
        </nav>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <Badge tone={step === 'customer' ? 'info' : 'success'}>
            {step === 'customer'
              ? t('badgeCustomer')
              : step === 'contract'
                ? t('badgeContract')
                : t('badgeInstall')}
          </Badge>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {step === 'customer'
            ? t('descCustomer')
            : step === 'contract'
              ? t('descContract')
              : t('descInstall')}
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
              {t.rich('customerCreated', {
                name: customer.displayName,
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </div>

            <NewContractInline
              lockedCustomerId={customer.id}
              submitLabel={t('createContract')}
              onCreated={handleContractCreated}
              onSkip={handleSkipContract}
              skipLabel={t('skipToCustomer')}
            />
          </div>
        )}

        {step === 'serviceOrder' && contract && (
          <NewInstallOrderInline
            contract={contract}
            onCreated={() => finishToContract()}
            onSkip={finishToContract}
          />
        )}
      </div>
    </div>
  );
}

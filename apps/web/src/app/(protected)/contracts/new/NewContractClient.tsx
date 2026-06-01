'use client';

/**
 * NewContractClient — conteúdo client da rota `/contracts/new`.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Padrão server-wrapper: a `page.tsx` é server component que exporta
 * `dynamic = 'force-dynamic'` e renderiza esse Client. Necessário porque
 * Next 16 ignora route segment config (`dynamic`, `revalidate`, ...) em
 * client components — sem o wrapper, o prerender tenta executar `useTenantConfig`
 * em build time e quebra com "Cannot read properties of null (reading 'useContext')".
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { NewContractInline } from '@/components/contracts/NewContractInline';
import type { Contract } from '@/lib/contracts-api';

export default function NewContractClient() {
  const t = useTranslations('contractNew');
  const router = useRouter();
  const params = useSearchParams();
  const prefilledCustomerId = params.get('customerId');

  function onCreated(contract: Contract) {
    router.push(`/contracts/${contract.id}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Link href="/contracts" className="text-xs text-text-muted hover:text-text">
          {t('backToContracts')}
        </Link>
      </div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-text">{t('title')}</h1>
        <p className="text-xs text-text-muted">{t('description')}</p>
      </div>

      <div className="rounded-md border border-border bg-surface p-4">
        <NewContractInline
          lockedCustomerId={prefilledCustomerId ?? undefined}
          onCreated={onCreated}
          onCancel={() => router.push('/contracts')}
        />
      </div>
    </div>
  );
}

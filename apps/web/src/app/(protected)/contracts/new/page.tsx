'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { NewContractInline } from '@/components/contracts/NewContractInline';
import type { Contract } from '@/lib/contracts-api';

/**
 * /contracts/new — wrapper fino sobre `NewContractInline`.
 *
 * Antes essa página tinha o seu próprio form (duplicado com o componente
 * inline). Foi consolidado pra evitar drift: country-aware, mapsUrl e moeda
 * do tenant ficam num só lugar.
 *
 * `?customerId=<uuid>` continua suportado — pré-trava o select de cliente.
 */
export default function NewContractPage() {
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
          ← Contratos
        </Link>
      </div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-text">Novo contrato</h1>
        <p className="text-xs text-text-muted">
          Ao criar, geramos a 1ª fatura automaticamente e registramos a autorização no RADIUS.
        </p>
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

/**
 * /contracts/new — server wrapper.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Por que server + client split: Next 16 IGNORA route segment config
 * (`dynamic`, `revalidate`, etc.) em client components. Sem o wrapper server,
 * o Next tentou prerender e quebrou com:
 *   TypeError: Cannot read properties of null (reading 'useContext')
 *
 * Aqui o page é server (sem `'use client'`), exporta `dynamic = 'force-dynamic'`,
 * e delega o conteúdo pro `NewContractClient` que pode usar hooks/providers
 * de runtime (TenantConfig, I18n, useRouter, useSearchParams) sem ser
 * pre-renderizado em build.
 */
import NewContractClient from './NewContractClient';

export const dynamic = 'force-dynamic';

export default function NewContractPage() {
  return <NewContractClient />;
}

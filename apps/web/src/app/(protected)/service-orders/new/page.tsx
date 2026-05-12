/**
 * /service-orders/new — server wrapper.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Padrão server-wrapper: Next 16 IGNORA route segment config
 * (`dynamic`, `revalidate`, etc.) em client components. Sem o wrapper server,
 * o Next tentou prerender e quebrou com:
 *   TypeError: Cannot read properties of null (reading 'useContext')
 *
 * Aqui o page é server (sem `'use client'`), exporta `dynamic = 'force-dynamic'`,
 * e delega o conteúdo pro `NewServiceOrderClient` que usa hooks/providers
 * de runtime (useTranslations, useRouter, useSearchParams, SWR).
 */
import NewServiceOrderClient from './NewServiceOrderClient';

export const dynamic = 'force-dynamic';

export default function NewServiceOrderPage() {
  return <NewServiceOrderClient />;
}

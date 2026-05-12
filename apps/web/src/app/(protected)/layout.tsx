/**
 * (protected)/layout.tsx — server layout que propaga `dynamic = 'force-dynamic'`
 * pra TODAS as pages descendentes.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Por que server: Next 16 IGNORA `export const dynamic` em client components.
 * Tendo o layout como server component, o force-dynamic pega TODAS as pages
 * do (protected) automaticamente — sem precisar de `dynamic` em cada page.
 *
 * Toda a lógica (session check, providers, AppShell) fica em
 * `ProtectedClientLayout` que é client e roda em runtime.
 */
import ProtectedClientLayout from './ProtectedClientLayout';

export const dynamic = 'force-dynamic';

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedClientLayout>{children}</ProtectedClientLayout>;
}

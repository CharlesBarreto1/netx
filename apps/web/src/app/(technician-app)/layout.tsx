/**
 * (technician-app)/layout.tsx — server layout da tela de campo do técnico (/os).
 *
 * Mesma estratégia do (fullscreen): força-dynamic no server, runtime no client
 * (TechnicianClientLayout). Mobile-first, sem AppShell/sidebar — o técnico em
 * campo usa 1 tela só pelo navegador (enquanto não há app nativo).
 */
import TechnicianClientLayout from './TechnicianClientLayout';

export const dynamic = 'force-dynamic';

export default function TechnicianLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <TechnicianClientLayout>{children}</TechnicianClientLayout>;
}

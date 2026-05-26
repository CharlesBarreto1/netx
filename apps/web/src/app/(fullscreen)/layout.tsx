/**
 * (fullscreen)/layout.tsx — server layout pra rotas que precisam de tela cheia
 * sem o chrome do app (header + sidebar globais do AppShell).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Caso de uso: estúdio de mapeamento, viewers de diagramas, prints
 * técnicos — qualquer tela onde o operador quer 100% do viewport pro
 * trabalho real.
 *
 * Mesma estratégia do (protected): força-dynamic no server, lógica de
 * runtime no client (FullscreenClientLayout).
 */
import FullscreenClientLayout from './FullscreenClientLayout';

export const dynamic = 'force-dynamic';

export default function FullscreenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <FullscreenClientLayout>{children}</FullscreenClientLayout>;
}

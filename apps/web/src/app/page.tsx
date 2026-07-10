'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { getSession } from '@/lib/session';

/**
 * Raiz do sistema (`/`) — gateway de entrada. O antigo hotsite foi aposentado:
 * a raiz agora não tem conteúdo próprio, só decide o destino.
 *
 *   • Com sessão ativa  → /dashboard
 *   • Sem sessão        → /login  (a tela de login é a "cara" do sistema pra
 *                         quem não está logado)
 *
 * Por que client-side e não middleware: a sessão vive em localStorage (ver
 * lib/session.ts), inacessível no edge/server. Todo o resto do app já resolve
 * auth no cliente (ProtectedLayout, interceptor de 401 em lib/api.ts), então o
 * gateway segue o mesmo modelo. Renderiza um fundo neutro enquanto redireciona
 * pra evitar flash de conteúdo.
 */
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace(getSession() ? '/dashboard' : '/login');
  }, [router]);

  return <main className="min-h-screen bg-bg" />;
}

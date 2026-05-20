'use client';

/**
 * global-error.tsx — Error Boundary raiz do Next.js.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Por que existe: Next 16 tenta prerender automaticamente uma página
 * `/_global-error` quando não há `global-error.tsx` no app/. O `_global-error`
 * auto-gerado faz `useContext` num componente sem provider e quebra o build
 * com "Cannot read properties of null (reading 'useContext')". Fornecer um
 * global-error.tsx explícito substitui o auto-gerado e desbloqueia o build.
 *
 * Esta página captura erros não tratados em qualquer rota (inclusive no
 * root layout). Renderiza um shell minimalista sem providers — assim não
 * depende de SWR/I18n/Tenant pra mostrar a mensagem.
 */
import { useEffect } from 'react';

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Detecta ChunkLoadError — sinal de que o build atual no servidor mudou
 * (chunks com hash novo) mas o browser tem HTML/cache de versão antiga.
 *
 * Padrões reconhecidos:
 *   - error.name === 'ChunkLoadError'                       (Next default)
 *   - Mensagem contém "Failed to load chunk"                (Webpack/Turbopack)
 *   - Mensagem contém "Loading chunk … failed"              (Webpack clássico)
 *   - Mensagem contém "Loading CSS chunk … failed"          (CSS hash mismatch)
 *
 * NÃO é qualquer erro de rede — só os que indicam que o bundle está
 * dessincronizado. Outros 500s caem no fluxo normal de "Tentar de novo".
 */
function isChunkLoadError(err: Error & { name?: string }): boolean {
  if (err.name === 'ChunkLoadError') return true;
  const msg = err.message ?? '';
  return (
    /Failed to load chunk/i.test(msg) ||
    /Loading chunk \S+ failed/i.test(msg) ||
    /Loading CSS chunk \S+ failed/i.test(msg)
  );
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    // ChunkLoadError = browser tem cache de HTML/JS dessincronizado com
    // o build atual no servidor. Auto-recover via hard reload — usa um
    // marker em sessionStorage pra evitar loop (se reload falhar de novo,
    // mostra a tela de erro pro user em vez de relodar infinitamente).
    if (typeof window !== 'undefined' && isChunkLoadError(error)) {
      const RELOAD_KEY = 'netx.chunkErrorReloadAttempted';
      const alreadyTried = sessionStorage.getItem(RELOAD_KEY);
      if (!alreadyTried) {
        sessionStorage.setItem(RELOAD_KEY, Date.now().toString());
        // Forçar bypass do cache — equivale a hard reload (Ctrl+Shift+R).
        // `window.location.reload()` sem arg respeita cache em Safari/Firefox;
        // adicionar um query param garante novo fetch do HTML em todo browser.
        const url = new URL(window.location.href);
        url.searchParams.set('_r', Date.now().toString());
        window.location.replace(url.toString());
        return;
      }
      // Já tentou — limpa marker e cai pra tela de erro manual.
      sessionStorage.removeItem(RELOAD_KEY);
    }

    // Em prod, encaminhar pra Sentry / observabilidade aqui (futuro).
    console.error('[global-error]', error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          fontFamily:
            'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          background: '#0f172a',
          color: '#e2e8f0',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}
      >
        <div
          style={{
            maxWidth: '480px',
            width: '100%',
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '12px',
            padding: '32px',
          }}
        >
          <h1 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 8px' }}>
            Algo deu errado
          </h1>
          <p style={{ fontSize: '14px', color: '#94a3b8', margin: '0 0 16px' }}>
            Encontramos um erro inesperado. Tente recarregar a página.
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: '12px',
                color: '#64748b',
                margin: '0 0 16px',
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              Código: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              padding: '10px 16px',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Tentar de novo
          </button>
        </div>
      </body>
    </html>
  );
}

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

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    // Em prod, encaminhar pra Sentry / observabilidade aqui (futuro).
    // Em dev, dá no console pra debug rápido.
    // eslint-disable-next-line no-console
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

'use client';

/**
 * BrOnly — guarda de país: renderiza o conteúdo só para tenants do Brasil.
 * Espelha o gating de menu (visibleIfCountry: ['BR']) para acesso por URL direta.
 * Enquanto o país não carregou (null), renderiza normalmente para evitar flash.
 */
import type { ReactNode } from 'react';

import { useTenantConfig } from '@/lib/tenant-config';

export function BrOnly({ children }: { children: ReactNode }) {
  const cfg = useTenantConfig();
  const country = cfg?.tenant?.country ?? null;

  if (country && country !== 'BR') {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-border bg-surface p-8 text-center">
        <h1 className="text-lg font-semibold text-text">Módulo indisponível</h1>
        <p className="mt-2 text-sm text-text-muted">
          A NFCom (modelo 62) é um documento fiscal brasileiro e só está
          disponível para operações no Brasil.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

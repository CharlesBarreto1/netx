/**
 * RootLayout — Next.js shell.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 *
 * Fontes SELF-HOSTED via `@fontsource-variable/*` — Inter Variable (UI) +
 * JetBrains Mono Variable (números, código). Vêm pelo `npm ci` (sem fetch ao
 * Google Fonts no build — a VP de produção não tem saída pro googleapis e o
 * `next/font/google` quebrava o build com timeout). Os CSS vars `--font-sans` e
 * `--font-mono` são setados no <html> e consumidos por `globals.css` no `@theme`.
 *
 * Density default = `cozy`. Cookie/localStorage do user pode trocar pra
 * `compact` ou `comfortable` em runtime via DensityProvider no ProtectedLayout.
 */
import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './globals.css';

// Mesmos CSS vars que o `next/font` setava — agora apontando pras famílias
// self-hosted. Geist + Geist Mono = sistema tipográfico do design (handoff do
// shell). Ver design_handoff_netx_shell/README.md.
const FONT_VARS = {
  '--font-sans': "'Geist Variable', system-ui, -apple-system, Segoe UI, sans-serif",
  '--font-mono': "'Geist Mono Variable', ui-monospace, SFMono-Regular, monospace",
} as CSSProperties;

export const metadata: Metadata = {
  title: 'NetX',
  description: 'Plataforma multinacional para ISPs',
  applicationName: 'NetX',
  authors: [{ name: 'NETX DESENVOLVIMENTO E TECNOLOGIA LTDA', url: 'https://netx.com.br' }],
  generator: 'NetX',
  publisher: 'NETX DESENVOLVIMENTO E TECNOLOGIA LTDA',
  other: {
    pv: 'Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=',
  },
};

/**
 * Script anti-FOUC de tema. Roda ANTES do primeiro paint (inline no <head>),
 * lendo a preferência salva em localStorage['netx.theme'] e aplicando a
 * classe .dark/.light no <html>. Sem isso, haveria um flash do tema errado
 * em cada navegação (o React só hidrata depois do paint).
 *
 * Regra: CLARO por padrão. Só fica escuro se o usuário escolheu 'dark'
 * explicitamente (persistido em localStorage['netx.theme']).
 */
const THEME_INIT_SCRIPT = `(function(){try{
var t=localStorage.getItem('netx.theme');
var dark=t==='dark';
var el=document.documentElement;
el.classList.toggle('dark',dark);
el.classList.toggle('light',!dark);
}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      style={FONT_VARS}
      data-density="cozy"
      suppressHydrationWarning
    >
      <head>
        {/* Tema aplicado antes do paint — evita flash claro→escuro. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      {/* © 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — CNPJ 57.118.236/0001-44 */}
      <body className="bg-bg text-text antialiased">{children}</body>
    </html>
  );
}

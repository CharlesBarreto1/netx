/**
 * RootLayout — Next.js shell.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 *
 * Fontes carregadas via `next/font/google` — Inter Variable (UI) + JetBrains
 * Mono Variable (números, código). Os CSS vars `--font-sans` e `--font-mono`
 * são consumidos por `globals.css` no `@theme`.
 *
 * Density default = `cozy`. Cookie/localStorage do user pode trocar pra
 * `compact` ou `comfortable` em runtime via DensityProvider no ProtectedLayout.
 */
import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const fontSans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

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
 * Regra: preferência salva vence; sem preferência, segue prefers-color-scheme.
 */
const THEME_INIT_SCRIPT = `(function(){try{
var t=localStorage.getItem('netx.theme');
var sysDark=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;
var dark=t==='dark'||(t==null&&sysDark);
var el=document.documentElement;
el.classList.toggle('dark',dark);
el.classList.toggle('light',!dark);
}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${fontSans.variable} ${fontMono.variable}`}
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

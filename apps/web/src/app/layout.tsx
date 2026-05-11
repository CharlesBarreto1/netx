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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${fontSans.variable} ${fontMono.variable}`}
      data-density="cozy"
      suppressHydrationWarning
    >
      {/* © 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — CNPJ 57.118.236/0001-44 */}
      <body className="bg-bg text-text antialiased">{children}</body>
    </html>
  );
}

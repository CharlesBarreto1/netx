/**
 * RootLayout — Next.js shell.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NetX',
  description: 'Plataforma multinacional para ISPs',
  applicationName: 'NetX',
  authors: [{ name: 'NETX DESENVOLVIMENTO E TECNOLOGIA LTDA', url: 'https://netx.com.br' }],
  generator: 'NetX',
  publisher: 'NETX DESENVOLVIMENTO E TECNOLOGIA LTDA',
  other: {
    'pv': 'Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      {/* © 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — CNPJ 57.118.236/0001-44 */}
      <body>{children}</body>
    </html>
  );
}

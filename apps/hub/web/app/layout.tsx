import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'NetX Hub',
  description: 'Licenciamento e cobrança NetX',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NetX',
  description: 'Plataforma multinacional para ISPs',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

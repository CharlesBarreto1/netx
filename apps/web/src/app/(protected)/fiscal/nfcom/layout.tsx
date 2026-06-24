/**
 * Layout do segmento /fiscal/nfcom — gating por país (BR) para lista, detalhe
 * e DANFE-COM de uma vez. Espelha o visibleIfCountry do menu.
 */
import { BrOnly } from '@/components/fiscal/BrOnly';

export default function NfcomFiscalLayout({ children }: { children: React.ReactNode }) {
  return <BrOnly>{children}</BrOnly>;
}

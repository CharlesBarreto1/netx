/**
 * Layout de /settings/nfcom — gating por país (BR). Espelha o menu.
 */
import { BrOnly } from '@/components/fiscal/BrOnly';

export default function NfcomSettingsLayout({ children }: { children: React.ReactNode }) {
  return <BrOnly>{children}</BrOnly>;
}

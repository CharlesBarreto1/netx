/**
 * /customers/new — server wrapper. Ver `NewCustomerClient.tsx` pro conteúdo.
 */
import NewCustomerClient from './NewCustomerClient';

export const dynamic = 'force-dynamic';

export default function NewCustomerPage() {
  return <NewCustomerClient />;
}

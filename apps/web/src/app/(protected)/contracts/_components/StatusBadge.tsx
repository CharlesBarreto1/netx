import { Badge } from '@/components/ui/Badge';
import type { ContractStatus } from '@/lib/contracts-api';

/**
 * Badge de status de contrato — extraída para um arquivo próprio porque
 * `page.tsx` no App Router não aceita exports nomeados além das chaves
 * reservadas (default, metadata, generateMetadata, etc.).
 */
export function StatusBadge({ status }: { status: ContractStatus }) {
  switch (status) {
    case 'ACTIVE':
      return <Badge tone="success">Ativo</Badge>;
    case 'SUSPENDED':
      return <Badge tone="warning">Suspenso</Badge>;
    case 'CANCELLED':
      return <Badge tone="danger">Cancelado</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

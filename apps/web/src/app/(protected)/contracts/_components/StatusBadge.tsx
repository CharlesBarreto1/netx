'use client';

import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/Badge';
import type { ContractStatus } from '@/lib/contracts-api';

/**
 * Badge de status de contrato — extraída para um arquivo próprio porque
 * `page.tsx` no App Router não aceita exports nomeados além das chaves
 * reservadas (default, metadata, generateMetadata, etc.).
 */
export function StatusBadge({ status }: { status: ContractStatus }) {
  const t = useTranslations('components.contractStatus');

  switch (status) {
    case 'PENDING_INSTALL':
      return <Badge tone="info">{t('PENDING_INSTALL')}</Badge>;
    case 'ACTIVE':
      return <Badge tone="success">{t('ACTIVE')}</Badge>;
    case 'SUSPENDED':
      return <Badge tone="warning">{t('SUSPENDED')}</Badge>;
    case 'CANCELLED':
      return <Badge tone="danger">{t('CANCELLED')}</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

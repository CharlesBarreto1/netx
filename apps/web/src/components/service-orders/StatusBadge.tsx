'use client';

import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/Badge';
import {
  SO_STATUS_TONE,
  type ServiceOrderDisplayStatus,
} from '@/lib/service-orders-api';

/**
 * Badge de status de O.S. Cores fixas (briefing):
 *   OPEN=Amarela, SCHEDULED=Azul, IN_PROGRESS=Roxa, OVERDUE=Vermelha,
 *   COMPLETED=Verde, CANCELLED=Cinza.
 *
 * O label vem do dicionário `serviceOrders.statusLabel.<KEY>`.
 */
export function ServiceOrderStatusBadge({
  status,
}: {
  status: ServiceOrderDisplayStatus;
}) {
  const t = useTranslations('serviceOrders.statusLabel');
  return <Badge tone={SO_STATUS_TONE[status]}>{t(status)}</Badge>;
}

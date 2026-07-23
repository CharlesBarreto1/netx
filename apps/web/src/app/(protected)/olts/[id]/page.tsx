'use client';

/**
 * /olts/[id] — detalhe da OLT.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Layout:
 *   - Header: voltar, nome, vendor/model, status
 *   - Card POP vinculado + atalho pro FiberMap (planta externa / OSP v2).
 *
 * O vínculo PON ↔ cabo/fibra do OSP v1 foi aposentado — a documentação da
 * planta óptica (caixas, cabos, splitters, drops) agora vive no FiberMap.
 */
import { ArrowLeft, MapPin } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import useSWR from 'swr';

import { OntDiscoveryPanel } from '@/components/olts/OntDiscoveryPanel';
import { Badge } from '@/components/ui/Badge';
import { PageLoader } from '@/components/ui/Spinner';
import type { Olt } from '@/lib/olts-api';

export default function OltDetailPage() {
  const t = useTranslations('olts.detail');
  const tc = useTranslations('common');
  const params = useParams<{ id: string }>();
  const oltId = params?.id;

  const { data: olt, isLoading } = useSWR<Olt>(
    oltId ? `/v1/olts/${oltId}` : null,
  );

  if (isLoading || !olt) return <PageLoader label={t('loadingOlt')} />;

  return (
    <div className="space-y-5">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3">
        <Link
          href="/olts"
          className="text-text-muted hover:text-text"
          title={tc('back')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight truncate">
            {olt.name}
          </h1>
          <p className="text-xs text-text-muted">
            {olt.vendor} {olt.model}
            {olt.managementIp && (
              <>
                {' · '}
                <code>{olt.managementIp}</code>
              </>
            )}
          </p>
        </div>
        <Badge
          tone={
            olt.status === 'ONLINE'
              ? 'success'
              : olt.status === 'OFFLINE' || olt.status === 'UNREACHABLE'
                ? 'danger'
                : 'neutral'
          }
        >
          {olt.status}
        </Badge>
      </header>

      {/* Card POP vinculado + atalho pro FiberMap */}
      <section className="rounded-md border border-border bg-surface p-4 text-sm">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-text-muted" />
          <span className="font-semibold">{t('linkedPop')}</span>
          {olt.pop ? (
            <span className="font-mono">
              {olt.pop.name}
              {olt.pop.code ? ` (${olt.pop.code})` : ''}
            </span>
          ) : (
            <span className="italic text-text-muted">
              {t('popNotLinked')}
            </span>
          )}
          <Link href="/fibermap" className="ml-auto text-xs text-brand-500 hover:underline">
            {t('openFibermap')}
          </Link>
        </div>
      </section>

      {/* Descoberta de ONU — só p/ OLTs que o driver sabe varrer (Fiberhome hoje) */}
      {olt.vendor === 'FIBERHOME' && oltId && <OntDiscoveryPanel oltId={oltId} />}
    </div>
  );
}

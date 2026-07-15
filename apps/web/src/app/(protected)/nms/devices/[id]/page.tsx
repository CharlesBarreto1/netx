'use client';

/**
 * /nms/devices/[id] — Painel do device gerenciado pelo NMS, DENTRO do shell do
 * NetX. Porta o `Console`/`Dashboard` do SPA standalone como page nativa: abas
 * Visão geral · Backups · Playbooks · Aplicar config · Terminal · Copiloto,
 * todas batendo no gateway `/v1/nms/*` (SSO + entitlement automáticos).
 * Ver docs/ecosystem/INTEGRATION-RUNBOOK.md §A.
 */
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { PageLoader } from '@/components/ui/Spinner';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { hasPermission } from '@/lib/session';
import { nmsApi } from '@/lib/nms-api';

import { BackupsTab } from '../../_components/BackupsTab';
import { ConfigApplyTab } from '../../_components/ConfigApplyTab';
import { CopilotTab } from '../../_components/CopilotTab';
import { OverviewTab } from '../../_components/OverviewTab';
import { PlaybooksTab } from '../../_components/PlaybooksTab';
import { TerminalTab } from '../../_components/TerminalTab';

type TabKey = 'overview' | 'backups' | 'playbooks' | 'apply' | 'terminal' | 'copilot';

export default function NmsDeviceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [tab, setTab] = useState<TabKey>('overview');
  const canWrite = hasPermission('network.write') || hasPermission('users.write');

  const { data: device, isLoading, error } = useSWR(id ? `nms/device/${id}` : null, () =>
    nmsApi.getDevice(id),
  );

  const items = useMemo<TabItem<TabKey>[]>(() => {
    const base: TabItem<TabKey>[] = [
      { value: 'overview', label: 'Visão geral' },
      { value: 'backups', label: 'Backups' },
      { value: 'playbooks', label: 'Playbooks' },
    ];
    if (canWrite) {
      base.push(
        { value: 'apply', label: 'Aplicar config' },
        { value: 'terminal', label: 'Terminal' },
      );
    }
    base.push({ value: 'copilot', label: 'Copiloto' });
    return base;
  }, [canWrite]);

  if (isLoading) return <PageLoader />;
  if (error || !device) {
    return (
      <div className="space-y-4">
        <Link
          href="/nms/devices"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          Device não encontrado ou NMS indisponível.
        </div>
      </div>
    );
  }

  const vendor = device.vendor;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Link
          href="/nms/devices"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-4 w-4" /> Roteadores (NMS)
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            {device.hostname}
          </h1>
          <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {vendor}
          </span>
        </div>
        <p className="text-sm text-slate-500">
          <span className="font-mono">{device.mgmtIp}</span>
          {device.model ? ` · ${device.model}` : ''}
          {device.site ? ` · ${device.site}` : ''}
        </p>
      </div>

      <Tabs value={tab} onChange={setTab} items={items} />

      {tab === 'overview' && (
        <OverviewTab deviceId={id} vendor={vendor} canWrite={canWrite} />
      )}
      {tab === 'backups' && <BackupsTab deviceId={id} canWrite={canWrite} />}
      {tab === 'playbooks' && (
        <PlaybooksTab deviceId={id} vendor={vendor} canWrite={canWrite} />
      )}
      {tab === 'apply' && canWrite && <ConfigApplyTab deviceId={id} vendor={vendor} />}
      {tab === 'terminal' && canWrite && <TerminalTab deviceId={id} />}
      {tab === 'copilot' && <CopilotTab deviceId={id} />}
    </div>
  );
}

'use client';

import { Plus, Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { DealBoard } from '@/components/deals/DealBoard';
import { DealDetailDialog } from '@/components/deals/DealDetailDialog';
import { NewDealDialog } from '@/components/deals/NewDealDialog';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { dealsApi, pipelinesApi } from '@/lib/crm-sales-api';
import type { DealBoard as DealBoardType, Pipeline } from '@/lib/crm-sales-types';
import { hasPermission } from '@/lib/session';

/**
 * /deals — Kanban board de oportunidades.
 *
 * MVP enxuto: lista pipelines do tenant, abre o pipeline default na primeira
 * carga, e mostra o board correspondente. Novo deal via dialog (botão "Novo
 * deal" no header ou "+" em cada coluna).
 */
export default function DealsPage() {
  const canCreate = hasPermission('deals.write');
  const tDeals = useTranslations('deals');
  const tx = useTranslations('dealsExtra');
  const tc = useTranslations('common');

  // Pipelines ativos do tenant
  const { data: pipelines } = useSWR<Pipeline[]>(pipelinesApi.path());

  const [pipelineId, setPipelineId] = useState<string | null>(null);

  // Seleciona o default na primeira carga.
  useEffect(() => {
    if (pipelineId || !pipelines || pipelines.length === 0) return;
    const def = pipelines.find((p) => p.isDefault) ?? pipelines[0];
    setPipelineId(def.id);
  }, [pipelines, pipelineId]);

  const currentPipeline = pipelines?.find((p) => p.id === pipelineId) ?? null;

  // Board do pipeline selecionado
  const boardKey = pipelineId ? dealsApi.boardPath({ pipelineId }) : null;
  const {
    data: board,
    isLoading: boardLoading,
    mutate: mutateBoard,
  } = useSWR<DealBoardType>(boardKey);

  // Dialog "Novo deal"
  const [dialogOpen, setDialogOpen] = useState(false);
  const [defaultStageId, setDefaultStageId] = useState<string | null>(null);

  // Dialog de detalhe (edição + ações + conversão)
  const [detailDealId, setDetailDealId] = useState<string | null>(null);
  const detailOpen = detailDealId !== null;

  function openNewDealAt(stageId?: string) {
    setDefaultStageId(stageId ?? null);
    setDialogOpen(true);
  }

  function openDealDetail(dealId: string) {
    setDetailDealId(dealId);
  }

  return (
    <TooltipProvider>
      <div className="flex h-[calc(100vh-3.5rem-3rem)] min-h-0 flex-col gap-4">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-col">
            <h1 className="text-xl font-semibold tracking-tight text-text">
              {tDeals('title')}
            </h1>
            <p className="text-xs text-text-muted">{tDeals('subtitle')}</p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {pipelines && pipelines.length > 0 && (
              <Select
                aria-label="Pipeline"
                className="h-8 w-56 py-1"
                value={pipelineId ?? ''}
                onChange={(e) => setPipelineId(e.target.value)}
              >
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.isDefault ? tx('defaultSuffix') : ''}
                  </option>
                ))}
              </Select>
            )}

            <Button variant="outline" size="md" disabled aria-label={tx('configurePipeline')}>
              <Settings2 className="h-3.5 w-3.5" />
              <span className="hidden md:inline">{tx('configure')}</span>
            </Button>

            {canCreate && (
              <Button onClick={() => openNewDealAt()} disabled={!currentPipeline}>
                <Plus className="h-3.5 w-3.5" />
                {tc('new')} deal
              </Button>
            )}
          </div>
        </div>

        {/* Board */}
        <div className="min-h-0 flex-1">
          {!pipelines ? (
            <PageLoader label={tx('loadingPipeline')} />
          ) : pipelines.length === 0 ? (
            <EmptyState />
          ) : boardLoading || !board ? (
            <PageLoader label={tx('loadingPipeline')} />
          ) : (
            <DealBoard
              board={board}
              onAddDeal={openNewDealAt}
              onOpenDeal={openDealDetail}
              onMutated={() => mutateBoard()}
            />
          )}
        </div>

        {/* Dialog de criação */}
        <NewDealDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          pipeline={currentPipeline}
          defaultStageId={defaultStageId}
          onCreated={() => mutateBoard()}
        />

        {/* Dialog de detalhe / edição / conversão */}
        <DealDetailDialog
          open={detailOpen}
          dealId={detailDealId}
          pipeline={currentPipeline}
          onOpenChange={(v) => {
            if (!v) setDetailDealId(null);
          }}
          onMutated={() => mutateBoard()}
        />
      </div>
    </TooltipProvider>
  );
}

function EmptyState() {
  const tx = useTranslations('dealsExtra');
  return (
    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border surface-aurora">
      <div className="max-w-md text-center">
        <h3 className="text-base font-semibold text-text">{tx('noPipeline')}</h3>
        <p className="mt-1 text-sm text-text-muted">
          {tx.rich('noPipelineHelp', {
            code: (chunks) => (
              <code className="rounded bg-surface-muted px-1">{chunks}</code>
            ),
          })}
        </p>
      </div>
    </div>
  );
}

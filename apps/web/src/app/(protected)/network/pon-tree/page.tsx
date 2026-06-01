'use client';

/**
 * /network/pon-tree — vista de árvore lógica (R7 OSP).
 *
 * Operador escolhe uma caixa raiz (geralmente uma CTO ligada à OLT) e
 * vê o grafo descendo: cabos → splitters → drops → ONTs (folhas).
 * Útil pra diagnóstico ("onde está o cliente X na cadeia?") e planning
 * ("qual o caminho lógico do POP-Centro até esse bairro?").
 *
 * v1 sem clique-pra-detalhe inline — click em nó leva pra
 * /network/optical/[id] (vista esquemática). v2 pode mostrar painel
 * lateral com os detalhes da caixa selecionada.
 */
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import useSWR from 'swr';

import { PonTreeView } from '@/components/optical/PonTreeView';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Label, Select } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import {
  ponTreeApi,
  type PonTreeResponse,
  type PonTreeRootCandidate,
} from '@/lib/pon-tree-api';

export default function PonTreePage() {
  const t = useTranslations('network.ponTree');
  const tc = useTranslations('common');
  const router = useRouter();
  const params = useSearchParams();
  const rootId = params?.get('root') ?? '';

  // Lista de caixas pra Select de raiz.
  const { data: roots } = useSWR<PonTreeRootCandidate[]>(ponTreeApi.rootsPath());
  // Árvore só carrega quando rootId está preenchido.
  const { data: tree, isLoading, error } = useSWR<PonTreeResponse>(
    rootId ? ponTreeApi.treePath(rootId) : null,
  );

  const orderedRoots = useMemo(() => {
    if (!roots) return [];
    return [...roots].sort((a, b) => {
      // Candidatos naturais primeiro (não recebem cabo), depois alfabético.
      if (a.isRootCandidate !== b.isRootCandidate) {
        return a.isRootCandidate ? -1 : 1;
      }
      return a.code.localeCompare(b.code);
    });
  }, [roots]);

  function setRoot(id: string) {
    const usp = new URLSearchParams(params?.toString() ?? '');
    if (id) usp.set('root', id);
    else usp.delete('root');
    router.replace(`/network/pon-tree?${usp.toString()}`);
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-text-muted">{t('subtitle')}</p>
      </header>

      <section className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface p-3">
        <div className="flex-1 min-w-[240px]">
          <Label htmlFor="pt-root">{t('rootBox')}</Label>
          <Select
            id="pt-root"
            value={rootId}
            onChange={(e) => setRoot(e.target.value)}
          >
            <option value="">{t('selectPlaceholder')}</option>
            {orderedRoots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.isRootCandidate ? '★ ' : ''}
                {r.code} ({r.type})
                {r.outgoingCableCount > 0
                  ? ` · ${t('outgoingCount', { count: r.outgoingCableCount })}`
                  : ''}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-text-muted">{t('rootHint')}</p>
        </div>

        {tree && (
          <div className="flex gap-2 text-xs">
            <Badge tone="info">{t('statNodes', { count: tree.stats.totalNodes })}</Badge>
            <Badge tone="brand">{t('statCables', { count: tree.stats.totalCables })}</Badge>
            <Badge tone="success">{t('statDrops', { count: tree.stats.leafClients })}</Badge>
            <Badge tone="neutral">{t('statDepth', { depth: tree.stats.maxDepth })}</Badge>
          </div>
        )}
      </section>

      {!rootId && (
        <div className="rounded-md border border-border bg-surface p-8 text-center text-sm text-text-muted">
          {t('emptyState')}
        </div>
      )}

      {rootId && isLoading && (
        <PageLoader label={t('building')} />
      )}

      {rootId && error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error instanceof ApiError ? error.friendlyMessage : tc('error')}
        </div>
      )}

      {tree && (
        <>
          <PonTreeView
            root={tree.root}
            onNodeClick={(id) => router.push(`/network/optical/${id}`)}
          />
          <div className="flex items-center gap-3 text-xs text-text-muted">
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-6 rounded-sm" style={{ backgroundColor: '#1d4ed8' }} />
              {t('legendBackbone')}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-6 rounded-sm" style={{ backgroundColor: '#9333ea' }} />
              {t('legendDistribution')}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-6 rounded-sm border border-dashed" style={{ backgroundColor: '#0d9488' }} />
              {t('legendDrop')}
            </span>
            <span className="ml-auto">{t('clickHint')}</span>
          </div>
        </>
      )}
    </div>
  );
}

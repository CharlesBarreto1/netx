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
        <h1 className="text-2xl font-bold tracking-tight">Árvore PON</h1>
        <p className="text-sm text-text-muted">
          Vista lógica (não-geográfica) descendo da caixa raiz até as folhas.
          Útil pra diagnóstico de caminho lógico OLT → cliente.
        </p>
      </header>

      <section className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface p-3">
        <div className="flex-1 min-w-[240px]">
          <Label htmlFor="pt-root">Caixa raiz</Label>
          <Select
            id="pt-root"
            value={rootId}
            onChange={(e) => setRoot(e.target.value)}
          >
            <option value="">— selecionar —</option>
            {orderedRoots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.isRootCandidate ? '★ ' : ''}
                {r.code} ({r.type})
                {r.outgoingCableCount > 0
                  ? ` · ${r.outgoingCableCount} saída(s)`
                  : ''}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-text-muted">
            ★ = candidato natural (não recebe cabo de outra caixa).
          </p>
        </div>

        {tree && (
          <div className="flex gap-2 text-xs">
            <Badge tone="info">{tree.stats.totalNodes} nós</Badge>
            <Badge tone="brand">{tree.stats.totalCables} cabos</Badge>
            <Badge tone="success">{tree.stats.leafClients} drops</Badge>
            <Badge tone="neutral">Prof. {tree.stats.maxDepth}</Badge>
          </div>
        )}
      </section>

      {!rootId && (
        <div className="rounded-md border border-border bg-surface p-8 text-center text-sm text-text-muted">
          Escolha uma caixa raiz pra montar a árvore.
        </div>
      )}

      {rootId && isLoading && (
        <PageLoader label="Montando árvore…" />
      )}

      {rootId && error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error instanceof ApiError ? error.friendlyMessage : 'Erro'}
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
              Backbone
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-6 rounded-sm" style={{ backgroundColor: '#9333ea' }} />
              Distribuição
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-6 rounded-sm border border-dashed" style={{ backgroundColor: '#0d9488' }} />
              Drop (tracejado)
            </span>
            <span className="ml-auto">Click num nó pra abrir a vista esquemática</span>
          </div>
        </>
      )}
    </div>
  );
}

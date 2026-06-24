'use client';

/**
 * /settings/hubsoft/import — ferramenta de MIGRAÇÃO do Hubsoft.
 *
 * Fluxo: buscar/filtrar a lista de clientes do Hubsoft → marcar quem importar →
 * "Importar selecionados". Depois disso, o cron (4x/dia) mantém SÓ os
 * importados atualizados; o botão "Sincronizar importados" força isso na hora.
 *
 * Textos em PT inline (mesmo padrão das demais telas).
 */
import Link from 'next/link';
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { FieldHelp, Input, Label } from '@/components/ui/Input';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  hubsoftApi,
  type HubsoftBrowseResult,
  type HubsoftCustomerListItem,
  type HubsoftServiceStatus,
  type HubsoftSyncResult,
} from '@/lib/hubsoft-api';
import { hasPermission } from '@/lib/session';

const STATUS_OPTS: HubsoftServiceStatus[] = ['ativo', 'bloqueado', 'cancelado'];
const PAGE_SIZE = 50;

export default function HubsoftImportPage() {
  const canSync = hasPermission('hubsoft.sync.write');

  // Filtros
  const [search, setSearch] = useState('');
  const [cidades, setCidades] = useState('');
  const [grupos, setGrupos] = useState('');
  const [status, setStatus] = useState<HubsoftServiceStatus[]>([]);

  // Resultado / seleção / paginação
  const [result, setResult] = useState<HubsoftBrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastRun, setLastRun] = useState<{ kind: 'import' | 'sync'; res: HubsoftSyncResult } | null>(
    null,
  );

  function parseCsv(v: string): string[] {
    return v.split(',').map((x) => x.trim()).filter(Boolean);
  }

  function buildFilters() {
    const cidadesArr = parseCsv(cidades);
    const gruposArr = parseCsv(grupos);
    if (!cidadesArr.length && !gruposArr.length && !status.length) return undefined;
    return {
      ...(cidadesArr.length ? { cidades: cidadesArr } : {}),
      ...(gruposArr.length ? { grupos: gruposArr } : {}),
      ...(status.length ? { status } : {}),
    };
  }

  async function doSearch(page = 1) {
    setLoading(true);
    try {
      const res = await hubsoftApi.browse({
        search: search.trim() || undefined,
        filters: buildFilters(),
        page,
        pageSize: PAGE_SIZE,
      });
      setResult(res);
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha ao buscar: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  function toggleStatus(s: HubsoftServiceStatus) {
    setStatus((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function toggleOne(codigo: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(codigo)) next.delete(codigo);
      else next.add(codigo);
      return next;
    });
  }

  function toggleAllPage(items: HubsoftCustomerListItem[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = items.every((i) => next.has(i.codigo));
      for (const i of items) {
        if (allSelected) next.delete(i.codigo);
        else next.add(i.codigo);
      }
      return next;
    });
  }

  async function doImport() {
    if (selected.size === 0) return;
    setImporting(true);
    try {
      const res = await hubsoftApi.importSelected({ codigos: [...selected] });
      setLastRun({ kind: 'import', res });
      const cust = res.entities.find((e) => e.entity === 'customers');
      const ok = cust ? cust.created + cust.updated : 0;
      const failed = res.entities.reduce((a, e) => a + e.failed, 0);
      if (ok > 0) {
        toast.success(`Importados ${ok} cliente(s)${failed ? ` · ${failed} falha(s)` : ''}.`);
        setSelected(new Set());
      } else {
        toast.error(`Nenhum cliente importado · ${failed} falha(s). Veja os detalhes abaixo.`);
      }
      await doSearch(result?.page ?? 1); // atualiza os badges "importado"
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha ao importar: ${msg}`);
    } finally {
      setImporting(false);
    }
  }

  async function doSyncImported() {
    setSyncing(true);
    try {
      const res = await hubsoftApi.syncImported();
      setLastRun({ kind: 'sync', res });
      toast.success('Sincronização dos importados concluída.');
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha ao sincronizar: ${msg}`);
    } finally {
      setSyncing(false);
    }
  }

  const items = result?.items ?? [];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Importar do Hubsoft</h1>
          <p className="mt-1 text-sm text-text-muted">
            Liste os clientes do Hubsoft, marque quem migrar e importe. Os importados ficam
            atualizados automaticamente (4x/dia).{' '}
            <Link href="/settings/hubsoft" className="text-accent hover:underline">
              Conexão/credenciais
            </Link>
          </p>
        </div>
        {canSync && (
          <Button onClick={doSyncImported} loading={syncing} variant="outline">
            Sincronizar importados agora
          </Button>
        )}
      </header>

      {/* Filtros */}
      <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <Label>Buscar (nome ou CPF/CNPJ)</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doSearch(1)}
              placeholder="ex.: Guilherme ou 10682083681"
            />
          </div>
          <div>
            <Label>Cidades</Label>
            <Input value={cidades} onChange={(e) => setCidades(e.target.value)}
              placeholder="Divinópolis, São Paulo" />
            <FieldHelp>Vírgula separa. Sem acento/maiúscula importa.</FieldHelp>
          </div>
          <div>
            <Label>Grupos / planos</Label>
            <Input value={grupos} onChange={(e) => setGrupos(e.target.value)}
              placeholder="300 MEGA, FIBRA" />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <Label>Status do serviço</Label>
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStatus(s)}
                  aria-pressed={status.includes(s)}
                  className={
                    'rounded-md border px-3 py-1.5 text-sm capitalize transition-colors ' +
                    (status.includes(s)
                      ? 'border-accent bg-accent-muted text-text'
                      : 'border-border bg-surface text-text-muted hover:bg-surface-hover')
                  }
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <Button onClick={() => doSearch(1)} loading={loading}>
            Buscar
          </Button>
        </div>
      </section>

      {/* Resultado da última importação/sync */}
      {lastRun && <RunSummary kind={lastRun.kind} res={lastRun.res} />}

      {/* Lista */}
      {result && (
        <section className="rounded-lg border border-border bg-surface shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
            <span className="text-sm text-text-muted">
              {result.total != null ? `${result.total} cliente(s) · ` : ''}página {result.page}
              {selected.size > 0 ? ` · ${selected.size} selecionado(s)` : ''}
            </span>
            {canSync && (
              <Button onClick={doImport} loading={importing} disabled={selected.size === 0}>
                Importar selecionados{selected.size ? ` (${selected.size})` : ''}
              </Button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-text-muted">
                  <th className="w-10 p-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={items.length > 0 && items.every((i) => selected.has(i.codigo))}
                      onChange={() => toggleAllPage(items)}
                      aria-label="Selecionar todos"
                    />
                  </th>
                  <th className="p-3">Código</th>
                  <th className="p-3">Nome</th>
                  <th className="p-3">CPF/CNPJ</th>
                  <th className="p-3">Cidade</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Planos</th>
                  <th className="p-3">Situação</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr
                    key={i.codigo}
                    className="border-b border-border last:border-0 hover:bg-surface-hover"
                  >
                    <td className="p-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={selected.has(i.codigo)}
                        onChange={() => toggleOne(i.codigo)}
                        aria-label={`Selecionar ${i.nome}`}
                      />
                    </td>
                    <td className="p-3 font-mono text-text-muted">{i.codigo}</td>
                    <td className="p-3 text-text">{i.nome}</td>
                    <td className="p-3 font-mono text-text-muted">{i.cpfCnpj || '—'}</td>
                    <td className="p-3 text-text-muted">{i.cidade || '—'}</td>
                    <td className="p-3 text-text-muted">{i.statusLabel || '—'}</td>
                    <td className="p-3 text-text-muted">
                      {i.planos.length ? i.planos.join(', ') : `${i.servicosCount} serviço(s)`}
                    </td>
                    <td className="p-3">
                      {i.alreadyImported ? (
                        <Badge tone="success">Importado</Badge>
                      ) : (
                        <Badge tone="neutral">Novo</Badge>
                      )}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-sm text-text-muted">
                      Nenhum cliente para os filtros atuais.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {(result.page > 1 || result.hasMore) && (
            <div className="flex items-center justify-end gap-2 border-t border-border p-3">
              <Button
                variant="outline"
                size="sm"
                disabled={loading || result.page <= 1}
                onClick={() => doSearch(result.page - 1)}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={loading || !result.hasMore}
                onClick={() => doSearch(result.page + 1)}
              >
                Próxima
              </Button>
            </div>
          )}
        </section>
      )}

      {!result && !loading && (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-text-muted">
          Use os filtros acima e clique em <b>Buscar</b> para listar os clientes do Hubsoft.
        </p>
      )}
    </div>
  );
}

function RunSummary({ kind, res }: { kind: 'import' | 'sync'; res: HubsoftSyncResult }) {
  const allErrors = res.entities.flatMap((e) =>
    e.errors.map((er) => ({ entity: e.entity, ...er })),
  );
  return (
    <section className="rounded-lg border border-border bg-surface-muted p-3">
      <div className="mb-2 text-sm font-semibold text-text">
        {kind === 'import' ? 'Importação' : 'Sincronização'} concluída · {res.durationMs} ms
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {res.entities.map((e) => (
          <span
            key={e.entity}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-text-muted"
          >
            <b className="text-text">{e.entity === 'customers' ? 'Clientes' : 'Financeiro'}:</b>{' '}
            {e.created} novo(s) · {e.updated} atualizado(s)
            {e.failed ? ` · ${e.failed} falha(s)` : ''}
          </span>
        ))}
      </div>

      {allErrors.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold text-danger">
            {allErrors.length} falha(s):
          </div>
          <ul className="max-h-48 space-y-1 overflow-auto rounded-md border border-border bg-surface p-2 text-[11px] leading-snug">
            {allErrors.slice(0, 100).map((er, idx) => (
              <li key={idx} className="text-text-muted">
                <span className="font-mono text-text">{er.ref}</span> — {er.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

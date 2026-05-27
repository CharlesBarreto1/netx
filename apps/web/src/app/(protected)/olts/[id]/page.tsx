'use client';

/**
 * /olts/[id] — detalhe da OLT + gestão de PON Ports (R8.4 OSP).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Página dedicada que cobre o gap que sobrou do R8.3: vincular cada porta
 * PON da OLT a um cabo+fibra específico, sem cair pra curl. Sem esse
 * vínculo o power budget automático fica preso na unresolved branch.
 *
 * Layout:
 *   - Header: voltar, nome, vendor/model, status, POP vinculado
 *   - Card "Portas PON": tabela editável inline (16 linhas typical GPON).
 *     Cada linha: ponIndex (read-only) · Cabo (Select) · Fibra (Select
 *     baseado em fiberCount do cabo) · TX dBm (input opcional) · Notas
 *     · Salvar / Limpar.
 */
import { ArrowLeft, MapPin, Save, X } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { FiberChip } from '@/components/optical/FiberPicker';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import type { Paginated } from '@/lib/crm-types';
import { fiberCablesApi, type FiberCable } from '@/lib/fiber-api';
import { oltsApi, type Olt } from '@/lib/olts-api';
import {
  ponPortsApi,
  type PonPort,
  type CreatePonPortInput,
} from '@/lib/pon-port-api';
import { hasPermission } from '@/lib/session';

// GPON Class B+ típica tem 16 portas PON. Operador pode editar pra OLTs
// com mais slots (24, 32). Sem persistência — só limite visual.
const DEFAULT_PORT_COUNT = 16;

export default function OltDetailPage() {
  const params = useParams<{ id: string }>();
  const oltId = params?.id;
  const canWrite = hasPermission('network.write');

  const { data: olt, isLoading } = useSWR<Olt>(
    oltId ? `/v1/olts/${oltId}` : null,
  );
  const { data: ponPorts, mutate: mutatePorts } = useSWR<PonPort[]>(
    oltId ? ponPortsApi.listByOltPath(oltId) : null,
  );
  const { data: cablesResp } = useSWR<Paginated<FiberCable>>(
    fiberCablesApi.listPath({ pageSize: 500 }),
  );
  const cables = useMemo(() => cablesResp?.data ?? [], [cablesResp]);

  const [portCount, setPortCount] = useState(DEFAULT_PORT_COUNT);
  useEffect(() => {
    // Se já há portas configuradas com ponIndex > 16, expande automaticamente.
    if (ponPorts && ponPorts.length > 0) {
      const max = Math.max(...ponPorts.map((p) => p.ponIndex));
      if (max > portCount) setPortCount(Math.max(max, DEFAULT_PORT_COUNT));
    }
  }, [ponPorts, portCount]);

  if (isLoading || !olt) return <PageLoader label="Carregando OLT…" />;

  const portsByIndex = new Map<number, PonPort>();
  for (const p of ponPorts ?? []) portsByIndex.set(p.ponIndex, p);

  // Cabos que JÁ estão atribuídos a alguma porta (pra mostrar warning visual
  // em duplicidade, ainda que o backend bloqueie).
  const usedCableFibers = new Set<string>();
  for (const p of ponPorts ?? []) {
    if (p.cableId && p.fiberIndex != null) {
      usedCableFibers.add(`${p.cableId}|${p.fiberIndex}`);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3">
        <Link
          href="/olts"
          className="text-text-muted hover:text-text"
          title="Voltar"
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

      {/* Card POP vinculado */}
      <section className="rounded-md border border-border bg-surface p-4 text-sm">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-text-muted" />
          <span className="font-semibold">POP vinculado:</span>
          {olt.pop ? (
            <span className="font-mono">
              {olt.pop.name}
              {olt.pop.code ? ` (${olt.pop.code})` : ''}
            </span>
          ) : (
            <span className="italic text-text-muted">
              não vinculado — defina no estúdio de mapeamento
            </span>
          )}
          <Link href="/mapa" className="ml-auto text-xs text-brand-500 hover:underline">
            Abrir estúdio →
          </Link>
        </div>
      </section>

      {/* Card Portas PON */}
      <section className="rounded-md border border-border bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">Portas PON</h2>
          <span className="text-xs text-text-muted">
            ({ponPorts?.filter((p) => p.cableId).length ?? 0} de {portCount} vinculadas)
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Label htmlFor="port-count" className="text-xs">
              Total
            </Label>
            <Select
              id="port-count"
              value={String(portCount)}
              onChange={(e) => setPortCount(Number(e.target.value))}
              className="w-20"
            >
              {[4, 8, 16, 24, 32, 64].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <p className="mb-3 text-xs text-text-muted">
          Cada porta PON da OLT sai por uma fibra específica de um cabo
          backbone. O power budget automático segue esse vínculo até o
          cliente. Sem vínculo, hover na vista esquemática mostra
          &quot;topologia incompleta&quot;.
        </p>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              <tr>
                <th className="px-2 py-1.5 w-12">PON</th>
                <th className="px-2 py-1.5">Cabo backbone</th>
                <th className="px-2 py-1.5 w-40">Fibra</th>
                <th className="px-2 py-1.5 w-28">TX (dBm)</th>
                <th className="px-2 py-1.5">Notas</th>
                <th className="px-2 py-1.5 w-32 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {Array.from({ length: portCount }, (_, i) => i + 1).map(
                (idx) => {
                  const existing = portsByIndex.get(idx);
                  return (
                    <PonPortRow
                      key={idx}
                      oltId={olt.id}
                      ponIndex={idx}
                      existing={existing ?? null}
                      cables={cables}
                      usedCableFibers={usedCableFibers}
                      canWrite={canWrite}
                      onSaved={mutatePorts}
                    />
                  );
                },
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ─── Linha de uma porta PON (editável inline) ───────────────────────────────
function PonPortRow({
  oltId,
  ponIndex,
  existing,
  cables,
  usedCableFibers,
  canWrite,
  onSaved,
}: {
  oltId: string;
  ponIndex: number;
  existing: PonPort | null;
  cables: FiberCable[];
  usedCableFibers: Set<string>;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [cableId, setCableId] = useState<string>(existing?.cableId ?? '');
  const [fiberIndex, setFiberIndex] = useState<string>(
    existing?.fiberIndex != null ? String(existing.fiberIndex) : '',
  );
  const [tx, setTx] = useState<string>(
    existing?.txPowerDbm != null ? String(existing.txPowerDbm) : '',
  );
  const [notes, setNotes] = useState<string>(existing?.notes ?? '');
  const [busy, setBusy] = useState(false);

  // Sync quando data muda externamente.
  useEffect(() => {
    setCableId(existing?.cableId ?? '');
    setFiberIndex(existing?.fiberIndex != null ? String(existing.fiberIndex) : '');
    setTx(existing?.txPowerDbm != null ? String(existing.txPowerDbm) : '');
    setNotes(existing?.notes ?? '');
  }, [existing]);

  const cable = cables.find((c) => c.id === cableId);

  // Dirty: difere do que está persistido?
  const dirty = useMemo(() => {
    const persisted = {
      cableId: existing?.cableId ?? '',
      fiberIndex:
        existing?.fiberIndex != null ? String(existing.fiberIndex) : '',
      tx: existing?.txPowerDbm != null ? String(existing.txPowerDbm) : '',
      notes: existing?.notes ?? '',
    };
    return (
      persisted.cableId !== cableId ||
      persisted.fiberIndex !== fiberIndex ||
      persisted.tx !== tx ||
      persisted.notes !== notes
    );
  }, [existing, cableId, fiberIndex, tx, notes]);

  // Detecta conflito visual: outra PON já usa essa fibra do cabo.
  const conflict =
    cableId &&
    fiberIndex &&
    usedCableFibers.has(`${cableId}|${fiberIndex}`) &&
    (existing?.cableId !== cableId ||
      existing?.fiberIndex !== Number(fiberIndex));

  async function handleSave() {
    setBusy(true);
    try {
      const payload: CreatePonPortInput = {
        oltId,
        ponIndex,
        cableId: cableId || null,
        fiberIndex: fiberIndex ? Number(fiberIndex) : null,
        txPowerDbm: tx ? Number(tx) : null,
        notes: notes || null,
      };
      if (existing) {
        await ponPortsApi.update(existing.id, {
          cableId: payload.cableId,
          fiberIndex: payload.fiberIndex,
          txPowerDbm: payload.txPowerDbm,
          notes: payload.notes,
        });
      } else {
        await ponPortsApi.create(payload);
      }
      toast.success(`PON ${ponIndex} salva`);
      await onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    if (!existing) {
      // Não há nada pra apagar — só reseta locais.
      setCableId('');
      setFiberIndex('');
      setTx('');
      setNotes('');
      return;
    }
    setBusy(true);
    try {
      await ponPortsApi.remove(existing.id);
      toast.success(`PON ${ponIndex} liberada`);
      await onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  const linked = !!existing?.cableId;

  return (
    <tr className={linked ? 'bg-surface-muted/50' : ''}>
      <td className="px-2 py-1.5">
        <span className="font-mono text-sm font-semibold">
          {String(ponIndex).padStart(2, '0')}
        </span>
      </td>
      <td className="px-2 py-1.5">
        <Select
          value={cableId}
          onChange={(e) => {
            setCableId(e.target.value);
            setFiberIndex('1'); // reset fiber quando troca cabo
          }}
          disabled={!canWrite || busy}
          className="min-w-[200px]"
        >
          <option value="">— sem vínculo —</option>
          {cables.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} ({c.type} · {c.fiberCount}f)
            </option>
          ))}
        </Select>
      </td>
      <td className="px-2 py-1.5">
        {cable ? (
          <div className="flex items-center gap-1">
            <Select
              value={fiberIndex}
              onChange={(e) => setFiberIndex(e.target.value)}
              disabled={!canWrite || busy}
              className="min-w-[100px]"
            >
              <option value="">—</option>
              {Array.from({ length: cable.fiberCount }, (_, i) => i + 1).map(
                (n) => (
                  <option key={n} value={n}>
                    f{n}
                  </option>
                ),
              )}
            </Select>
            {fiberIndex && <FiberChip index={Number(fiberIndex)} showName={false} />}
          </div>
        ) : (
          <span className="text-xs italic text-text-subtle">selecione cabo</span>
        )}
      </td>
      <td className="px-2 py-1.5">
        <Input
          type="number"
          step={0.1}
          min={-10}
          max={20}
          value={tx}
          onChange={(e) => setTx(e.target.value)}
          placeholder="3.0"
          disabled={!canWrite || busy}
          className="w-20"
        />
      </td>
      <td className="px-2 py-1.5">
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="opcional"
          disabled={!canWrite || busy}
          className="min-w-[140px]"
        />
      </td>
      <td className="px-2 py-1.5">
        <div className="flex justify-end gap-1">
          {conflict && (
            <span
              title="Essa fibra já está em outra porta — backend vai rejeitar"
              className="text-xs text-red-600"
            >
              ⚠
            </span>
          )}
          {dirty && canWrite && (
            <Button
              size="sm"
              onClick={handleSave}
              loading={busy}
              disabled={!!conflict}
              title="Salvar"
            >
              <Save className="h-3 w-3" />
            </Button>
          )}
          {linked && canWrite && !dirty && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleClear}
              disabled={busy}
              title="Liberar porta"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

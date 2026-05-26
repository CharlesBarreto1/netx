'use client';

/**
 * /mapa — Estúdio de Mapeamento de Rede (R8.1 OSP).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Layout full-screen sem o chrome do app: 100vh, topbar com ferramentas,
 * sidebar fixa com folder tree, mapa Leaflet ocupando o resto.
 *
 * Modos suportados:
 *   - Selecionar (default)
 *   - Cabo (desenha polyline)
 *   - CTO / CEO / SPLITTER / EMENDA (criar caixa com 1 click)
 *   - POP (cria NetworkPop com geo)
 *   - Reserva (criar enclosure tipo CTO marcada como RESERVA via type/notes
 *     em v1; v2 vai virar enum próprio em R8.2)
 *   - Régua (mede distância entre N pontos)
 *
 * Atalhos: V (select), C (cabo), B (caixa CTO), R (régua), ESC (cancela).
 */
import dynamic from 'next/dynamic';
import {
  Box,
  Cable,
  ChevronLeft,
  Layers,
  MousePointer,
  Plus,
  Radio,
  Ruler,
  Save,
  Scissors,
  Upload,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { FolderTree } from '@/components/optical/FolderTree';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import {
  FieldHelp,
  Input,
  Label,
  Select,
  Textarea,
} from '@/components/ui/Input';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  fiberCablesApi,
  type CreateFiberCableInput,
  type FiberCableType,
  type PathPoint,
} from '@/lib/fiber-api';
import {
  mappingApi,
  type ListNetworkMapParams,
  type NetworkMapResponse,
} from '@/lib/mapping-api';
import {
  networkFoldersApi,
  type NetworkFolder,
} from '@/lib/network-folders-api';
import {
  opticalApi,
  SPLITTER_OUTPUT_COUNT,
  type CreateEnclosureInput,
  type OpticalEnclosureType,
  type SplitterRatio,
} from '@/lib/optical-api';

import type { NetworkMapMode } from '@/components/mapping/NetworkMap';

const NetworkMap = dynamic(
  () => import('@/components/mapping/NetworkMap').then((m) => m.NetworkMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-slate-100 dark:bg-slate-900">
        <span className="text-sm text-text-muted">Carregando mapa…</span>
      </div>
    ),
  },
);

// ─── Modos do estúdio (super-set do NetworkMapMode) ─────────────────────────
type StudioMode =
  | 'select'
  | 'cable'
  | 'enclosure-CTO'
  | 'enclosure-CEO'
  | 'enclosure-SPLITTER'
  | 'enclosure-EMENDA'
  | 'pop'
  | 'reserva'
  | 'ruler';

// Mapeia modo do estúdio pro modo "base" do NetworkMap.
function toMapMode(m: StudioMode): NetworkMapMode {
  if (m === 'cable') return 'draw-cable';
  if (m === 'ruler') return 'ruler';
  if (m === 'select') return 'select';
  return 'create-enclosure'; // todas as criações de caixa/POP usam crosshair
}

// ─── Régua: Haversine simples (mesmo algo dos cabos no backend) ─────────────
function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const la1 = toRad(a.latitude);
  const la2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function fmtMeters(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${m.toFixed(1)} m`;
}

export default function MapStudioPage() {
  // ── Modo + drafts ─────────────────────────────────────────────────────────
  const [mode, setMode] = useState<StudioMode>('select');
  const [draftPath, setDraftPath] = useState<PathPoint[]>([]);
  const [enclosureDraft, setEnclosureDraft] = useState<{
    latitude: number;
    longitude: number;
    type: OpticalEnclosureType;
    isReserva: boolean;
  } | null>(null);
  const [cableDraft, setCableDraft] = useState<PathPoint[] | null>(null);
  const [popDraft, setPopDraft] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  // Régua: lista de vértices só no client, não persiste.
  const [rulerPath, setRulerPath] = useState<PathPoint[]>([]);

  // ── Filtros / camadas ─────────────────────────────────────────────────────
  const [filters, setFilters] = useState<ListNetworkMapParams>({
    includePops: true,
    includeEquipment: true,
    includeOlts: true,
    includeEnclosures: true,
    includeCables: true,
    includeSplices: true,
    includeEvents: true,
  });
  const [layersOpen, setLayersOpen] = useState(false);

  // ── Folders ───────────────────────────────────────────────────────────────
  const { data: foldersData, mutate: mutateFolders } = useSWR<NetworkFolder[]>(
    networkFoldersApi.listPath(),
  );
  const folders = foldersData ?? [];
  const [visibleFolderIds, setVisibleFolderIds] = useState<Set<string> | null>(
    null,
  );
  useEffect(() => {
    if (visibleFolderIds === null && foldersData) {
      const all = new Set<string>(foldersData.map((f) => f.id));
      all.add('unassigned');
      setVisibleFolderIds(all);
    }
  }, [foldersData, visibleFolderIds]);
  const totalSelectable = folders.length + 1;
  const folderFilter =
    visibleFolderIds && visibleFolderIds.size < totalSelectable
      ? Array.from(visibleFolderIds)
      : undefined;

  const [folderEditing, setFolderEditing] = useState<
    NetworkFolder | { parentId: string | null } | null
  >(null);
  const [folderDeleting, setFolderDeleting] = useState<NetworkFolder | null>(
    null,
  );

  // ── Map data ──────────────────────────────────────────────────────────────
  const { data, mutate } = useSWR<NetworkMapResponse>(
    mappingApi.networkPath({ ...filters, folderIds: folderFilter }),
    { refreshInterval: 60_000 },
  );
  const points = data?.points ?? [];
  const segments = data?.segments ?? [];
  const splices = data?.splices ?? [];
  const events = data?.events ?? [];
  const stats = data?.stats;

  // ── Atalhos de teclado ────────────────────────────────────────────────────
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Ignora se está digitando num input/textarea.
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'Escape') {
        if (mode === 'cable' && draftPath.length >= 2) {
          setCableDraft(draftPath);
          setDraftPath([]);
          setMode('select');
        } else if (mode === 'ruler') {
          setRulerPath([]);
          setMode('select');
        } else if (mode !== 'select') {
          setMode('select');
          setDraftPath([]);
        }
      } else if (e.key === 'Enter' && mode === 'cable' && draftPath.length >= 2) {
        setCableDraft(draftPath);
        setDraftPath([]);
        setMode('select');
      } else if (
        e.key === 'Backspace' &&
        (mode === 'cable' || mode === 'ruler')
      ) {
        if (mode === 'cable') setDraftPath((p) => p.slice(0, -1));
        else setRulerPath((p) => p.slice(0, -1));
      } else if (e.key === 'v' || e.key === 'V') {
        setMode('select');
        setDraftPath([]);
        setRulerPath([]);
      } else if (e.key === 'c' || e.key === 'C') {
        setMode('cable');
        setDraftPath([]);
      } else if (e.key === 'b' || e.key === 'B') {
        setMode('enclosure-CTO');
      } else if (e.key === 'r' || e.key === 'R') {
        setMode('ruler');
        setRulerPath([]);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [mode, draftPath]);

  function handleMapClick(latlng: { latitude: number; longitude: number }) {
    if (mode === 'ruler') {
      setRulerPath((p) => [...p, latlng]);
      return;
    }
    if (mode === 'cable') {
      setDraftPath((p) => [...p, latlng]);
      return;
    }
    if (mode === 'pop') {
      setPopDraft(latlng);
      setMode('select');
      return;
    }
    if (mode.startsWith('enclosure-') || mode === 'reserva') {
      const type =
        mode === 'reserva'
          ? 'CTO'
          : (mode.replace('enclosure-', '') as OpticalEnclosureType);
      setEnclosureDraft({ ...latlng, type, isReserva: mode === 'reserva' });
      setMode('select');
    }
  }

  // ── Régua: distâncias parciais e total ────────────────────────────────────
  const rulerStats = useMemo(() => {
    if (rulerPath.length < 2) return { total: 0, segments: [] as number[] };
    const seg: number[] = [];
    for (let i = 1; i < rulerPath.length; i++) {
      seg.push(haversineMeters(rulerPath[i - 1], rulerPath[i]));
    }
    return { total: seg.reduce((a, b) => a + b, 0), segments: seg };
  }, [rulerPath]);

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-900 text-text">
      {/* ─── Topbar ───────────────────────────────────────────────────────── */}
      <Topbar
        mode={mode}
        setMode={(m) => {
          setMode(m);
          if (m !== 'cable') setDraftPath([]);
          if (m !== 'ruler') setRulerPath([]);
        }}
        draftCount={mode === 'cable' ? draftPath.length : 0}
        rulerActive={mode === 'ruler'}
        layersOpen={layersOpen}
        setLayersOpen={setLayersOpen}
      />

      {/* ─── Body ────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — pastas */}
        <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface">
          <FolderTree
            folders={folders}
            visibleIds={visibleFolderIds ?? new Set()}
            onVisibleChange={setVisibleFolderIds}
            onCreate={(parentId) => setFolderEditing({ parentId })}
            onEdit={(f) => setFolderEditing(f)}
            onDelete={(f) => setFolderDeleting(f)}
            canWrite
          />
        </aside>

        {/* Canvas — mapa */}
        <main className="relative flex-1 overflow-hidden">
          <NetworkMap
            points={points}
            segments={segments}
            splices={splices}
            events={events}
            mode={toMapMode(mode)}
            onMapClick={handleMapClick}
            pendingPath={
              mode === 'cable'
                ? draftPath
                : mode === 'ruler'
                  ? rulerPath
                  : []
            }
            height="100%"
          />

          {/* Painel de camadas — overlay flutuante */}
          {layersOpen && (
            <div className="absolute right-3 top-3 z-[1500] w-64 rounded-md border border-border bg-surface p-3 shadow-xl">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Camadas
                </span>
                <button
                  type="button"
                  onClick={() => setLayersOpen(false)}
                  className="text-text-muted hover:text-text"
                  title="Fechar"
                >
                  ✕
                </button>
              </div>
              {(
                [
                  { k: 'includePops', label: `POPs (${stats?.pops ?? 0})`, color: '#1e40af' },
                  { k: 'includeEquipment', label: `Equipamentos (${stats?.equipment ?? 0})`, color: '#ea580c' },
                  { k: 'includeOlts', label: `OLTs (${stats?.olts ?? 0})`, color: '#7c3aed' },
                  { k: 'includeEnclosures', label: `Caixas (${stats?.enclosures ?? 0})`, color: '#0d9488' },
                  { k: 'includeCables', label: `Cabos (${stats?.cables ?? 0})`, color: '#1d4ed8' },
                  { k: 'includeSplices', label: `Fusões (${stats?.splices ?? 0})`, color: '#f59e0b' },
                  { k: 'includeEvents', label: `⚠ Eventos (${stats?.events ?? 0})`, color: '#dc2626' },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.k}
                  className="flex items-center gap-2 py-1 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={filters[opt.k] !== false}
                    onChange={() =>
                      setFilters((f) => ({ ...f, [opt.k]: !(f[opt.k] !== false) }))
                    }
                  />
                  <span
                    className="inline-block h-3 w-3 rounded-sm"
                    style={{ backgroundColor: opt.color }}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          )}

          {/* HUD — instrução do modo + régua */}
          {mode !== 'select' && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 z-[400] -translate-x-1/2 rounded-md bg-slate-900/95 px-4 py-2 text-xs font-medium text-white shadow-lg">
              {modeHint(mode, draftPath.length, rulerPath.length)}
            </div>
          )}

          {/* Régua — distâncias renderizadas */}
          {mode === 'ruler' && rulerPath.length >= 2 && (
            <div className="absolute right-3 bottom-16 z-[1500] max-w-xs rounded-md border border-border bg-surface p-3 shadow-xl">
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold">
                <Ruler className="h-3.5 w-3.5" />
                Régua
              </div>
              <ul className="space-y-0.5 text-xs font-mono">
                {rulerStats.segments.map((m, i) => (
                  <li key={i} className="flex justify-between text-text-muted">
                    <span>Seg {i + 1}</span>
                    <span>{fmtMeters(m)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-1 flex justify-between border-t border-border pt-1 text-xs font-bold">
                <span>Total</span>
                <span>{fmtMeters(rulerStats.total)}</span>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ─── Modais — z-index > Leaflet ────────────────────────────────── */}
      {enclosureDraft && (
        <CreateEnclosureModal
          draft={enclosureDraft}
          onClose={() => setEnclosureDraft(null)}
          onCreated={async () => {
            await mutate();
            setEnclosureDraft(null);
            toast.success('Caixa criada');
          }}
        />
      )}
      {cableDraft && (
        <CreateCableModal
          path={cableDraft}
          onClose={() => setCableDraft(null)}
          onCreated={async () => {
            await mutate();
            setCableDraft(null);
            toast.success('Cabo criado');
          }}
        />
      )}
      {popDraft && (
        <CreatePopModal
          latlng={popDraft}
          onClose={() => setPopDraft(null)}
          onCreated={async () => {
            await mutate();
            setPopDraft(null);
            toast.success('POP marcado · vincule OLTs em Rede › POPs');
          }}
        />
      )}

      {folderEditing && (
        <FolderEditDialog
          initial={
            'id' in folderEditing
              ? folderEditing
              : { parentId: folderEditing.parentId }
          }
          onClose={() => setFolderEditing(null)}
          onSaved={async () => {
            await mutateFolders();
            setFolderEditing(null);
          }}
        />
      )}
      {folderDeleting && (
        <ConfirmDialog
          open
          onClose={() => setFolderDeleting(null)}
          onConfirm={async () => {
            try {
              await networkFoldersApi.remove(folderDeleting.id);
              toast.success('Pasta excluída');
              await mutateFolders();
              await mutate();
              setFolderDeleting(null);
            } catch (err) {
              toast.error(
                err instanceof ApiError ? err.friendlyMessage : 'Erro',
              );
            }
          }}
          title={`Excluir "${folderDeleting.name}"?`}
          message="Itens dentro voltam pra órfãos."
          confirmLabel="Excluir"
          variant="danger"
        />
      )}
    </div>
  );
}

function modeHint(mode: StudioMode, draftLen: number, rulerLen: number): string {
  switch (mode) {
    case 'cable':
      return draftLen < 2
        ? '✏️ Clique pra adicionar pontos do cabo · ESC cancela'
        : `✏️ ${draftLen} pontos · ENTER finaliza · BACKSPACE remove · ESC cancela`;
    case 'ruler':
      return rulerLen < 2
        ? '📏 Clique 2 pontos pra começar a medir · ESC encerra'
        : `📏 ${rulerLen} pontos · BACKSPACE remove último · ESC encerra`;
    case 'enclosure-CTO':
      return '🟦 Clique no mapa pra marcar a CTO';
    case 'enclosure-CEO':
      return '🟫 Clique no mapa pra marcar a CEO (caixa de emenda)';
    case 'enclosure-SPLITTER':
      return '🟨 Clique no mapa pra marcar o splitter';
    case 'enclosure-EMENDA':
      return '⬛ Clique no mapa pra marcar o ponto de emenda';
    case 'pop':
      return '🔷 Clique pra marcar o POP (depois vincule OLTs do cadastro)';
    case 'reserva':
      return '🟪 Clique pra marcar a Reserva técnica (sobra de cabo)';
    default:
      return '';
  }
}

// ─── Topbar ─────────────────────────────────────────────────────────────────
function Topbar({
  mode,
  setMode,
  draftCount,
  rulerActive,
  layersOpen,
  setLayersOpen,
}: {
  mode: StudioMode;
  setMode: (m: StudioMode) => void;
  draftCount: number;
  rulerActive: boolean;
  layersOpen: boolean;
  setLayersOpen: (v: boolean) => void;
}) {
  return (
    <header className="flex h-12 items-center gap-1 border-b border-border bg-surface px-2 shadow-sm">
      <Link
        href="/"
        title="Voltar pro NetX"
        className="flex h-8 items-center gap-1 rounded-md px-2 text-sm font-medium text-text-muted hover:bg-surface-hover hover:text-text"
      >
        <ChevronLeft className="h-4 w-4" />
        NetX
      </Link>
      <div className="mx-2 h-6 w-px bg-border" />
      <span className="mr-2 text-sm font-semibold tracking-tight">
        Estúdio de Mapeamento
      </span>

      <div className="mx-2 h-6 w-px bg-border" />

      <ToolButton
        active={mode === 'select'}
        onClick={() => setMode('select')}
        icon={<MousePointer className="h-4 w-4" />}
        label="Selecionar"
        shortcut="V"
      />
      <ToolButton
        active={mode === 'cable'}
        onClick={() => setMode('cable')}
        icon={<Cable className="h-4 w-4" />}
        label="Cabo"
        shortcut="C"
        badge={draftCount > 0 ? draftCount : undefined}
      />
      <ToolButton
        active={mode === 'enclosure-CTO'}
        onClick={() => setMode('enclosure-CTO')}
        icon={<Box className="h-4 w-4" />}
        label="CTO"
        shortcut="B"
      />
      <ToolButton
        active={mode === 'enclosure-CEO'}
        onClick={() => setMode('enclosure-CEO')}
        icon={<Box className="h-4 w-4" />}
        label="CEO"
      />
      <ToolButton
        active={mode === 'enclosure-SPLITTER'}
        onClick={() => setMode('enclosure-SPLITTER')}
        icon={<Scissors className="h-4 w-4" />}
        label="Splitter"
      />
      <ToolButton
        active={mode === 'enclosure-EMENDA'}
        onClick={() => setMode('enclosure-EMENDA')}
        icon={<Box className="h-4 w-4" />}
        label="Emenda"
      />
      <div className="mx-2 h-6 w-px bg-border" />
      <ToolButton
        active={mode === 'pop'}
        onClick={() => setMode('pop')}
        icon={<Radio className="h-4 w-4" />}
        label="POP"
      />
      <ToolButton
        active={mode === 'reserva'}
        onClick={() => setMode('reserva')}
        icon={<Save className="h-4 w-4" />}
        label="Reserva"
      />
      <div className="mx-2 h-6 w-px bg-border" />
      <ToolButton
        active={rulerActive}
        onClick={() => setMode('ruler')}
        icon={<Ruler className="h-4 w-4" />}
        label="Régua"
        shortcut="R"
      />

      <div className="ml-auto flex items-center gap-1">
        <Link href="/network/import-export" className="text-xs">
          <Button variant="ghost" size="sm" title="Importar KML">
            <Upload className="h-3.5 w-3.5" />
            KML
          </Button>
        </Link>
        <Link href="/network/optical" className="text-xs">
          <Button variant="ghost" size="sm">
            <Plus className="h-3.5 w-3.5" />
            Avançado
          </Button>
        </Link>
        <button
          type="button"
          onClick={() => setLayersOpen(!layersOpen)}
          className={`flex h-8 items-center gap-1 rounded-md px-2 text-xs ${
            layersOpen
              ? 'bg-brand-500 text-white'
              : 'text-text-muted hover:bg-surface-hover hover:text-text'
          }`}
          title="Camadas visíveis"
        >
          <Layers className="h-3.5 w-3.5" />
          Camadas
        </button>
      </div>
    </header>
  );
}

function ToolButton({
  active,
  onClick,
  icon,
  label,
  shortcut,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={`relative flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition ${
        active
          ? 'bg-brand-500 text-white'
          : 'text-text-muted hover:bg-surface-hover hover:text-text'
      }`}
    >
      {icon}
      <span>{label}</span>
      {shortcut && (
        <kbd className="hidden rounded border border-current/30 px-1 text-2xs opacity-60 md:inline">
          {shortcut}
        </kbd>
      )}
      {badge !== undefined && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-2xs font-semibold text-white">
          {badge}
        </span>
      )}
    </button>
  );
}

// ─── Modais ─────────────────────────────────────────────────────────────────
function CreateEnclosureModal({
  draft,
  onClose,
  onCreated,
}: {
  draft: {
    latitude: number;
    longitude: number;
    type: OpticalEnclosureType;
    isReserva: boolean;
  };
  onClose: () => void;
  onCreated: () => void;
}) {
  const [code, setCode] = useState(draft.isReserva ? 'RES-' : '');
  const [splitterRatio, setSplitterRatio] = useState<SplitterRatio | ''>(
    draft.type === 'SPLITTER' ? 'ONE_TO_8' : '',
  );
  const [capacity, setCapacity] = useState(
    draft.type === 'SPLITTER' ? 8 : draft.type === 'CTO' ? 16 : 12,
  );
  const [notes, setNotes] = useState(
    draft.isReserva ? 'Reserva técnica (sobra de cabo)' : '',
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickRatio(r: SplitterRatio | '') {
    setSplitterRatio(r);
    if (r) setCapacity(SPLITTER_OUTPUT_COUNT[r]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return setError('Código obrigatório');
    setSubmitting(true);
    try {
      const payload: CreateEnclosureInput = {
        code: code.trim(),
        type: draft.type,
        latitude: draft.latitude,
        longitude: draft.longitude,
        splitterRatio: splitterRatio || null,
        capacity,
        notes: notes || null,
      };
      await opticalApi.create(payload);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : 'Erro');
    } finally {
      setSubmitting(false);
    }
  }

  const title = draft.isReserva
    ? 'Reserva técnica'
    : draft.type === 'CTO'
      ? 'Nova CTO'
      : draft.type === 'NAP'
        ? 'Novo NAP'
        : draft.type === 'SPLITTER'
          ? 'Novo Splitter'
          : 'Novo ponto de emenda';

  return (
    <StudioModal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            Criar
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="text-xs text-text-muted">
          📍{' '}
          <span className="font-mono">
            {draft.latitude.toFixed(5)}, {draft.longitude.toFixed(5)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label required>Código</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={draft.isReserva ? 'RES-001' : 'CTO-001'}
              autoFocus
            />
          </div>
          {draft.type === 'SPLITTER' && (
            <div>
              <Label>Splitter</Label>
              <Select
                value={splitterRatio}
                onChange={(e) => pickRatio(e.target.value as SplitterRatio | '')}
              >
                <option value="">—</option>
                <option value="ONE_TO_2">1:2</option>
                <option value="ONE_TO_4">1:4</option>
                <option value="ONE_TO_8">1:8</option>
                <option value="ONE_TO_16">1:16</option>
                <option value="ONE_TO_32">1:32</option>
                <option value="ONE_TO_64">1:64</option>
              </Select>
            </div>
          )}
          <div>
            <Label required>
              {draft.type === 'SPLITTER' || draft.type === 'CTO'
                ? 'Portas'
                : 'Capacidade'}
            </Label>
            <Input
              type="number"
              min={1}
              max={256}
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
            />
          </div>
        </div>
        <div>
          <Label>Notas</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </StudioModal>
  );
}

function CreateCableModal({
  path,
  onClose,
  onCreated,
}: {
  path: PathPoint[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [code, setCode] = useState('');
  const [type, setType] = useState<FiberCableType>('DISTRIBUTION');
  const [fiberCount, setFiberCount] = useState(12);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return setError('Código obrigatório');
    setSubmitting(true);
    try {
      const payload: CreateFiberCableInput = {
        code: code.trim(),
        type,
        fiberCount,
        path,
        notes: notes || null,
      };
      await fiberCablesApi.create(payload);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : 'Erro');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <StudioModal
      title="Novo cabo de fibra"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            Criar
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge tone="info">{path.length} pontos no path</Badge>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label required>Código</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="CABO-DIST-001"
              autoFocus
            />
          </div>
          <div>
            <Label required>Tipo</Label>
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as FiberCableType)}
            >
              <option value="BACKBONE">Backbone</option>
              <option value="DISTRIBUTION">Distribuição</option>
              <option value="DROP">Drop</option>
            </Select>
          </div>
          <div>
            <Label required>Fibras</Label>
            <Select
              value={String(fiberCount)}
              onChange={(e) => setFiberCount(Number(e.target.value))}
            >
              {[2, 6, 12, 24, 48, 96, 144, 288].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <Label>Notas</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <FieldHelp>
          Endpoints A/B podem ser definidos depois em{' '}
          <code className="text-2xs">/network/fiber</code>.
        </FieldHelp>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </StudioModal>
  );
}

function CreatePopModal({
  latlng,
  onClose,
  onCreated,
}: {
  latlng: { latitude: number; longitude: number };
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [city, setCity] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Nome obrigatório');
    setSubmitting(true);
    try {
      // Usa endpoint /v1/network/pops do módulo Network.
      const { networkApi } = await import('@/lib/network-api');
      await networkApi.createPop({
        name: name.trim(),
        code: code.trim() || undefined,
        city: city.trim() || undefined,
        latitude: latlng.latitude,
        longitude: latlng.longitude,
        notes: notes || undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : 'Erro');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <StudioModal
      title="Novo POP"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            Criar
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="text-xs text-text-muted">
          📍{' '}
          <span className="font-mono">
            {latlng.latitude.toFixed(5)}, {latlng.longitude.toFixed(5)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label required>Nome</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="POP Centro"
              autoFocus
            />
          </div>
          <div>
            <Label>Código</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="POP-01"
            />
          </div>
          <div>
            <Label>Cidade</Label>
            <Input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Asunción"
            />
          </div>
        </div>
        <div>
          <Label>Notas</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <FieldHelp>
          Vincular OLTs ao POP: vá em{' '}
          <code className="text-2xs">/network/pops</code> depois (R8.2 vai
          trazer pra cá).
        </FieldHelp>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </StudioModal>
  );
}

function FolderEditDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: NetworkFolder | { parentId: string | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !('id' in initial);
  const [name, setName] = useState('id' in initial ? initial.name : '');
  const [color, setColor] = useState<string>(
    ('id' in initial && initial.color) || '#64748b',
  );
  const [notes, setNotes] = useState(
    'id' in initial ? initial.notes ?? '' : '',
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Nome obrigatório');
    setSubmitting(true);
    try {
      if (isNew) {
        await networkFoldersApi.create({
          parentId: (initial as { parentId: string | null }).parentId,
          name: name.trim(),
          color,
          notes: notes || null,
        });
      } else {
        await networkFoldersApi.update((initial as NetworkFolder).id, {
          name: name.trim(),
          color,
          notes: notes || null,
        });
      }
      toast.success(isNew ? 'Pasta criada' : 'Pasta atualizada');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : 'Erro');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <StudioModal
      title={isNew ? 'Nova pasta' : `Editar "${(initial as NetworkFolder).name}"`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            Salvar
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <Label required>Nome</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ex.: Centro, Cooperativa, Sul…"
            autoFocus
          />
        </div>
        <div>
          <Label>Cor</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-12 rounded border border-border bg-transparent"
            />
            <span className="font-mono text-xs text-text-muted">{color}</span>
          </div>
        </div>
        <div>
          <Label>Notas</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </StudioModal>
  );
}

/**
 * Modal customizado pro estúdio — z-index alto pra ficar por cima do mapa
 * Leaflet (que sobe pra z=400 nos popups). Usa portal-ish via fixed.
 */
function StudioModal({
  title,
  onClose,
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  // ESC fecha — mas só se este modal estiver montado.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-950/60 p-4">
      <div
        className="w-full max-w-lg overflow-hidden rounded-md border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border bg-surface-muted px-4 py-3">
          <h3 className="text-base font-semibold">{title}</h3>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-4">{children}</div>
        <div className="flex justify-end gap-2 border-t border-border bg-surface-muted px-4 py-3">
          {footer}
        </div>
      </div>
    </div>
  );
}

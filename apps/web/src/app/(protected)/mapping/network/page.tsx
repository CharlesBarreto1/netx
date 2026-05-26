'use client';

/**
 * /mapping/network — hub do módulo Rede (R4.5c).
 *
 * Foi de "mapa de leitura com filtros" pra hub de criação:
 *   - Toolbar lateral com modos (selecionar, criar caixa, desenhar cabo,
 *     importar KML).
 *   - Filtros por camada (chips em cima).
 *   - Click no mapa em modo "criar caixa" abre modal pré-preenchido com
 *     lat/lng clicado.
 *   - Click sequencial em modo "desenhar cabo" empilha vértices; ESC
 *     finaliza e abre modal de novo cabo.
 *   - Hover destaca relações (TODO v2): passar mouse numa CTO ilumina
 *     cabos terminando nela.
 */
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  Box,
  Cable,
  Layers,
  MousePointer,
  Plus,
  Upload,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import useSWR from 'swr';

import type { LatLng } from '@/components/mapping/LocationPicker';
import type { NetworkMapMode } from '@/components/mapping/NetworkMap';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  FieldHelp,
  Input,
  Label,
  Select,
  Textarea,
} from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  fiberCablesApi,
  type FiberCableType,
  type PathPoint,
} from '@/lib/fiber-api';
import {
  mappingApi,
  type ListNetworkMapParams,
  type NetworkMapPoint,
  type NetworkMapResponse,
} from '@/lib/mapping-api';
import {
  opticalApi,
  SPLITTER_OUTPUT_COUNT,
  type CreateEnclosureInput,
  type OpticalEnclosureType,
  type SplitterRatio,
} from '@/lib/optical-api';
import { hasPermission } from '@/lib/session';

const NetworkMap = dynamic(
  () => import('@/components/mapping/NetworkMap').then((m) => m.NetworkMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-[600px] animate-pulse rounded-lg bg-surface-muted" />
    ),
  },
);

export default function MappingNetworkPage() {
  const canWrite = hasPermission('network.write');

  const [filters, setFilters] = useState<ListNetworkMapParams>({
    includePops: true,
    includeEquipment: true,
    includeOlts: true,
    includeEnclosures: true,
    includeCables: true,
    includeSplices: true,
  });

  const { data, isLoading, mutate } = useSWR<NetworkMapResponse>(
    mappingApi.networkPath(filters),
    { refreshInterval: 60_000 },
  );

  // ─── Modos de criação ─────────────────────────────────────────────────────
  const [mode, setMode] = useState<NetworkMapMode>('select');
  const [draftPath, setDraftPath] = useState<PathPoint[]>([]);
  const [enclosureDraft, setEnclosureDraft] = useState<LatLng | null>(null);
  const [cableDraft, setCableDraft] = useState<PathPoint[] | null>(null);

  // ESC sai do modo (com confirmação se houver path em construção).
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (mode === 'draw-cable' && draftPath.length >= 2) {
          // Finaliza cabo — abre modal de criação.
          setCableDraft(draftPath);
          setDraftPath([]);
          setMode('select');
        } else if (mode !== 'select') {
          setMode('select');
          setDraftPath([]);
        }
      } else if (e.key === 'Enter' && mode === 'draw-cable' && draftPath.length >= 2) {
        setCableDraft(draftPath);
        setDraftPath([]);
        setMode('select');
      } else if (e.key === 'Backspace' && mode === 'draw-cable') {
        // Remove último vértice
        setDraftPath((p) => p.slice(0, -1));
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [mode, draftPath]);

  function handleMapClick(latlng: { latitude: number; longitude: number }) {
    if (mode === 'create-enclosure') {
      setEnclosureDraft(latlng);
      setMode('select');
    } else if (mode === 'draw-cable') {
      setDraftPath((p) => [...p, latlng]);
    }
  }

  if (isLoading && !data) return <PageLoader label="Carregando rede…" />;

  const points: NetworkMapPoint[] = data?.points ?? [];
  const segments = data?.segments ?? [];
  const splices = data?.splices ?? [];
  const stats = data?.stats;

  function toggle(key: keyof ListNetworkMapParams) {
    setFilters((f) => ({ ...f, [key]: !(f[key] ?? true) }));
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mapa de Rede</h1>
          <p className="text-sm text-text-muted">
            Hub da planta óptica. Use a toolbar pra criar caixas e cabos
            direto no mapa; click numa caixa abre a vista esquemática.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/network/import-export">
            <Button variant="outline">
              <Upload className="h-3.5 w-3.5" />
              KML
            </Button>
          </Link>
          <Link href="/network/power-budget">
            <Button variant="outline">Power budget</Button>
          </Link>
        </div>
      </header>

      {/* Toolbar de filtros (camadas) */}
      <section className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface p-3 text-sm">
        <Layers className="h-4 w-4 text-text-muted" />
        <FilterChip
          label={`POPs (${stats?.pops ?? 0})`}
          color="#1e40af"
          active={filters.includePops ?? true}
          onClick={() => toggle('includePops')}
        />
        <FilterChip
          label={`Equipamentos (${stats?.equipment ?? 0})`}
          color="#ea580c"
          active={filters.includeEquipment ?? true}
          onClick={() => toggle('includeEquipment')}
        />
        <FilterChip
          label={`OLTs (${stats?.olts ?? 0})`}
          color="#7c3aed"
          active={filters.includeOlts ?? true}
          onClick={() => toggle('includeOlts')}
        />
        <FilterChip
          label={`Caixas (${stats?.enclosures ?? 0})`}
          color="#0d9488"
          active={filters.includeEnclosures ?? true}
          onClick={() => toggle('includeEnclosures')}
        />
        <FilterChip
          label={`Cabos (${stats?.cables ?? 0})`}
          color="#1d4ed8"
          active={filters.includeCables ?? true}
          onClick={() => toggle('includeCables')}
        />
        <FilterChip
          label={`Fusões (${stats?.splices ?? 0})`}
          color="#f59e0b"
          active={filters.includeSplices ?? true}
          onClick={() => toggle('includeSplices')}
        />
        <div className="ml-auto text-xs text-text-muted">
          {stats?.withoutGeo ? (
            <span className="text-amber-600">
              ⚠ {stats.withoutGeo} sem coord
            </span>
          ) : null}
        </div>
      </section>

      {/* Mapa + Toolbar de modos */}
      <div className="relative">
        {canWrite && (
          <ModeToolbar
            mode={mode}
            onChange={(m) => {
              setMode(m);
              setDraftPath([]); // reset em troca de modo
            }}
            pathLength={draftPath.length}
          />
        )}
        <NetworkMap
          points={points}
          segments={segments}
          splices={splices}
          mode={mode}
          onMapClick={handleMapClick}
          pendingPath={draftPath}
        />
        {mode !== 'select' && (
          <div className="pointer-events-none absolute bottom-3 left-3 right-3 z-[400] rounded-md bg-amber-500/95 px-3 py-2 text-center text-xs font-medium text-white shadow-lg">
            {mode === 'create-enclosure' && '📍 Clique no mapa pra marcar a caixa · ESC pra cancelar'}
            {mode === 'draw-cable' &&
              draftPath.length < 2 &&
              '✏️ Clique pra adicionar pontos do cabo · ESC pra cancelar'}
            {mode === 'draw-cable' &&
              draftPath.length >= 2 &&
              `✏️ ${draftPath.length} pontos · ENTER pra finalizar · BACKSPACE remove último · ESC cancela`}
          </div>
        )}
      </div>

      {enclosureDraft && (
        <CreateEnclosureQuickDialog
          latlng={enclosureDraft}
          onClose={() => setEnclosureDraft(null)}
          onCreated={async () => {
            await mutate();
            setEnclosureDraft(null);
            toast.success('Caixa criada');
          }}
        />
      )}
      {cableDraft && (
        <CreateCableQuickDialog
          path={cableDraft}
          onClose={() => setCableDraft(null)}
          onCreated={async () => {
            await mutate();
            setCableDraft(null);
            toast.success('Cabo criado');
          }}
        />
      )}
    </div>
  );
}

// ─── Toolbar lateral de modos ───────────────────────────────────────────────
function ModeToolbar({
  mode,
  onChange,
  pathLength,
}: {
  mode: NetworkMapMode;
  onChange: (m: NetworkMapMode) => void;
  pathLength: number;
}) {
  return (
    <div className="absolute left-3 top-3 z-[400] flex flex-col gap-1 rounded-md border border-border bg-surface p-1 shadow-md">
      <ModeButton
        active={mode === 'select'}
        onClick={() => onChange('select')}
        title="Selecionar (ESC)"
        icon={<MousePointer className="h-4 w-4" />}
      />
      <ModeButton
        active={mode === 'create-enclosure'}
        onClick={() => onChange('create-enclosure')}
        title="Criar caixa óptica"
        icon={<Box className="h-4 w-4" />}
      />
      <ModeButton
        active={mode === 'draw-cable'}
        onClick={() => onChange('draw-cable')}
        title="Desenhar cabo de fibra"
        icon={<Cable className="h-4 w-4" />}
        badge={pathLength > 0 ? pathLength : undefined}
      />
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  title,
  icon,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  icon: React.ReactNode;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`relative flex h-9 w-9 items-center justify-center rounded-md transition ${
        active
          ? 'bg-brand-500 text-white'
          : 'bg-surface text-text hover:bg-surface-hover'
      }`}
    >
      {icon}
      {badge !== undefined && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-2xs font-semibold text-white">
          {badge}
        </span>
      )}
    </button>
  );
}

// ─── Filter chip (mantido do hub anterior) ──────────────────────────────────
function FilterChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition ${
        active
          ? 'border-border bg-surface-muted text-text'
          : 'border-border bg-transparent text-text-muted opacity-60'
      }`}
    >
      <span
        className="inline-block h-3 w-3 rounded-sm"
        style={{ backgroundColor: color }}
      />
      {label}
    </button>
  );
}

// ─── Diálogo: criar caixa (rápido) ──────────────────────────────────────────
function CreateEnclosureQuickDialog({
  latlng,
  onClose,
  onCreated,
}: {
  latlng: LatLng;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [code, setCode] = useState('');
  const [type, setType] = useState<OpticalEnclosureType>('CTO');
  const [splitterRatio, setSplitterRatio] = useState<SplitterRatio | ''>('');
  const [capacity, setCapacity] = useState(16);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sugere capacity baseado em splitter ratio.
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
        type,
        latitude: latlng.latitude,
        longitude: latlng.longitude,
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

  return (
    <Modal
      open
      onClose={onClose}
      title="Nova caixa óptica"
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
          <div>
            <Label required>Código</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="CTO-001"
              autoFocus
            />
          </div>
          <div>
            <Label required>Tipo</Label>
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as OpticalEnclosureType)}
            >
              <option value="CTO">CTO</option>
              <option value="NAP">NAP</option>
              <option value="SPLITTER">Splitter</option>
              <option value="EMENDA">Emenda</option>
            </Select>
          </div>
          <div>
            <Label>Splitter</Label>
            <Select
              value={splitterRatio}
              onChange={(e) => pickRatio(e.target.value as SplitterRatio | '')}
            >
              <option value="">Sem</option>
              <option value="ONE_TO_2">1:2</option>
              <option value="ONE_TO_4">1:4</option>
              <option value="ONE_TO_8">1:8</option>
              <option value="ONE_TO_16">1:16</option>
              <option value="ONE_TO_32">1:32</option>
              <option value="ONE_TO_64">1:64</option>
            </Select>
          </div>
          <div>
            <Label required>Capacidade</Label>
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
          <Label>Observações</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <FieldHelp>
          Você pode editar todos os detalhes depois em{' '}
          <code className="text-2xs">/network/optical</code>.
        </FieldHelp>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}

// ─── Diálogo: criar cabo (rápido) ───────────────────────────────────────────
function CreateCableQuickDialog({
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
      await fiberCablesApi.create({
        code: code.trim(),
        type,
        fiberCount,
        path,
        notes: notes || null,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : 'Erro');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Novo cabo de fibra"
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
          <Label>Observações</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <FieldHelp>
          Endpoints A/B (caixas onde o cabo termina) podem ser definidos
          depois em <code className="text-2xs">/network/fiber</code>.
        </FieldHelp>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}

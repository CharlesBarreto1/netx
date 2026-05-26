'use client';

/**
 * /mapping/network — mapa de planta física (R1 do roadmap OSP).
 *
 * Carrega POPs + Equipamentos + OLTs georreferenciados via /v1/mapping/network.
 * Filtros por tipo de inventário. Pinos com cor distinta por kind.
 *
 * Próximas fases adicionam camadas:
 *   - R2: caixas ópticas (CTOs/Splitters)
 *   - R3: cabos de fibra (polylines)
 *   - R4: fusões/emendas (pinos extras)
 *   - R6: eventos OTDR (alertas vermelhos)
 */
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/Spinner';
import {
  mappingApi,
  type ListNetworkMapParams,
  type NetworkMapPoint,
  type NetworkMapResponse,
} from '@/lib/mapping-api';

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
  const [filters, setFilters] = useState<ListNetworkMapParams>({
    includePops: true,
    includeEquipment: true,
    includeOlts: true,
    includeEnclosures: true,
    includeCables: true,
  });

  const { data, isLoading } = useSWR<NetworkMapResponse>(
    mappingApi.networkPath(filters),
    { refreshInterval: 60_000 }, // 1 min: equipamentos não se movem, status raramente muda
  );

  if (isLoading && !data) return <PageLoader label="Carregando rede…" />;

  const points: NetworkMapPoint[] = data?.points ?? [];
  const segments = data?.segments ?? [];
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
            Planta física: POPs, equipamentos ativos (BNG/Router/Switch) e
            OLTs com geolocalização.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/network/pops">
            <Button variant="outline">Gerenciar POPs</Button>
          </Link>
          <Link href="/network/equipment">
            <Button variant="outline">Equipamentos</Button>
          </Link>
          <Link href="/olts">
            <Button variant="outline">OLTs</Button>
          </Link>
          <Link href="/network/optical">
            <Button variant="outline">Caixas ópticas</Button>
          </Link>
          <Link href="/network/fiber">
            <Button variant="outline">Cabos de fibra</Button>
          </Link>
        </div>
      </header>

      {/* Toolbar: filtros por tipo + contadores */}
      <section className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface p-3 text-sm">
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
          label={`Caixas ópticas (${stats?.enclosures ?? 0})`}
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
        <div className="ml-auto text-xs text-text-muted">
          Total visível: <strong>{stats?.total ?? 0}</strong>
          {stats?.withoutGeo ? (
            <span className="ml-3 text-amber-600">
              ⚠ {stats.withoutGeo} sem coordenada — marque pelo CRUD
            </span>
          ) : null}
        </div>
      </section>

      <NetworkMap points={points} segments={segments} />
    </div>
  );
}

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

'use client';

/**
 * PolylineEditor — desenha/edita uma polyline geográfica clicando no mapa.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Modos:
 *   - "draw": cada click no mapa adiciona um vértice no FIM da polyline.
 *   - "drag": vértices viram pinos arrastáveis pra ajuste fino.
 *
 * Sem leaflet-editable (dependência extra de 60kb). Implementação enxuta —
 * suficiente pra cabo FTTH típico (5-30 vértices). Pra polyline com 200+
 * pontos vale a pena trocar pelo plugin oficial.
 *
 * Output: chama `onChange(points)` toda vez que a polyline muda.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';

import 'leaflet/dist/leaflet.css';

export interface PolylinePoint {
  latitude: number;
  longitude: number;
}

interface Props {
  value: PolylinePoint[];
  onChange: (points: PolylinePoint[]) => void;
  /** Centro inicial — só usado se `value` está vazio. Default: Asunción. */
  initialCenter?: [number, number];
  height?: string;
}

const DEFAULT_CENTER: [number, number] = [-25.2637, -57.5759];

export function PolylineEditor({
  value,
  onChange,
  initialCenter = DEFAULT_CENTER,
  height = '360px',
}: Props) {
  const t = useTranslations('mapComponents');
  const [mode, setMode] = useState<'draw' | 'drag'>('draw');

  function removePoint(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  function movePoint(idx: number, p: PolylinePoint) {
    onChange(value.map((q, i) => (i === idx ? p : q)));
  }

  function addPoint(p: PolylinePoint) {
    onChange([...value, p]);
  }

  function clearAll() {
    onChange([]);
  }

  const center: [number, number] =
    value.length > 0
      ? [value[0].latitude, value[0].longitude]
      : initialCenter;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setMode('draw')}
          className={`rounded-md border px-2 py-1 ${
            mode === 'draw'
              ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-200'
              : 'border-border bg-surface'
          }`}
        >
          {t('polyline.draw')}
        </button>
        <button
          type="button"
          onClick={() => setMode('drag')}
          className={`rounded-md border px-2 py-1 ${
            mode === 'drag'
              ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-200'
              : 'border-border bg-surface'
          }`}
        >
          {t('polyline.adjust')}
        </button>
        <button
          type="button"
          onClick={clearAll}
          disabled={value.length === 0}
          className="rounded-md border border-border bg-surface px-2 py-1 disabled:opacity-40"
        >
          {t('polyline.clear')}
        </button>
        <span className="ml-auto text-text-muted">
          {t('polyline.pointCount', { count: value.length })}
          {mode === 'drag' && value.length > 0
            ? t('polyline.removeHint')
            : ''}
        </span>
      </div>

      <div
        style={{ height, width: '100%' }}
        className="overflow-hidden rounded-md border border-border"
      >
        <MapContainer
          center={center}
          zoom={value.length > 1 ? 14 : 13}
          scrollWheelZoom
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
          <FitBoundsToPath path={value} />
          <ClickHandler
            disabled={mode !== 'draw'}
            onAdd={addPoint}
          />
          {value.length >= 2 && (
            <Polyline
              positions={value.map((p) => [p.latitude, p.longitude])}
              pathOptions={{ color: '#0d9488', weight: 4, opacity: 0.85 }}
            />
          )}
          {value.map((p, i) => (
            <Marker
              key={`vertex-${i}`}
              position={[p.latitude, p.longitude]}
              draggable={mode === 'drag'}
              icon={vertexIcon(i, value.length)}
              eventHandlers={{
                click: () => {
                  if (mode === 'drag') removePoint(i);
                },
                // Leaflet types ausentes no monorepo (TS2307 pré-existente);
                // tipar com `any` evita TS7006 sem importar tipo quebrado.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                dragend: (e: any) => {
                  const pos = (e.target as L.Marker).getLatLng();
                  movePoint(i, { latitude: pos.lat, longitude: pos.lng });
                },
              }}
            />
          ))}
        </MapContainer>
      </div>
    </div>
  );
}

function ClickHandler({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (p: PolylinePoint) => void;
}) {
  useMapEvents({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    click(e: any) {
      if (disabled) return;
      onAdd({ latitude: e.latlng.lat, longitude: e.latlng.lng });
    },
  });
  return null;
}

function FitBoundsToPath({ path }: { path: PolylinePoint[] }) {
  const map = useMap();
  const key = useMemo(
    () => path.map((p) => `${p.latitude},${p.longitude}`).join('|'),
    [path],
  );
  useEffect(() => {
    // Só auto-fit na PRIMEIRA renderização com pontos. Senão o mapa fica
    // pulando toda vez que o operador adiciona um vértice no fim — chato.
    if (path.length < 2) return;
    const fitOnce = (map as L.Map & { __polylineFitDone?: boolean }).__polylineFitDone;
    if (fitOnce) return;
    const bounds = L.latLngBounds(path.map((p) => [p.latitude, p.longitude]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
    (map as L.Map & { __polylineFitDone?: boolean }).__polylineFitDone = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

function vertexIcon(idx: number, total: number): L.DivIcon {
  // Primeiro/último em destaque (origem/destino do cabo), intermediários menores.
  const isEnd = idx === 0 || idx === total - 1;
  const size = isEnd ? 18 : 12;
  const color = isEnd ? '#0d9488' : '#14b8a6';
  const html = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1}"
              fill="${color}" stroke="white" stroke-width="2"/>
    </svg>
  `;
  return L.divIcon({
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    className: '',
  });
}

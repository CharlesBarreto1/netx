'use client';

/**
 * NetworkMap — mapa Leaflet com pinos de POPs/BNG/OLT/Switch/Router.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Diferente do CustomerMap: aqui cada `kind` tem ícone+cor próprios pra
 * o operador distinguir "tipo de equipamento" de relance. POP é o mais
 * destacado (azul forte) porque ancora os outros.
 *
 * Carregamento: SSR-disable obrigatório no parent
 * (`dynamic(() => import('./NetworkMap'), { ssr: false })`).
 */
import { useEffect } from 'react';
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';

import type {
  NetworkMapPoint,
  NetworkMapPointKind,
  NetworkMapSegment,
  NetworkMapSplice,
} from '@/lib/mapping-api';

import 'leaflet/dist/leaflet.css';

/** Modos de interação suportados pelo mapa hub. */
export type NetworkMapMode = 'select' | 'create-enclosure' | 'draw-cable';

export interface NetworkMapProps {
  points: NetworkMapPoint[];
  segments?: NetworkMapSegment[];
  splices?: NetworkMapSplice[];
  center?: [number, number];
  zoom?: number;
  onMarkerClick?: (point: NetworkMapPoint) => void;
  onSegmentClick?: (segment: NetworkMapSegment) => void;
  onSpliceClick?: (splice: NetworkMapSplice) => void;
  /** Modo ativo — controla cursor e o que acontece em map click. */
  mode?: NetworkMapMode;
  /** Click no canvas vazio (não em marker/polyline). Usado pra criar caixa/cabo. */
  onMapClick?: (latlng: { latitude: number; longitude: number }) => void;
  /** Path em construção no modo draw-cable — renderizado como polyline tracejada. */
  pendingPath?: Array<{ latitude: number; longitude: number }>;
  height?: string;
}

const DEFAULT_CENTER: [number, number] = [-25.2637, -57.5759]; // Asunción
const DEFAULT_ZOOM = 13;

export function NetworkMap({
  points,
  segments = [],
  splices = [],
  center,
  zoom = DEFAULT_ZOOM,
  onMarkerClick,
  onSegmentClick,
  onSpliceClick,
  mode = 'select',
  onMapClick,
  pendingPath = [],
  height = '600px',
}: NetworkMapProps) {
  const initialCenter: [number, number] =
    center ??
    (points.length > 0
      ? [points[0].latitude, points[0].longitude]
      : segments.length > 0 && segments[0].path.length > 0
        ? [segments[0].path[0].latitude, segments[0].path[0].longitude]
        : splices.length > 0
          ? [splices[0].latitude, splices[0].longitude]
          : DEFAULT_CENTER);

  // Cursor por modo — controla via classe CSS no container, não inline porque
  // Leaflet sobrescreve cursor do canvas via .leaflet-grab.
  const cursorClass =
    mode === 'create-enclosure'
      ? 'cursor-crosshair'
      : mode === 'draw-cable'
        ? 'cursor-cell'
        : '';

  return (
    <div
      style={{ height, width: '100%' }}
      className={`rounded-lg overflow-hidden border border-border ${cursorClass}`}
    >
      <MapContainer
        center={initialCenter}
        zoom={zoom}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <MapClickHandler mode={mode} onMapClick={onMapClick} />
        {pendingPath.length >= 1 && (
          <>
            {pendingPath.length >= 2 && (
              <Polyline
                positions={pendingPath.map((p) => [p.latitude, p.longitude])}
                pathOptions={{
                  color: '#f59e0b',
                  weight: 3,
                  opacity: 0.9,
                  dashArray: '6 4',
                }}
              />
            )}
            {pendingPath.map((p, i) => (
              <Marker
                key={`pending-${i}`}
                position={[p.latitude, p.longitude]}
                icon={pendingVertexIcon(i === 0 || i === pendingPath.length - 1)}
              />
            ))}
          </>
        )}
        <FitBoundsToFeatures
          points={points}
          segments={segments}
          splices={splices}
          initialCenter={initialCenter}
        />
        {/* Cabos primeiro pra ficarem ABAIXO dos pinos no z-order. */}
        {segments.map((s) => (
          <Polyline
            key={`cable-${s.id}`}
            positions={s.path.map((p) => [p.latitude, p.longitude])}
            pathOptions={{
              color: colorForCableType(s.type),
              weight: s.type === 'BACKBONE' ? 4 : s.type === 'DISTRIBUTION' ? 3 : 2,
              opacity: s.isActive ? 0.85 : 0.4,
              dashArray: s.type === 'DROP' ? '4 4' : undefined,
            }}
            eventHandlers={
              onSegmentClick ? { click: () => onSegmentClick(s) } : undefined
            }
          >
            <Popup>
              <CablePopupContent segment={s} />
            </Popup>
          </Polyline>
        ))}
        {points.map((p) => (
          <Marker
            key={`${p.kind}-${p.id}`}
            position={[p.latitude, p.longitude]}
            icon={iconForPoint(p)}
            eventHandlers={
              onMarkerClick ? { click: () => onMarkerClick(p) } : undefined
            }
          >
            <Popup>
              <NetworkPopupContent point={p} />
            </Popup>
          </Marker>
        ))}
        {/* Fusões por cima de tudo — pino-estrela pequeno mas distinto. */}
        {splices.map((s) => (
          <Marker
            key={`splice-${s.id}`}
            position={[s.latitude, s.longitude]}
            icon={iconForSplice(s)}
            eventHandlers={
              onSpliceClick ? { click: () => onSpliceClick(s) } : undefined
            }
          >
            <Popup>
              <SplicePopupContent splice={s} />
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

/**
 * Captura click no canvas (não em marker/polyline — Leaflet propaga só quando
 * ninguém parou). Só dispara se o modo permitir.
 */
function MapClickHandler({
  mode,
  onMapClick,
}: {
  mode: NetworkMapMode;
  onMapClick?: NetworkMapProps['onMapClick'];
}) {
  useMapEvents({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    click(e: any) {
      if (mode === 'select' || !onMapClick) return;
      onMapClick({ latitude: e.latlng.lat, longitude: e.latlng.lng });
    },
  });
  return null;
}

function pendingVertexIcon(isEnd: boolean): L.DivIcon {
  const size = isEnd ? 16 : 10;
  const color = isEnd ? '#d97706' : '#f59e0b';
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

function FitBoundsToFeatures({
  points,
  segments,
  splices,
  initialCenter,
}: {
  points: NetworkMapPoint[];
  segments: NetworkMapSegment[];
  splices: NetworkMapSplice[];
  initialCenter: [number, number];
}) {
  const map = useMap();
  useEffect(() => {
    const all: Array<[number, number]> = [];
    points.forEach((p) => all.push([p.latitude, p.longitude]));
    segments.forEach((s) =>
      s.path.forEach((p) => all.push([p.latitude, p.longitude])),
    );
    splices.forEach((s) => all.push([s.latitude, s.longitude]));
    if (all.length === 0) {
      map.setView(initialCenter, DEFAULT_ZOOM);
      return;
    }
    if (all.length === 1) {
      map.setView(all[0], 15);
      return;
    }
    const bounds = L.latLngBounds(all);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    points.map((p) => `${p.kind}-${p.id}`).join(','),
    segments.map((s) => s.id).join(','),
    splices.map((s) => s.id).join(','),
  ]);
  return null;
}

// Cor do ícone da fusão por classe da perda.
function colorForSpliceLoss(loss: NetworkMapSplice['lossClass']): string {
  switch (loss) {
    case 'unmeasured':
      return '#9ca3af'; // gray-400
    case 'good':
      return '#059669'; // emerald-600
    case 'warning':
      return '#f59e0b'; // amber-500
    case 'bad':
      return '#dc2626'; // red-600
  }
}

function iconForSplice(s: NetworkMapSplice): L.DivIcon {
  const color = colorForSpliceLoss(s.lossClass);
  // Pino-estrela: dois semicírculos com as cores TIA das fibras A e B,
  // borda colorida por classe de perda. Fica chamativo no mapa.
  const html = `
    <svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="halfA-${s.id}"><rect x="0" y="0" width="11" height="22"/></clipPath>
        <clipPath id="halfB-${s.id}"><rect x="11" y="0" width="11" height="22"/></clipPath>
      </defs>
      <circle cx="11" cy="11" r="9" fill="${s.fiberAColor}" clip-path="url(#halfA-${s.id})"/>
      <circle cx="11" cy="11" r="9" fill="${s.fiberBColor}" clip-path="url(#halfB-${s.id})"/>
      <circle cx="11" cy="11" r="9" fill="none" stroke="${color}" stroke-width="3"/>
    </svg>
  `;
  return L.divIcon({
    html,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -11],
    className: '',
  });
}

function colorForCableType(t: NetworkMapSegment['type']): string {
  switch (t) {
    case 'BACKBONE':
      return '#1d4ed8'; // blue-700 — espinha dorsal
    case 'DISTRIBUTION':
      return '#9333ea'; // purple-600
    case 'DROP':
      return '#0d9488'; // teal-600 — última milha
  }
}

function formatLength(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${meters.toFixed(0)} m`;
}

function SplicePopupContent({ splice }: { splice: NetworkMapSplice }) {
  const lossLabel =
    splice.lossClass === 'unmeasured'
      ? 'Não medido'
      : splice.lossClass === 'good'
        ? 'OK'
        : splice.lossClass === 'warning'
          ? 'Atenção'
          : 'Refazer';
  const lossColor = colorForSpliceLoss(splice.lossClass);
  return (
    <div style={{ minWidth: 220 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Fusão</div>
      <div style={{ fontSize: 12 }}>
        <strong>A:</strong> {splice.cableACode} ·{' '}
        <span
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            backgroundColor: splice.fiberAColor,
            border: '1px solid #94a3b8',
            borderRadius: '50%',
            verticalAlign: 'middle',
          }}
        />{' '}
        f{splice.fiberAIndex}
      </div>
      <div style={{ fontSize: 12 }}>
        <strong>B:</strong> {splice.cableBCode} ·{' '}
        <span
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            backgroundColor: splice.fiberBColor,
            border: '1px solid #94a3b8',
            borderRadius: '50%',
            verticalAlign: 'middle',
          }}
        />{' '}
        f{splice.fiberBIndex}
      </div>
      <div style={{ fontSize: 12, marginTop: 6 }}>
        <strong>Loss:</strong>{' '}
        {splice.lossDb != null ? `${splice.lossDb.toFixed(2)} dB` : '—'}{' '}
        <span style={{ color: lossColor, fontWeight: 600 }}>· {lossLabel}</span>
      </div>
      <div style={{ fontSize: 12, marginTop: 8 }}>
        <a href="/network/splices" style={{ color: '#2563eb' }}>
          Abrir CRUD →
        </a>
      </div>
    </div>
  );
}

function CablePopupContent({ segment }: { segment: NetworkMapSegment }) {
  const typeLabel =
    segment.type === 'BACKBONE'
      ? 'Backbone'
      : segment.type === 'DISTRIBUTION'
        ? 'Distribuição'
        : 'Drop (cliente)';
  return (
    <div style={{ minWidth: 220 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{segment.code}</div>
      <div style={{ fontSize: 12, color: '#666' }}>{typeLabel}</div>
      <div style={{ fontSize: 12, marginTop: 6 }}>
        <strong>Fibras:</strong> {segment.fiberCount}
      </div>
      <div style={{ fontSize: 12 }}>
        <strong>Comprimento:</strong> {formatLength(segment.lengthMeters)}
      </div>
      <div style={{ fontSize: 12, marginTop: 8 }}>
        <a href="/network/fiber" style={{ color: '#2563eb' }}>
          Abrir CRUD →
        </a>
      </div>
    </div>
  );
}

function NetworkPopupContent({ point }: { point: NetworkMapPoint }) {
  const kindLabel = KIND_LABEL[point.kind];
  const statusBadge = point.isActive ? (
    <span style={{ color: '#16a34a', fontWeight: 600 }}>Ativo</span>
  ) : (
    <span style={{ color: '#dc2626', fontWeight: 600 }}>Inativo</span>
  );
  // Linkar pro CRUD certo dependendo do kind. Caixas ópticas vão direto
  // pra a VISTA ESQUEMÁTICA da caixa (R4.5b) — não pra a lista genérica.
  const isOptical =
    point.kind === 'CTO' ||
    point.kind === 'NAP' ||
    point.kind === 'SPLITTER' ||
    point.kind === 'EMENDA';
  const detailHref =
    point.kind === 'POP'
      ? `/network/pops`
      : point.kind === 'OLT'
        ? `/olts`
        : isOptical
          ? `/network/optical/${point.id}`
          : `/network/equipment`;
  return (
    <div style={{ minWidth: 220 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{point.name}</div>
      <div style={{ fontSize: 12, color: '#666' }}>
        {kindLabel}
        {point.code ? ` · ${point.code}` : ''} · {statusBadge}
      </div>
      {point.vendor && (
        <div style={{ fontSize: 12, marginTop: 6 }}>
          <strong>Fornecedor:</strong> {point.vendor}
          {point.model ? ` · ${point.model}` : ''}
        </div>
      )}
      {point.ipAddress && (
        <div style={{ fontSize: 12 }}>
          <strong>IP:</strong> <code>{point.ipAddress}</code>
        </div>
      )}
      {isOptical && point.capacity != null && (
        <div style={{ fontSize: 12, marginTop: 6 }}>
          <strong>Ocupação:</strong> {point.occupancyPct ?? 0}% · {point.capacity}{' '}
          portas
        </div>
      )}
      <div style={{ fontSize: 12, marginTop: 8 }}>
        <a href={detailHref} style={{ color: '#2563eb' }}>
          {isOptical ? 'Abrir vista esquemática →' : 'Abrir CRUD →'}
        </a>
      </div>
    </div>
  );
}

const KIND_LABEL: Record<NetworkMapPointKind, string> = {
  POP: 'POP',
  BNG: 'BNG / NAS',
  OLT: 'OLT',
  ROUTER: 'Router',
  SWITCH: 'Switch',
  OTHER: 'Outro',
  CTO: 'CTO',
  NAP: 'NAP',
  SPLITTER: 'Splitter',
  EMENDA: 'Emenda',
};

// ─── Cores e ícones por tipo ────────────────────────────────────────────────
// Paleta intencionalmente distinta da do CustomerMap (status RADIUS) pra
// não confundir admin que olha 2 mapas seguidos.
//
// Caixas ópticas (CTO/NAP/Splitter) ganham cor BASE neutra (verde-azul-cinza)
// que é sobrescrita por uma cor de ocupação quando >0% — admin vê de relance
// quais CTOs estão lotadas.
function colorForKind(kind: NetworkMapPointKind): string {
  switch (kind) {
    case 'POP':
      return '#1e40af'; // blue-800 — âncora física, destaque
    case 'BNG':
      return '#ea580c'; // orange-600 — núcleo de autenticação
    case 'OLT':
      return '#7c3aed'; // violet-600 — agregação óptica
    case 'ROUTER':
      return '#0891b2'; // cyan-600
    case 'SWITCH':
      return '#475569'; // slate-600
    case 'CTO':
    case 'NAP':
      return '#0d9488'; // teal-600 — caixa de cliente
    case 'SPLITTER':
      return '#0f766e'; // teal-700 — só passivo
    case 'EMENDA':
      return '#525252'; // neutral-600 — sem cliente
    case 'OTHER':
      return '#6b7280'; // gray-500
  }
}

// Quando é caixa óptica com ocupação, cor reflete saturação (verde → vermelho).
function colorForOccupancy(pct: number): string {
  if (pct >= 80) return '#dc2626'; // red-600
  if (pct >= 50) return '#f59e0b'; // amber-500
  return '#059669'; // emerald-600
}

function iconForPoint(p: NetworkMapPoint): L.DivIcon {
  const isOptical =
    p.kind === 'CTO' ||
    p.kind === 'NAP' ||
    p.kind === 'SPLITTER' ||
    p.kind === 'EMENDA';
  // Pra caixas com ocupação, usa cor de saturação. Pras outras (e EMENDA
  // que não tem porta), usa a cor base do kind.
  const base =
    isOptical && p.kind !== 'EMENDA' && (p.occupancyPct ?? 0) > 0
      ? colorForOccupancy(p.occupancyPct ?? 0)
      : colorForKind(p.kind);
  const color = p.isActive ? base : '#9ca3af';
  const opacity = p.isActive ? 1 : 0.6;
  // Letra do kind dentro do quadrado. CTO/NAP/SPLITTER usam 2 letras pra
  // distinguir (CT/NA/SP/EM).
  const letter =
    p.kind === 'POP'
      ? 'P'
      : p.kind === 'CTO'
        ? 'CT'
        : p.kind === 'NAP'
          ? 'NA'
          : p.kind === 'SPLITTER'
            ? 'SP'
            : p.kind === 'EMENDA'
              ? 'EM'
              : p.kind[0];
  const fontSize = letter.length === 2 ? 11 : 14;
  const html = `
    <svg width="30" height="30" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg" style="opacity:${opacity}">
      <rect x="1" y="1" width="28" height="28" rx="4" ry="4"
            fill="${color}" stroke="#1f2937" stroke-width="1.5"/>
      <text x="15" y="20" text-anchor="middle" font-family="system-ui, sans-serif"
            font-size="${fontSize}" font-weight="700" fill="white">${letter}</text>
    </svg>
  `;
  return L.divIcon({
    html,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15],
    className: '',
  });
}

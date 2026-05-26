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
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';

import type { NetworkMapPoint, NetworkMapPointKind } from '@/lib/mapping-api';

import 'leaflet/dist/leaflet.css';

export interface NetworkMapProps {
  points: NetworkMapPoint[];
  center?: [number, number];
  zoom?: number;
  onMarkerClick?: (point: NetworkMapPoint) => void;
  height?: string;
}

const DEFAULT_CENTER: [number, number] = [-25.2637, -57.5759]; // Asunción
const DEFAULT_ZOOM = 13;

export function NetworkMap({
  points,
  center,
  zoom = DEFAULT_ZOOM,
  onMarkerClick,
  height = '600px',
}: NetworkMapProps) {
  const initialCenter: [number, number] =
    center ??
    (points.length > 0 ? [points[0].latitude, points[0].longitude] : DEFAULT_CENTER);

  return (
    <div
      style={{ height, width: '100%' }}
      className="rounded-lg overflow-hidden border border-border"
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
        <FitBoundsToPoints points={points} initialCenter={initialCenter} />
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
      </MapContainer>
    </div>
  );
}

function FitBoundsToPoints({
  points,
  initialCenter,
}: {
  points: NetworkMapPoint[];
  initialCenter: [number, number];
}) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) {
      map.setView(initialCenter, DEFAULT_ZOOM);
      return;
    }
    if (points.length === 1) {
      map.setView([points[0].latitude, points[0].longitude], 15);
      return;
    }
    const bounds = L.latLngBounds(points.map((p) => [p.latitude, p.longitude]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.map((p) => `${p.kind}-${p.id}`).join(',')]);
  return null;
}

function NetworkPopupContent({ point }: { point: NetworkMapPoint }) {
  const kindLabel = KIND_LABEL[point.kind];
  const statusBadge = point.isActive ? (
    <span style={{ color: '#16a34a', fontWeight: 600 }}>Ativo</span>
  ) : (
    <span style={{ color: '#dc2626', fontWeight: 600 }}>Inativo</span>
  );
  // Linkar pro CRUD certo dependendo do kind. OLT vai pra /olts; POP+Equipment
  // pra /network/{pops,equipment}.
  const detailHref =
    point.kind === 'POP'
      ? `/network/pops`
      : point.kind === 'OLT'
        ? `/olts`
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
      <div style={{ fontSize: 12, marginTop: 8 }}>
        <a href={detailHref} style={{ color: '#2563eb' }}>
          Abrir CRUD →
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
};

// ─── Cores e ícones por tipo ────────────────────────────────────────────────
// Paleta intencionalmente distinta da do CustomerMap (status RADIUS) pra
// não confundir admin que olha 2 mapas seguidos.
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
    case 'OTHER':
      return '#6b7280'; // gray-500
  }
}

function iconForPoint(p: NetworkMapPoint): L.DivIcon {
  const base = colorForKind(p.kind);
  // Inativo: desaturado + opacity menor
  const color = p.isActive ? base : '#9ca3af';
  const opacity = p.isActive ? 1 : 0.6;
  // Ícone quadrado com letra do kind dentro — diferencia rápido de cliente
  // (que é drop-pin) sem precisar olhar legenda.
  const letter = p.kind === 'POP' ? 'P' : p.kind[0];
  const html = `
    <svg width="30" height="30" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg" style="opacity:${opacity}">
      <rect x="1" y="1" width="28" height="28" rx="4" ry="4"
            fill="${color}" stroke="#1f2937" stroke-width="1.5"/>
      <text x="15" y="20" text-anchor="middle" font-family="system-ui, sans-serif"
            font-size="14" font-weight="700" fill="white">${letter}</text>
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

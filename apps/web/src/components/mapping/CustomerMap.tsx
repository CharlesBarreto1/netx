'use client';

/**
 * CustomerMap — mapa Leaflet com pinos coloridos por status RADIUS.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Cores:
 *   verde    = ACTIVE + sessão RADIUS ativa (cliente online)
 *   vermelho = ACTIVE sem sessão (problema técnico — ONT off, queda fibra)
 *   amarelo  = SUSPENDED (corte por inadimplência ou manual)
 *   azul     = PENDING_INSTALL
 *   cinza    = CANCELLED
 *
 * Performance: pra ~500 pontos roda nativo bem. Acima disso, plug
 * `react-leaflet-markercluster` (não usado na v1).
 *
 * Next.js SSR: o `react-leaflet` quebra no server (window indefinido).
 * Componente é client-only — `dynamic(() => import(...), { ssr: false })`
 * deve ser usado no wrapping da página.
 */
import { useEffect } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';

import type { CustomerMapPoint } from '@/lib/mapping-api';

// CSS do Leaflet — importa só no client. Sem isso, o mapa renderiza branco.
import 'leaflet/dist/leaflet.css';

export interface CustomerMapProps {
  points: CustomerMapPoint[];
  /** Centro inicial. Default = primeiro ponto, ou [-25.28, -57.63] (Asunción). */
  center?: [number, number];
  zoom?: number;
  /** Click no pino dispara este callback (além do popup). */
  onMarkerClick?: (point: CustomerMapPoint) => void;
  /** Altura CSS do mapa. Default '600px'. Use '100%' se container já tem altura. */
  height?: string;
}

const DEFAULT_CENTER: [number, number] = [-25.2637, -57.5759]; // Asunción
const DEFAULT_ZOOM = 13;

export function CustomerMap({
  points,
  center,
  zoom = DEFAULT_ZOOM,
  onMarkerClick,
  height = '600px',
}: CustomerMapProps) {
  const initialCenter: [number, number] =
    center ??
    (points.length > 0 ? [points[0].latitude, points[0].longitude] : DEFAULT_CENTER);

  return (
    <div style={{ height, width: '100%' }} className="rounded-lg overflow-hidden border border-border">
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
            key={p.id}
            position={[p.latitude, p.longitude]}
            icon={iconForPoint(p)}
            eventHandlers={
              onMarkerClick
                ? { click: () => onMarkerClick(p) }
                : undefined
            }
          >
            <Popup>
              <CustomerPopupContent point={p} />
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

/**
 * Quando o set de pontos muda significativamente, re-enquadra o mapa pra
 * caber todos. Limita zoom mínimo pra não ficar muito longe quando há
 * só 1 ponto.
 */
function FitBoundsToPoints({
  points,
  initialCenter,
}: {
  points: CustomerMapPoint[];
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
    // points dependency: serializa pra trigger só em mudança real
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.map((p) => p.id).join(',')]);
  return null;
}

function CustomerPopupContent({ point }: { point: CustomerMapPoint }) {
  const statusLabel = (() => {
    if (point.status === 'ACTIVE') return point.online ? 'Online' : 'Offline';
    if (point.status === 'SUSPENDED') return 'Suspenso';
    if (point.status === 'PENDING_INSTALL') return 'Instalação pendente';
    return 'Cancelado';
  })();
  const statusColor = colorForPoint(point);
  return (
    <div style={{ minWidth: 220 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{point.customerName}</div>
      <div style={{ fontSize: 12, color: '#666' }}>
        {point.code ? `${point.code} · ` : ''}
        <span style={{ color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
      </div>
      {point.planName && (
        <div style={{ fontSize: 12, marginTop: 6 }}>
          <strong>Plano:</strong> {point.planName}
        </div>
      )}
      <div style={{ fontSize: 12 }}>
        <strong>Mensalidade:</strong>{' '}
        {point.monthlyValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
      </div>
      {point.radiusIdentifier && (
        <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
          <code>{point.radiusIdentifier}</code>
        </div>
      )}
      <div style={{ fontSize: 12, marginTop: 8 }}>
        <a href={`/contracts/${point.id}`} style={{ color: '#2563eb' }}>
          Abrir contrato →
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ícones custom (divIcon HTML — evita problema dos PNGs do Leaflet em Next.js)
// ---------------------------------------------------------------------------
function colorForPoint(p: CustomerMapPoint): string {
  if (p.status === 'CANCELLED') return '#6b7280';   // gray-500
  if (p.status === 'PENDING_INSTALL') return '#3b82f6'; // blue-500
  if (p.status === 'SUSPENDED') return '#eab308';   // yellow-500
  // ACTIVE
  return p.online ? '#22c55e' : '#ef4444';          // green-500 / red-500
}

function iconForPoint(p: CustomerMapPoint): L.DivIcon {
  const color = colorForPoint(p);
  // Drop pin shape via SVG inline + dot interno. Tamanho 28x36, anchor no
  // bottom-center (pino aponta pro local exato).
  const html = `
    <svg width="28" height="36" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 0 C6.27 0 0 6.27 0 14 c0 10.5 14 22 14 22 s14 -11.5 14 -22 C28 6.27 21.73 0 14 0 z"
            fill="${color}" stroke="#1f2937" stroke-width="1"/>
      <circle cx="14" cy="13" r="5" fill="white"/>
    </svg>
  `.trim();
  return L.divIcon({
    html,
    className: 'netx-map-pin',
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -32],
  });
}

'use client';

/**
 * FleetLiveMap — mapa Leaflet das posições ao vivo dos veículos (Traccar).
 *
 * Cores por status:
 *   verde   = MOVING (em movimento)
 *   âmbar   = STOPPED (parado, reportando)
 *   cinza   = OFFLINE (sem report recente)
 *
 * Client-only (react-leaflet quebra no SSR) — a página carrega via
 * dynamic(import, { ssr: false }). O fit-bounds só reage à mudança do CONJUNTO
 * de veículos (ids), não a cada atualização de posição, pra não resetar a
 * visão do usuário a cada poll.
 */
import { useEffect } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';

import type { LivePosition, LiveVehicleStatus } from '@/lib/fleet-api';

import 'leaflet/dist/leaflet.css';

const DEFAULT_CENTER: [number, number] = [-25.2637, -57.5759]; // Asunción
const DEFAULT_ZOOM = 12;

const STATUS_COLOR: Record<LiveVehicleStatus, string> = {
  MOVING: '#22c55e',
  STOPPED: '#eab308',
  OFFLINE: '#6b7280',
};

const STATUS_LABEL: Record<LiveVehicleStatus, string> = {
  MOVING: 'Em movimento',
  STOPPED: 'Parado',
  OFFLINE: 'Offline',
};

export function FleetLiveMap({
  positions,
  selectedId,
  onSelect,
  height = '100%',
}: {
  positions: LivePosition[];
  selectedId?: string | null;
  onSelect?: (vehicleId: string) => void;
  height?: string;
}) {
  const initialCenter: [number, number] =
    positions.length > 0 ? [positions[0].latitude, positions[0].longitude] : DEFAULT_CENTER;

  return (
    <div style={{ height, width: '100%' }} className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
      <MapContainer center={initialCenter} zoom={DEFAULT_ZOOM} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <FitBounds positions={positions} initialCenter={initialCenter} />
        <PanToSelected positions={positions} selectedId={selectedId} />
        {positions.map((p) => (
          <Marker
            key={p.vehicleId}
            position={[p.latitude, p.longitude]}
            icon={iconFor(p, p.vehicleId === selectedId)}
            eventHandlers={onSelect ? { click: () => onSelect(p.vehicleId) } : undefined}
          >
            <Popup>
              <PopupContent point={p} />
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

function FitBounds({
  positions,
  initialCenter,
}: {
  positions: LivePosition[];
  initialCenter: [number, number];
}) {
  const map = useMap();
  useEffect(() => {
    if (positions.length === 0) {
      map.setView(initialCenter, DEFAULT_ZOOM);
      return;
    }
    if (positions.length === 1) {
      map.setView([positions[0].latitude, positions[0].longitude], 15);
      return;
    }
    const bounds = L.latLngBounds(positions.map((p) => [p.latitude, p.longitude]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    // Só refita quando o CONJUNTO de veículos muda (não a cada poll de posição):
    // a dep abaixo é a lista de ids serializada, de propósito.
  }, [positions.map((p) => p.vehicleId).sort().join(',')]);
  return null;
}

function PanToSelected({
  positions,
  selectedId,
}: {
  positions: LivePosition[];
  selectedId?: string | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (!selectedId) return;
    const p = positions.find((x) => x.vehicleId === selectedId);
    if (p) map.setView([p.latitude, p.longitude], Math.max(map.getZoom(), 15));
    // Reage só à seleção; não queremos re-pan a cada atualização de posição.
  }, [selectedId]);
  return null;
}

function PopupContent({ point }: { point: LivePosition }) {
  return (
    <div style={{ minWidth: 200 }}>
      <div style={{ fontWeight: 600, marginBottom: 2 }}>
        {point.plate} <span style={{ fontWeight: 400, color: '#666' }}>{point.label}</span>
      </div>
      <div style={{ fontSize: 12 }}>
        <span style={{ color: STATUS_COLOR[point.status], fontWeight: 600 }}>{STATUS_LABEL[point.status]}</span>
        {point.speed != null ? ` · ${Math.round(point.speed)} km/h` : ''}
      </div>
      {point.driverName && <div style={{ fontSize: 12, marginTop: 4 }}><strong>Motorista:</strong> {point.driverName}</div>}
      {point.address && <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{point.address}</div>}
      <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
        Atualizado: {new Date(point.deviceTime).toLocaleString('pt-BR')}
      </div>
    </div>
  );
}

function iconFor(p: LivePosition, selected: boolean): L.DivIcon {
  const color = STATUS_COLOR[p.status];
  const rotate = p.status === 'MOVING' && p.course != null ? p.course : null;
  // Bolinha colorida; se em movimento, uma seta apontando pra direção (course).
  const arrow =
    rotate != null
      ? `<div style="position:absolute;top:-9px;left:50%;transform:translateX(-50%) rotate(${rotate}deg);transform-origin:50% 17px;">
           <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:8px solid ${color};"></div>
         </div>`
      : '';
  const ring = selected ? 'box-shadow:0 0 0 4px rgba(37,99,235,0.45);' : '';
  const html = `
    <div style="position:relative;width:18px;height:18px;">
      ${arrow}
      <div style="width:18px;height:18px;border-radius:9999px;background:${color};border:2px solid white;${ring}"></div>
    </div>
  `.trim();
  return L.divIcon({
    html,
    className: 'netx-fleet-marker',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10],
  });
}

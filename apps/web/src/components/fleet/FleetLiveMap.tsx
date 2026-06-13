'use client';

/**
 * FleetLiveMap — mapa Leaflet das posições ao vivo dos veículos (Traccar).
 *
 * Marcador = ícone do veículo (escolhido no cadastro: carro vermelho, carro
 * com escada, van branca, caminhão) + bolinha de status no canto:
 *   verde    = ON (ignição ligada)
 *   amarelo  = IDLE (ligado, parado > 2 min)
 *   cinza    = OFF (ignição desligada)
 *   vermelho = STALE (sem sincronizar > 4 h)
 * Hover mostra tooltip com motorista, placa e velocidade.
 *
 * Histórico: recebendo `route`, desenha o percurso em polylines — uma cor por
 * trecho (separados por paradas de mais de ROUTE_GAP_MIN min) e sobrepõe em
 * vermelho os segmentos acima de `speedLimit` km/h.
 *
 * Client-only (react-leaflet quebra no SSR) — a página carrega via
 * dynamic(import, { ssr: false }). O fit-bounds só reage à mudança do CONJUNTO
 * de veículos (ids), não a cada atualização de posição, pra não resetar a
 * visão do usuário a cada poll.
 */
import { useEffect, useMemo } from 'react';
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';

import type {
  FleetRoute,
  LiveDotStatus,
  LivePosition,
  LiveVehicleStatus,
  RoutePoint,
  VehicleMapIcon,
} from '@/lib/fleet-api';

import 'leaflet/dist/leaflet.css';

const DEFAULT_CENTER: [number, number] = [-25.2637, -57.5759]; // Asunción
const DEFAULT_ZOOM = 12;

/** Parada maior que isso separa trechos (cores) do histórico. */
const ROUTE_GAP_MIN = 10;

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

export const DOT_COLOR: Record<LiveDotStatus, string> = {
  ON: '#22c55e',
  IDLE: '#eab308',
  OFF: '#6b7280',
  STALE: '#ef4444',
};

/** Paleta dos trechos do histórico (cicla quando há mais trechos que cores). */
const ROUTE_COLORS = ['#2563eb', '#7c3aed', '#0d9488', '#d97706', '#db2777', '#65a30d'];
const SPEEDING_COLOR = '#ef4444';

export function FleetLiveMap({
  positions,
  selectedId,
  onSelect,
  route,
  speedLimit = 80,
  height = '100%',
}: {
  positions: LivePosition[];
  selectedId?: string | null;
  onSelect?: (vehicleId: string) => void;
  /** Percurso histórico a desenhar (null/undefined = só posições ao vivo). */
  route?: FleetRoute | null;
  /** km/h — acima disso o segmento é destacado como excesso de velocidade. */
  speedLimit?: number;
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
        <FitBounds positions={positions} initialCenter={initialCenter} hasRoute={Boolean(route)} />
        <PanToSelected positions={positions} selectedId={selectedId} />
        {route && <RouteLayer route={route} speedLimit={speedLimit} />}
        {positions.map((p) => (
          <Marker
            key={p.vehicleId}
            position={[p.latitude, p.longitude]}
            icon={iconFor(p, p.vehicleId === selectedId)}
            eventHandlers={onSelect ? { click: () => onSelect(p.vehicleId) } : undefined}
          >
            <Tooltip direction="top" offset={[0, -16]} opacity={0.95}>
              <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                <div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{p.plate}</div>
                {p.driverName && <div>{p.driverName}</div>}
                <div>{p.speed != null ? `${Math.round(p.speed)} km/h` : '—'}</div>
              </div>
            </Tooltip>
            <Popup>
              <PopupContent point={p} />
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Histórico de percurso
// ─────────────────────────────────────────────────────────────────────────────

function RouteLayer({ route, speedLimit }: { route: FleetRoute; speedLimit: number }) {
  const trechos = useMemo(() => splitTrechos(route.points), [route]);
  const speeding = useMemo(
    () => speedingRuns(route.points, speedLimit),
    [route, speedLimit],
  );
  const first = route.points[0];
  const last = route.points[route.points.length - 1];

  return (
    <>
      {trechos.map((seg, i) => (
        <Polyline
          key={`seg-${i}`}
          positions={seg.map((p) => [p.latitude, p.longitude] as [number, number])}
          pathOptions={{ color: ROUTE_COLORS[i % ROUTE_COLORS.length], weight: 4, opacity: 0.85 }}
        />
      ))}
      {speeding.map((seg, i) => (
        <Polyline
          key={`spd-${i}`}
          positions={seg.map((p) => [p.latitude, p.longitude] as [number, number])}
          pathOptions={{ color: SPEEDING_COLOR, weight: 6, opacity: 0.9 }}
        >
          <Tooltip sticky>
            {`> ${speedLimit} km/h (máx ${Math.round(Math.max(...seg.map((p) => p.speed ?? 0)))} km/h)`}
          </Tooltip>
        </Polyline>
      ))}
      {first && <Marker position={[first.latitude, first.longitude]} icon={endpointIcon('A', '#16a34a')} />}
      {last && last !== first && (
        <Marker position={[last.latitude, last.longitude]} icon={endpointIcon('B', '#dc2626')} />
      )}
      <RouteFit route={route} />
    </>
  );
}

function RouteFit({ route }: { route: FleetRoute }) {
  const map = useMap();
  useEffect(() => {
    if (route.points.length === 0) return;
    const bounds = L.latLngBounds(route.points.map((p) => [p.latitude, p.longitude]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    // Refita quando o percurso consultado muda (veículo/período).
  }, [route.vehicleId, route.from, route.to]);
  return null;
}

/** Quebra o percurso em trechos separados por paradas > ROUTE_GAP_MIN min. */
function splitTrechos(points: RoutePoint[]): RoutePoint[][] {
  const out: RoutePoint[][] = [];
  let current: RoutePoint[] = [];
  let prevTime: number | null = null;
  for (const p of points) {
    const t = new Date(p.deviceTime).getTime();
    if (prevTime != null && t - prevTime > ROUTE_GAP_MIN * 60 * 1000 && current.length > 1) {
      out.push(current);
      current = [];
    }
    current.push(p);
    prevTime = t;
  }
  if (current.length > 1) out.push(current);
  return out;
}

/** Sequências consecutivas acima do limite (pra desenhar o excesso em vermelho). */
function speedingRuns(points: RoutePoint[], limit: number): RoutePoint[][] {
  const out: RoutePoint[][] = [];
  let run: RoutePoint[] = [];
  for (const p of points) {
    if ((p.speed ?? 0) > limit) {
      run.push(p);
    } else {
      if (run.length > 1) out.push(run);
      run = [];
    }
  }
  if (run.length > 1) out.push(run);
  return out;
}

function endpointIcon(label: string, color: string): L.DivIcon {
  return L.divIcon({
    html: `<div style="width:22px;height:22px;border-radius:9999px;background:${color};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4);color:white;font:700 12px/18px sans-serif;text-align:center;">${label}</div>`,
    className: 'netx-route-endpoint',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Posições ao vivo
// ─────────────────────────────────────────────────────────────────────────────

function FitBounds({
  positions,
  initialCenter,
  hasRoute,
}: {
  positions: LivePosition[];
  initialCenter: [number, number];
  hasRoute: boolean;
}) {
  const map = useMap();
  useEffect(() => {
    if (hasRoute) return; // com histórico na tela, quem manda é o RouteFit
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
  }, [positions.map((p) => p.vehicleId).sort().join(','), hasRoute]);
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
        {point.ignition != null ? ` · ignição ${point.ignition ? 'ligada' : 'desligada'}` : ''}
      </div>
      {point.driverName && <div style={{ fontSize: 12, marginTop: 4 }}><strong>Motorista:</strong> {point.driverName}</div>}
      {point.address && <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{point.address}</div>}
      <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
        Atualizado: {new Date(point.deviceTime).toLocaleString('pt-BR')}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Ícones dos veículos
// ─────────────────────────────────────────────────────────────────────────────

/** Silhuetas (vista lateral, 44×26). Cores fixas por tipo — não seguem tema. */
const VEHICLE_SVG: Record<VehicleMapIcon, string> = {
  RED_CAR: `
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="24" viewBox="0 0 44 26">
      <path d="M4 17c0-3.4 1.8-4.6 5-5.4l4-5.1C14.2 5 15.8 4.5 18 4.5h9c3 0 5 1 7 3.5l2.5 3c3.5.7 5.5 2 5.5 5v2c0 1-.8 1.6-2 1.6H6c-1.4 0-2-.7-2-2.6Z" fill="#dc2626" stroke="#7f1d1d" stroke-width="1"/>
      <path d="M15 6.5h10.5l3.6 4.3H12z" fill="#dbeafe" stroke="#7f1d1d" stroke-width="0.6"/>
      <circle cx="13" cy="19.5" r="4.2" fill="#111827"/><circle cx="13" cy="19.5" r="1.8" fill="#9ca3af"/>
      <circle cx="33" cy="19.5" r="4.2" fill="#111827"/><circle cx="33" cy="19.5" r="1.8" fill="#9ca3af"/>
    </svg>`,
  LADDER_CAR: `
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="24" viewBox="0 0 44 26">
      <rect x="9" y="1.5" width="27" height="1.6" rx="0.8" fill="#6b7280"/>
      <rect x="9" y="5" width="27" height="1.6" rx="0.8" fill="#6b7280"/>
      <rect x="13" y="1.5" width="1.4" height="5" fill="#6b7280"/>
      <rect x="20" y="1.5" width="1.4" height="5" fill="#6b7280"/>
      <rect x="27" y="1.5" width="1.4" height="5" fill="#6b7280"/>
      <rect x="33" y="1.5" width="1.4" height="5" fill="#6b7280"/>
      <path d="M4 18c0-3 1.8-4.2 5-5l4-4.6c1.2-1.3 2.8-1.9 5-1.9h9c3 0 5 1 7 3.3l2.5 2.7c3.5.7 5.5 1.9 5.5 4.5v1.6c0 1-.8 1.6-2 1.6H6c-1.4 0-2-.6-2-2.2Z" fill="#f8fafc" stroke="#475569" stroke-width="1"/>
      <path d="M15 8h10.5l3.4 3.8H12z" fill="#bfdbfe" stroke="#475569" stroke-width="0.6"/>
      <circle cx="13" cy="20" r="4" fill="#111827"/><circle cx="13" cy="20" r="1.7" fill="#9ca3af"/>
      <circle cx="33" cy="20" r="4" fill="#111827"/><circle cx="33" cy="20" r="1.7" fill="#9ca3af"/>
    </svg>`,
  WHITE_VAN: `
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="24" viewBox="0 0 44 26">
      <path d="M4 19V8c0-1.8 1-2.8 3-2.8h21c2 0 3 .5 4.4 2.4l4.6 1.2c3 .8 5 2.2 5 4.8V19c0 .8-.7 1.4-1.8 1.4H5.6C4.6 20.4 4 19.9 4 19Z" fill="#f8fafc" stroke="#475569" stroke-width="1"/>
      <path d="M29.5 7.2l3.4 3.4h-5.4V7.2z" fill="#bfdbfe" stroke="#475569" stroke-width="0.6"/>
      <rect x="8" y="7.6" width="7" height="4" rx="0.8" fill="#bfdbfe" stroke="#475569" stroke-width="0.6"/>
      <rect x="17.5" y="7.6" width="7" height="4" rx="0.8" fill="#bfdbfe" stroke="#475569" stroke-width="0.6"/>
      <circle cx="12" cy="20" r="4" fill="#111827"/><circle cx="12" cy="20" r="1.7" fill="#9ca3af"/>
      <circle cx="34" cy="20" r="4" fill="#111827"/><circle cx="34" cy="20" r="1.7" fill="#9ca3af"/>
    </svg>`,
  TRUCK: `
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="24" viewBox="0 0 44 26">
      <rect x="2.5" y="4" width="24.5" height="14.5" rx="1" fill="#e5e7eb" stroke="#475569" stroke-width="1"/>
      <path d="M27 18.5V8.5h6c2 0 3 .8 4.4 3l3 .9c1.4.4 1.8 1.3 1.8 2.7v3.4c0 .7-.6 1.2-1.6 1.2H27Z" fill="#2563eb" stroke="#1e3a8a" stroke-width="1"/>
      <path d="M29 10h4l2.6 3.2H29z" fill="#bfdbfe" stroke="#1e3a8a" stroke-width="0.6"/>
      <circle cx="10" cy="20" r="4" fill="#111827"/><circle cx="10" cy="20" r="1.7" fill="#9ca3af"/>
      <circle cx="20" cy="20" r="4" fill="#111827"/><circle cx="20" cy="20" r="1.7" fill="#9ca3af"/>
      <circle cx="34.5" cy="20" r="4" fill="#111827"/><circle cx="34.5" cy="20" r="1.7" fill="#9ca3af"/>
    </svg>`,
};

function iconFor(p: LivePosition, selected: boolean): L.DivIcon {
  const dotColor = DOT_COLOR[p.dot];
  const rotate = p.status === 'MOVING' && p.course != null ? p.course : null;
  // Seta apontando pra direção (course) quando em movimento.
  const arrow =
    rotate != null
      ? `<div style="position:absolute;top:-12px;left:50%;transform:translateX(-50%) rotate(${rotate}deg);transform-origin:50% 24px;">
           <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:8px solid #2563eb;"></div>
         </div>`
      : '';
  const ring = selected
    ? 'outline:3px solid rgba(37,99,235,0.55);outline-offset:2px;border-radius:8px;'
    : '';
  const html = `
    <div style="position:relative;width:40px;height:24px;${ring}">
      ${arrow}
      <div style="filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.45));">${VEHICLE_SVG[p.mapIcon] ?? VEHICLE_SVG.RED_CAR}</div>
      <div style="position:absolute;top:-5px;right:-5px;width:11px;height:11px;border-radius:9999px;background:${dotColor};border:2px solid white;box-shadow:0 0 2px rgba(0,0,0,.5);"></div>
    </div>
  `.trim();
  return L.divIcon({
    html,
    className: 'netx-fleet-marker',
    iconSize: [40, 24],
    iconAnchor: [20, 12],
    popupAnchor: [0, -14],
    tooltipAnchor: [0, -2],
  });
}

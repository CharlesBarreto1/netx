'use client';

/**
 * LocationPicker — mini-mapa pra fixar coordenadas de um contrato.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Interações:
 *   - Click no mapa → coloca pino (ou move o existente)
 *   - Drag do pino → reposiciona
 *   - Botão "Usar minha localização" → Geolocation API
 *   - Botão "Limpar" → remove pino (value vira null)
 *
 * Carrega Leaflet CSS dinamicamente (Next.js client-only). Pra render
 * server-side, faça `dynamic(() => import(...), { ssr: false })` no caller.
 */
import { useEffect, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

import 'leaflet/dist/leaflet.css';

import { Button } from '@/components/ui/Button';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface LocationPickerProps {
  value: LatLng | null;
  onChange: (value: LatLng | null) => void;
  /** Centro default quando não há `value`. Default = Asunción. */
  defaultCenter?: [number, number];
  /** Altura CSS. Default 320px. */
  height?: string;
}

const DEFAULT_CENTER: [number, number] = [-25.2637, -57.5759];

export function LocationPicker({
  value,
  onChange,
  defaultCenter = DEFAULT_CENTER,
  height = '320px',
}: LocationPickerProps) {
  const [requestingGeo, setRequestingGeo] = useState(false);
  const center: [number, number] = value
    ? [value.latitude, value.longitude]
    : defaultCenter;

  function useMyLocation() {
    if (!('geolocation' in navigator)) {
      alert('Geolocation não suportada neste navegador');
      return;
    }
    setRequestingGeo(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange({
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
        });
        setRequestingGeo(false);
      },
      (err) => {
        alert(`Falha ao obter localização: ${err.message}`);
        setRequestingGeo(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <div className="space-y-2">
      <div style={{ height, width: '100%' }} className="rounded-md overflow-hidden border border-border">
        <MapContainer
          center={center}
          zoom={15}
          scrollWheelZoom
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; OpenStreetMap'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
          <ClickHandler onPick={onChange} />
          <RecenterOnValueChange value={value} />
          {value && (
            <Marker
              position={[value.latitude, value.longitude]}
              icon={pickerIcon()}
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const m = e.target as L.Marker;
                  const pos = m.getLatLng();
                  onChange({
                    latitude: Number(pos.lat.toFixed(6)),
                    longitude: Number(pos.lng.toFixed(6)),
                  });
                },
              }}
            />
          )}
        </MapContainer>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="text-text-muted">
          {value ? (
            <>
              <strong className="text-text">
                {value.latitude.toFixed(6)}, {value.longitude.toFixed(6)}
              </strong>
              <span className="ml-2">Click no mapa ou arraste o pino pra ajustar.</span>
            </>
          ) : (
            <span>Click no mapa pra fixar a localização do cliente.</span>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={useMyLocation}
            disabled={requestingGeo}
          >
            {requestingGeo ? 'Obtendo…' : 'Usar minha localização'}
          </Button>
          {value && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onChange(null)}
            >
              Limpar
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ClickHandler({ onPick }: { onPick: (v: LatLng) => void }) {
  useMapEvents({
    click: (e) => {
      onPick({
        latitude: Number(e.latlng.lat.toFixed(6)),
        longitude: Number(e.latlng.lng.toFixed(6)),
      });
    },
  });
  return null;
}

/** Recentraliza o mapa quando o `value` vem de fora (ex.: "Usar minha localização"). */
function RecenterOnValueChange({ value }: { value: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (value) {
      map.setView([value.latitude, value.longitude], Math.max(map.getZoom(), 15));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.latitude, value?.longitude]);
  return null;
}

function pickerIcon(): L.DivIcon {
  // Ícone arrastável — destaque visual maior que o do CustomerMap.
  const html = `
    <svg width="32" height="42" viewBox="0 0 32 42" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 0 C7.16 0 0 7.16 0 16 c0 12 16 26 16 26 s16 -14 16 -26 C32 7.16 24.84 0 16 0 z"
            fill="#2563eb" stroke="#1e3a8a" stroke-width="1.5"/>
      <circle cx="16" cy="15" r="6" fill="white"/>
    </svg>
  `.trim();
  return L.divIcon({
    html,
    className: 'netx-map-picker',
    iconSize: [32, 42],
    iconAnchor: [16, 42],
  });
}

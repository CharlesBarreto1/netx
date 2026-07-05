'use client';

/**
 * FibermapMap — mapa MapLibre GL do Estúdio FiberMap (Tela 1 · FM-1).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Responsabilidades:
 *   - Raster OSM inline (sem style JSON de CDN) + glyphs pros symbol layers.
 *   - Source GeoJSON clusterizada `fibermap-elements`; refetch por viewport
 *     (moveend/zoomend com debounce de 300 ms → GET /elements?bbox=...).
 *   - Círculos coloridos por tipo (cor injetada como property no client —
 *     evita expression `match` e mantém a paleta num lugar só: constants.ts).
 *   - Popup nativo em ponto unclustered (nome/tipo/produto + Detalhe/Excluir);
 *     clique em cluster expande (getClusterExpansionZoom).
 *
 * IMPORTANTE: client-only. Importar via next/dynamic com ssr:false (mesmo
 * padrão do NetworkMap Leaflet). Como next/dynamic NÃO repassa refs, o pai
 * entrega um objeto-ref (`handleRef`) que este componente preenche com a API
 * imperativa (flyTo/refresh/setHighlight) quando o mapa carrega.
 */
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import type {
  GeoJSONSource,
  Map as MaplibreMap,
  MapLayerMouseEvent,
  Popup,
  StyleSpecification,
} from 'maplibre-gl';

import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  fibermapApi,
  type FibermapElementFeatureProperties,
  type FibermapElementType,
} from '@/lib/fibermap-api';

import { ELEMENT_TYPE_COLOR, type StudioView } from './constants';

// ─── Tipos públicos ──────────────────────────────────────────────────────────
export interface FibermapMapHandle {
  flyTo: (longitude: number, latitude: number, zoom?: number) => void;
  /** Refaz o fetch do viewport atual (após criar/editar/excluir elemento). */
  refresh: () => void;
  /** Anel de destaque (busca/seleção). null limpa. */
  setHighlight: (point: { latitude: number; longitude: number } | null) => void;
}

export type FibermapMapMode = 'select' | 'pick';

/** Strings traduzidas — o popup é DOM imperativo, sem acesso a hooks. */
export interface FibermapMapLabels {
  detail: string;
  remove: string;
  loadError: string;
  typeLabels: Record<FibermapElementType, string>;
}

export interface FibermapMapProps {
  /** Preenchido no load do mapa; next/dynamic não repassa ref de verdade. */
  handleRef: { current: FibermapMapHandle | null };
  initialView: StudioView;
  /** 'pick' = próximo clique vira coordenada (add/reposicionar) — crosshair. */
  mode: FibermapMapMode;
  /** Filtro de tipos ([] = todos). */
  types: FibermapElementType[];
  folderId?: string;
  canDelete: boolean;
  labels: FibermapMapLabels;
  onViewChange: (view: StudioView) => void;
  onData: (info: { count: number; truncated: boolean }) => void;
  onPick: (point: { latitude: number; longitude: number }) => void;
  onOpenDetail: (elementId: string) => void;
  onRequestDelete: (element: { id: string; name: string }) => void;
}

// ─── Style / constantes ──────────────────────────────────────────────────────
const SOURCE_ID = 'fibermap-elements';
const HIGHLIGHT_SOURCE_ID = 'fibermap-highlight';

const OSM_RASTER_STYLE: StyleSpecification = {
  version: 8,
  // glyphs é obrigatório pra symbol layers com texto (contagem de cluster e
  // labels de elemento). Servidor de fontes público do próprio MapLibre.
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

export function FibermapMap({
  handleRef,
  initialView,
  mode,
  types,
  folderId,
  canDelete,
  labels,
  onViewChange,
  onData,
  onPick,
  onOpenDetail,
  onRequestDelete,
}: FibermapMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);

  // Snapshot do primeiro render — o viewport depois vive no próprio mapa.
  const initialViewRef = useRef(initialView);

  // Callbacks/props voláteis em refs: os handlers do MapLibre são registrados
  // uma única vez (mount) e leem sempre a versão mais recente.
  const modeRef = useRef<FibermapMapMode>(mode);
  const paramsRef = useRef<{ types: FibermapElementType[]; folderId?: string }>({
    types,
    folderId,
  });
  const canDeleteRef = useRef(canDelete);
  const labelsRef = useRef(labels);
  const cbRef = useRef({
    onViewChange,
    onData,
    onPick,
    onOpenDetail,
    onRequestDelete,
  });
  useEffect(() => {
    cbRef.current = { onViewChange, onData, onPick, onOpenDetail, onRequestDelete };
    labelsRef.current = labels;
    canDeleteRef.current = canDelete;
  });

  const scheduleFetchRef = useRef<(() => void) | null>(null);

  // ── Ciclo de vida do mapa (uma vez) ────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      style: OSM_RASTER_STYLE,
      center: [initialViewRef.current.longitude, initialViewRef.current.latitude],
      zoom: initialViewRef.current.zoom,
    });
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      'top-right',
    );

    let disposed = false;
    let fetchSeq = 0;
    let fetchErrored = false;
    let debounceTimer: number | undefined;

    async function fetchViewport(): Promise<void> {
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      if (!source) return; // style ainda carregando — o load faz o 1º fetch
      const bounds = map.getBounds();
      const seq = ++fetchSeq;
      try {
        const { types: t, folderId: fid } = paramsRef.current;
        const fc = await fibermapApi.listElements({
          bbox: [
            bounds.getWest(),
            bounds.getSouth(),
            bounds.getEast(),
            bounds.getNorth(),
          ],
          types: t.length ? t : undefined,
          folderId: fid,
        });
        if (disposed || seq !== fetchSeq) return; // resposta velha — descarta
        // Injeta a cor por tipo como property (paint usa ['get','color']).
        const collection = {
          type: 'FeatureCollection' as const,
          features: fc.features.map((f) => ({
            type: 'Feature' as const,
            geometry: f.geometry,
            properties: {
              ...f.properties,
              color: ELEMENT_TYPE_COLOR[f.properties.type],
            },
          })),
        };
        source.setData(collection);
        fetchErrored = false;
        cbRef.current.onData({
          count: fc.features.length,
          truncated: fc.truncated,
        });
      } catch (err) {
        if (disposed || seq !== fetchSeq) return;
        // Toast único por sequência de falhas — pan contínuo não vira spam.
        if (!fetchErrored) {
          fetchErrored = true;
          toast.error(
            err instanceof ApiError
              ? err.friendlyMessage
              : labelsRef.current.loadError,
          );
        }
      }
    }

    function scheduleFetch() {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        void fetchViewport();
      }, 300);
    }
    scheduleFetchRef.current = scheduleFetch;

    // Popup imperativo (o MapLibre popup vive fora da árvore React).
    // Cores fixas de propósito: o cartão do popup é sempre branco sobre
    // tiles OSM claros, em light e dark.
    function buildPopupContent(
      props: FibermapElementFeatureProperties,
    ): HTMLElement {
      const l = labelsRef.current;
      const root = document.createElement('div');
      root.className = 'flex min-w-[190px] flex-col gap-2 p-1 font-sans';

      const header = document.createElement('div');
      header.className = 'flex items-center gap-1.5';
      const dot = document.createElement('span');
      dot.className = 'inline-block h-2.5 w-2.5 shrink-0 rounded-full';
      dot.style.backgroundColor = ELEMENT_TYPE_COLOR[props.type];
      const name = document.createElement('span');
      name.className = 'truncate text-sm font-semibold text-slate-900';
      name.textContent = props.name;
      header.append(dot, name);

      const meta = document.createElement('div');
      meta.className = 'text-xs text-slate-500';
      meta.textContent = props.productName
        ? `${l.typeLabels[props.type]} · ${props.productName}`
        : l.typeLabels[props.type];

      const actions = document.createElement('div');
      actions.className = 'flex gap-1.5 pt-0.5';
      const detailBtn = document.createElement('button');
      detailBtn.type = 'button';
      detailBtn.className =
        'rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700';
      detailBtn.textContent = l.detail;
      detailBtn.addEventListener('click', () => {
        popupRef.current?.remove();
        cbRef.current.onOpenDetail(props.id);
      });
      actions.append(detailBtn);
      if (canDeleteRef.current) {
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className =
          'rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50';
        deleteBtn.textContent = l.remove;
        deleteBtn.addEventListener('click', () => {
          popupRef.current?.remove();
          cbRef.current.onRequestDelete({ id: props.id, name: props.name });
        });
        actions.append(deleteBtn);
      }

      root.append(header, meta, actions);
      return root;
    }

    map.on('load', () => {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterRadius: 50,
        clusterMaxZoom: 14,
      });
      map.addSource(HIGHLIGHT_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Anel de destaque por baixo dos pontos.
      map.addLayer({
        id: 'fibermap-highlight-ring',
        type: 'circle',
        source: HIGHLIGHT_SOURCE_ID,
        paint: {
          'circle-radius': 16,
          'circle-color': '#f59e0b',
          'circle-opacity': 0.2,
          'circle-stroke-color': '#f59e0b',
          'circle-stroke-width': 2,
        },
      });
      map.addLayer({
        id: 'fibermap-clusters',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#2563eb',
          'circle-opacity': 0.85,
          'circle-radius': ['step', ['get', 'point_count'], 14, 25, 18, 100, 24],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
        },
      });
      map.addLayer({
        id: 'fibermap-cluster-count',
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Open Sans Semibold'],
          'text-size': 12,
        },
        paint: { 'text-color': '#ffffff' },
      });
      map.addLayer({
        id: 'fibermap-points',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': 6,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
        },
      });
      map.addLayer({
        id: 'fibermap-labels',
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        minzoom: 16,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Semibold'],
          'text-size': 11,
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: {
          'text-color': '#334155',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.2,
        },
      });

      // ── Interações ────────────────────────────────────────────────────────
      // Clique em cluster → zoom de expansão.
      map.on('click', 'fibermap-clusters', (e: MapLayerMouseEvent) => {
        if (modeRef.current !== 'select') return;
        const feature = e.features?.[0];
        if (!feature || feature.geometry.type !== 'Point') return;
        const clusterId = (feature.properties as { cluster_id?: number })
          .cluster_id;
        if (clusterId === undefined) return;
        const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
        if (!source) return;
        const [lng, lat] = feature.geometry.coordinates;
        void source
          .getClusterExpansionZoom(clusterId)
          .then((zoom) => {
            map.easeTo({ center: [lng, lat], zoom });
          })
          .catch(() => undefined);
      });

      // Clique em ponto → popup com ações.
      map.on('click', 'fibermap-points', (e: MapLayerMouseEvent) => {
        if (modeRef.current !== 'select') return;
        const feature = e.features?.[0];
        if (!feature || feature.geometry.type !== 'Point') return;
        const props =
          feature.properties as unknown as FibermapElementFeatureProperties;
        const [lng, lat] = feature.geometry.coordinates;
        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({
          closeButton: true,
          closeOnClick: true,
          maxWidth: '300px',
          offset: 10,
        })
          .setLngLat([lng, lat])
          .setDOMContent(buildPopupContent(props))
          .addTo(map);
      });

      // Clique "cru" no mapa em modo pick → coordenada pro pai.
      map.on('click', (e) => {
        if (modeRef.current !== 'pick') return;
        cbRef.current.onPick({
          latitude: e.lngLat.lat,
          longitude: e.lngLat.lng,
        });
      });

      // Cursor pointer sobre features clicáveis (só no modo select).
      for (const layerId of ['fibermap-clusters', 'fibermap-points']) {
        map.on('mouseenter', layerId, () => {
          if (modeRef.current === 'select') {
            map.getCanvas().style.cursor = 'pointer';
          }
        });
        map.on('mouseleave', layerId, () => {
          if (modeRef.current === 'select') {
            map.getCanvas().style.cursor = '';
          }
        });
      }

      // API imperativa pro estúdio.
      handleRef.current = {
        flyTo: (longitude, latitude, zoom) => {
          map.flyTo({
            center: [longitude, latitude],
            zoom: zoom ?? Math.max(map.getZoom(), 16),
          });
        },
        refresh: () => {
          void fetchViewport();
        },
        setHighlight: (point) => {
          const src = map.getSource(HIGHLIGHT_SOURCE_ID) as
            | GeoJSONSource
            | undefined;
          if (!src) return;
          if (!point) {
            src.setData({ type: 'FeatureCollection', features: [] });
            return;
          }
          src.setData({
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [point.longitude, point.latitude],
            },
            properties: {},
          });
        },
      };

      void fetchViewport();
    });

    // moveend cobre pan e zoom; zoomend fica de cinto de segurança.
    map.on('moveend', () => {
      const c = map.getCenter();
      cbRef.current.onViewChange({
        latitude: c.lat,
        longitude: c.lng,
        zoom: map.getZoom(),
      });
      scheduleFetch();
    });
    map.on('zoomend', scheduleFetch);

    return () => {
      disposed = true;
      window.clearTimeout(debounceTimer);
      scheduleFetchRef.current = null;
      handleRef.current = null;
      popupRef.current?.remove();
      popupRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [handleRef]);

  // ── Modo (cursor crosshair + fecha popup) ──────────────────────────────────
  useEffect(() => {
    modeRef.current = mode;
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = mode === 'pick' ? 'crosshair' : '';
    if (mode === 'pick') popupRef.current?.remove();
  }, [mode]);

  // ── Filtros (tipos/pasta) → refetch ────────────────────────────────────────
  useEffect(() => {
    paramsRef.current = { types, folderId };
    scheduleFetchRef.current?.();
  }, [types, folderId]);

  return <div ref={containerRef} className="h-full w-full" />;
}

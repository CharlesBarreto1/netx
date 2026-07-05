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

export type FibermapMapMode = 'select' | 'pick' | 'draw';

/** Strings traduzidas — o popup é DOM imperativo, sem acesso a hooks. */
export interface FibermapMapLabels {
  detail: string;
  remove: string;
  loadError: string;
  /** Botão do popup: abre o editor de emendas (FM-3, spec §7). */
  accessPoint: string;
  /** Aviso do modo desenho: o 1º clique precisa cair num elemento. */
  drawStartOnElement: string;
  typeLabels: Record<FibermapElementType, string>;
}

/** Resultado do desenho de um trecho de cabo (FM-2). */
export interface FibermapDrawResult {
  fromElement: { id: string; name: string };
  toElement: { id: string; name: string };
  /** Vértices completos [{lat,lng}], pontas já nas coords dos elementos. */
  path: Array<{ latitude: number; longitude: number }>;
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
  /** Trecho desenhado completo (modo draw) — o pai abre o modal do cabo. */
  onDrawComplete: (result: FibermapDrawResult) => void;
  /** Clique em [Detalhe] no popup de um segmento de cabo. */
  onOpenCable: (cableId: string) => void;
  /** Clique em [Ponto de acesso] no popup do elemento (FM-3). */
  onOpenAccessPoint: (elementId: string) => void;
}

// ─── Style / constantes ──────────────────────────────────────────────────────
const SOURCE_ID = 'fibermap-elements';
const HIGHLIGHT_SOURCE_ID = 'fibermap-highlight';
const CABLES_SOURCE_ID = 'fibermap-cables';
const DRAW_SOURCE_ID = 'fibermap-draw';
/** Raio de snap do desenho em pixels (≈15 m nos zooms de trabalho, spec §7). */
const SNAP_PX = 12;

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
  onDrawComplete,
  onOpenCable,
  onOpenAccessPoint,
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
    onDrawComplete,
    onOpenCable,
    onOpenAccessPoint,
  });
  useEffect(() => {
    cbRef.current = {
      onViewChange,
      onData,
      onPick,
      onOpenDetail,
      onRequestDelete,
      onDrawComplete,
      onOpenCable,
      onOpenAccessPoint,
    };
    labelsRef.current = labels;
    canDeleteRef.current = canDelete;
  });

  // Estado do desenho de cabo (modo draw) — vive fora do React de propósito:
  // muda a cada clique e só o preview (source GeoJSON) precisa reagir.
  const drawRef = useRef<{
    start: { id: string; name: string } | null;
    /** [lng, lat] — mesmo eixo do MapLibre. */
    vertices: [number, number][];
  }>({ start: null, vertices: [] });

  const scheduleFetchRef = useRef<(() => void) | null>(null);
  // Preenchidos no load do mapa (precisam do source/listeners vivos).
  const resetDrawRef = useRef<(() => void) | null>(null);
  const drawKeyCleanupRef = useRef<(() => void) | null>(null);

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
      const cableSource = map.getSource(CABLES_SOURCE_ID) as
        | GeoJSONSource
        | undefined;
      if (!source || !cableSource) return; // style carregando — o load refaz
      const bounds = map.getBounds();
      const bbox: [number, number, number, number] = [
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
      ];
      const seq = ++fetchSeq;
      try {
        const { types: t, folderId: fid } = paramsRef.current;
        const [fc, cables] = await Promise.all([
          fibermapApi.listElements({
            bbox,
            types: t.length ? t : undefined,
            folderId: fid,
          }),
          fibermapApi.listCables({ bbox, folderId: fid }),
        ]);
        if (disposed || seq !== fetchSeq) return; // resposta velha — descarta
        // Injeta a cor por tipo como property (paint usa ['get','color']).
        source.setData({
          type: 'FeatureCollection' as const,
          features: fc.features.map((f) => ({
            type: 'Feature' as const,
            geometry: f.geometry,
            properties: {
              ...f.properties,
              color: ELEMENT_TYPE_COLOR[f.properties.type],
            },
          })),
        });
        cableSource.setData(cables as never);
        fetchErrored = false;
        cbRef.current.onData({
          count: fc.features.length,
          truncated: fc.truncated || cables.truncated,
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
      actions.className = 'flex flex-wrap gap-1.5 pt-0.5';
      // [Abrir ponto de acesso] — vista lógica de emendas (spec §7/FM-3).
      const apBtn = document.createElement('button');
      apBtn.type = 'button';
      apBtn.className =
        'rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700';
      apBtn.textContent = l.accessPoint;
      apBtn.addEventListener('click', () => {
        popupRef.current?.remove();
        cbRef.current.onOpenAccessPoint(props.id);
      });
      actions.append(apBtn);
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
      map.addSource(CABLES_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource(DRAW_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Cabos por baixo dos elementos (linhas coloridas por display_color).
      map.addLayer({
        id: 'fibermap-cable-lines',
        type: 'line',
        source: CABLES_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'displayColor'],
          'line-width': 3,
          'line-opacity': 0.9,
        },
      });
      // Alvo de clique generoso (invisível) — linha de 3px é difícil de acertar.
      map.addLayer({
        id: 'fibermap-cable-hit',
        type: 'line',
        source: CABLES_SOURCE_ID,
        paint: { 'line-color': '#000000', 'line-opacity': 0, 'line-width': 14 },
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

      // Preview do desenho de cabo (linha tracejada + vértices).
      map.addLayer({
        id: 'fibermap-draw-line',
        type: 'line',
        source: DRAW_SOURCE_ID,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: {
          'line-color': '#f59e0b',
          'line-width': 3,
          'line-dasharray': [2, 1.5],
        },
      });
      map.addLayer({
        id: 'fibermap-draw-vertices',
        type: 'circle',
        source: DRAW_SOURCE_ID,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 4,
          'circle-color': '#f59e0b',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
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

      // Clique em segmento de cabo → popup (só no select; camada de hit larga).
      map.on('click', 'fibermap-cable-hit', (e: MapLayerMouseEvent) => {
        if (modeRef.current !== 'select') return;
        const feature = e.features?.[0];
        if (!feature) return;
        const p = feature.properties as unknown as {
          cableId: string;
          cableName: string;
          seq: number;
          fiberCount: number;
          displayColor: string;
          geometricLengthM: number;
          opticalLengthM: number;
        };
        const l = labelsRef.current;
        const root = document.createElement('div');
        root.className = 'flex min-w-[190px] flex-col gap-2 p-1 font-sans';
        const header = document.createElement('div');
        header.className = 'flex items-center gap-1.5';
        const swatch = document.createElement('span');
        swatch.className = 'inline-block h-2.5 w-5 shrink-0 rounded-sm';
        swatch.style.backgroundColor = p.displayColor;
        const name = document.createElement('span');
        name.className = 'truncate text-sm font-semibold text-slate-900';
        name.textContent = p.cableName;
        header.append(swatch, name);
        const meta = document.createElement('div');
        meta.className = 'text-xs text-slate-500';
        meta.textContent = `${p.fiberCount} FO · #${p.seq} · ${Math.round(p.geometricLengthM)} m (geo) · ${Math.round(p.opticalLengthM)} m (ópt)`;
        const actions = document.createElement('div');
        actions.className = 'flex gap-1.5 pt-0.5';
        const detailBtn = document.createElement('button');
        detailBtn.type = 'button';
        detailBtn.className =
          'rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700';
        detailBtn.textContent = l.detail;
        detailBtn.addEventListener('click', () => {
          popupRef.current?.remove();
          cbRef.current.onOpenCable(p.cableId);
        });
        actions.append(detailBtn);
        root.append(header, meta, actions);
        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({
          closeButton: true,
          closeOnClick: true,
          maxWidth: '320px',
          offset: 8,
        })
          .setLngLat(e.lngLat)
          .setDOMContent(root)
          .addTo(map);
      });

      // ── Desenho de cabo (FM-2) ────────────────────────────────────────────
      function syncDrawPreview() {
        const src = map.getSource(DRAW_SOURCE_ID) as GeoJSONSource | undefined;
        if (!src) return;
        const { vertices } = drawRef.current;
        const features: GeoJSON.Feature[] = vertices.map((v) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: v },
          properties: {},
        }));
        if (vertices.length >= 2) {
          features.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: vertices },
            properties: {},
          });
        }
        src.setData({ type: 'FeatureCollection', features });
      }
      resetDrawRef.current = () => {
        drawRef.current = { start: null, vertices: [] };
        syncDrawPreview();
      };

      /** Elemento sob o clique (raio SNAP_PX) — snapping do desenho. */
      function elementAt(point: { x: number; y: number }) {
        const hits = map.queryRenderedFeatures(
          [
            [point.x - SNAP_PX, point.y - SNAP_PX],
            [point.x + SNAP_PX, point.y + SNAP_PX],
          ],
          { layers: ['fibermap-points'] },
        );
        const f = hits[0];
        if (!f || f.geometry.type !== 'Point') return null;
        const props = f.properties as unknown as FibermapElementFeatureProperties;
        return {
          id: props.id,
          name: props.name,
          coord: f.geometry.coordinates as [number, number],
        };
      }

      // Clique "cru" no mapa: pick (add/reposicionar) ou desenho de cabo.
      map.on('click', (e) => {
        if (modeRef.current === 'pick') {
          cbRef.current.onPick({
            latitude: e.lngLat.lat,
            longitude: e.lngLat.lng,
          });
          return;
        }
        if (modeRef.current !== 'draw') return;

        const hit = elementAt(e.point);
        const d = drawRef.current;
        if (!d.start) {
          if (!hit) {
            toast.info(labelsRef.current.drawStartOnElement);
            return;
          }
          d.start = { id: hit.id, name: hit.name };
          d.vertices = [hit.coord];
          syncDrawPreview();
          return;
        }
        if (hit && hit.id !== d.start.id) {
          // Fecha o trecho no elemento de destino.
          const path = [...d.vertices, hit.coord].map(([lng, lat]) => ({
            latitude: lat,
            longitude: lng,
          }));
          const result = {
            fromElement: d.start,
            toElement: { id: hit.id, name: hit.name },
            path,
          };
          resetDrawRef.current?.();
          cbRef.current.onDrawComplete(result);
          return;
        }
        // Vértice intermediário (ou clique de novo no início — vira vértice).
        d.vertices.push([e.lngLat.lng, e.lngLat.lat]);
        syncDrawPreview();
      });

      // Backspace desfaz o último vértice do desenho (spec §7 — undo).
      function handleDrawKey(e: KeyboardEvent) {
        if (modeRef.current !== 'draw') return;
        if (e.key !== 'Backspace') return;
        const d = drawRef.current;
        if (!d.start) return;
        e.preventDefault();
        if (d.vertices.length <= 1) {
          resetDrawRef.current?.();
          return;
        }
        d.vertices.pop();
        syncDrawPreview();
      }
      window.addEventListener('keydown', handleDrawKey);
      drawKeyCleanupRef.current = () =>
        window.removeEventListener('keydown', handleDrawKey);

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
      drawKeyCleanupRef.current?.();
      drawKeyCleanupRef.current = null;
      resetDrawRef.current = null;
      scheduleFetchRef.current = null;
      handleRef.current = null;
      popupRef.current?.remove();
      popupRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [handleRef]);

  // ── Modo (cursor crosshair + fecha popup + limpa desenho) ──────────────────
  useEffect(() => {
    modeRef.current = mode;
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor =
      mode === 'pick' || mode === 'draw' ? 'crosshair' : '';
    if (mode !== 'select') popupRef.current?.remove();
    if (mode !== 'draw') resetDrawRef.current?.();
  }, [mode]);

  // ── Filtros (tipos/pasta) → refetch ────────────────────────────────────────
  useEffect(() => {
    paramsRef.current = { types, folderId };
    scheduleFetchRef.current?.();
  }, [types, folderId]);

  return <div ref={containerRef} className="h-full w-full" />;
}

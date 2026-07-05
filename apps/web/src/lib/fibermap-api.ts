/**
 * Cliente tipado pro módulo FiberMap (OSP v2 — FIBERMAP-SPEC.md).
 * Backend: apps/core-service/src/modules/fibermap/* (rotas /v1/fibermap/*).
 *
 * Tipos replicados de @netx/shared (o web não importa o pacote direto —
 * convenção do repo). Manter em sincronia com packages/shared/src/fibermap.
 */
import { api } from './api';

// ─── Domínio ────────────────────────────────────────────────────────────────
export type FibermapElementType =
  | 'POP'
  | 'CABINET'
  | 'CEO'
  | 'CTO'
  | 'POLE'
  | 'SLACK_COIL'
  | 'CUSTOMER_PREMISE';

export type FibermapProductType =
  | 'CABLE'
  | 'SPLICE_CLOSURE'
  | 'TERMINATION_BOX'
  | 'DIO'
  | 'CABINET'
  | 'INDOOR_RACK'
  | 'SPLITTER';

export type FibermapColorStandard = 'ABNT' | 'EIA598';
export type FibermapTubeScheme =
  | 'STANDARD_CYCLE'
  | 'PILOT_DIRECTIONAL'
  | 'CUSTOM';

/** Códigos estáveis de cor (persistidos) — render via FIBERMAP_COLOR_HEX. */
export type FibermapColorCode =
  | 'VERDE'
  | 'AMARELA'
  | 'BRANCA'
  | 'AZUL'
  | 'VERMELHA'
  | 'VIOLETA'
  | 'MARROM'
  | 'ROSA'
  | 'PRETA'
  | 'CINZA'
  | 'LARANJA'
  | 'AGUA_MARINHA';

export const FIBERMAP_COLOR_HEX: Record<FibermapColorCode, string> = {
  VERDE: '#16a34a',
  AMARELA: '#eab308',
  BRANCA: '#f8fafc',
  AZUL: '#2563eb',
  VERMELHA: '#dc2626',
  VIOLETA: '#7c3aed',
  MARROM: '#92400e',
  ROSA: '#ec4899',
  PRETA: '#171717',
  CINZA: '#6b7280',
  LARANJA: '#ea580c',
  AGUA_MARINHA: '#2dd4bf',
};

export const FIBERMAP_COLOR_LABELS_PT: Record<FibermapColorCode, string> = {
  VERDE: 'Verde',
  AMARELA: 'Amarela',
  BRANCA: 'Branca',
  AZUL: 'Azul',
  VERMELHA: 'Vermelha',
  VIOLETA: 'Violeta',
  MARROM: 'Marrom',
  ROSA: 'Rosa',
  PRETA: 'Preta',
  CINZA: 'Cinza',
  LARANJA: 'Laranja',
  AGUA_MARINHA: 'Água-marinha',
};

/** Ciclos de 12 cores — mesmos de @netx/shared/fibermap/colors (fonte lá). */
export const ABNT_COLOR_CYCLE: FibermapColorCode[] = [
  'VERDE', 'AMARELA', 'BRANCA', 'AZUL', 'VERMELHA', 'VIOLETA',
  'MARROM', 'ROSA', 'PRETA', 'CINZA', 'LARANJA', 'AGUA_MARINHA',
];
export const EIA598_COLOR_CYCLE: FibermapColorCode[] = [
  'AZUL', 'LARANJA', 'VERDE', 'MARROM', 'CINZA', 'BRANCA',
  'VERMELHA', 'PRETA', 'AMARELA', 'VIOLETA', 'ROSA', 'AGUA_MARINHA',
];

export function fibermapColorCycle(std: FibermapColorStandard): FibermapColorCode[] {
  return std === 'ABNT' ? ABNT_COLOR_CYCLE : EIA598_COLOR_CYCLE;
}

/** Preview de cores de tubo — mesmo algoritmo do backend (spec §2). */
export function previewTubeColors(
  scheme: FibermapTubeScheme,
  standard: FibermapColorStandard,
  tubeCount: number,
  customColors?: FibermapColorCode[],
): FibermapColorCode[] {
  if (scheme === 'CUSTOM') {
    return Array.from(
      { length: tubeCount },
      (_, i) => customColors?.[i] ?? 'BRANCA',
    );
  }
  if (scheme === 'PILOT_DIRECTIONAL') {
    return Array.from({ length: tubeCount }, (_, i) =>
      i === 0 ? 'VERDE' : i === 1 ? 'AMARELA' : 'BRANCA',
    );
  }
  const cycle = fibermapColorCycle(standard);
  return Array.from({ length: tubeCount }, (_, i) => cycle[i % cycle.length]);
}

// ─── Pastas ─────────────────────────────────────────────────────────────────
export interface FibermapFolder {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  elementsCount?: number;
  cablesCount?: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Elementos ──────────────────────────────────────────────────────────────
export interface FibermapElementFeatureProperties {
  id: string;
  type: FibermapElementType;
  name: string;
  folderId: string;
  productId: string | null;
  productName: string | null;
  photosCount: number;
  devicesCount: number;
}

export interface FibermapElementsFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: FibermapElementFeatureProperties;
  }>;
  truncated: boolean;
}

export interface FibermapElementSearchHit {
  id: string;
  type: FibermapElementType;
  name: string;
  latitude: number;
  longitude: number;
  folderId: string;
}

export interface FibermapElementPhoto {
  id: string;
  fileName: string | null;
  caption: string | null;
  takenAt: string | null;
  createdAt: string;
}

export interface FibermapElement {
  id: string;
  folderId: string;
  type: FibermapElementType;
  productId: string | null;
  product: {
    id: string;
    name: string;
    manufacturer: string;
    specs: Record<string, unknown>;
  } | null;
  name: string;
  latitude: number;
  longitude: number;
  address: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  photos: FibermapElementPhoto[];
  devicesCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFibermapElementDto {
  folderId: string;
  type: FibermapElementType;
  productId?: string | null;
  name: string;
  latitude: number;
  longitude: number;
  address?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
}

export type UpdateFibermapElementDto = Partial<CreateFibermapElementDto> & {
  type?: never; // tipo é imutável após criação
};

// ─── Catálogo ───────────────────────────────────────────────────────────────
export interface FibermapCableModel {
  fiberCount: number;
  tubeCount: number;
  fibersPerTube: number;
  colorStandard: FibermapColorStandard;
  tubeScheme: FibermapTubeScheme;
  excessFactor: number;
  cableClass: string | null;
  tubes: Array<{ tubeNumber: number; color: string }>;
}

export interface FibermapProduct {
  id: string;
  type: FibermapProductType;
  manufacturer: string;
  name: string;
  description: string | null;
  specs: Record<string, unknown>;
  isActive: boolean;
  instancesCount?: number;
  cableModel?: FibermapCableModel | null;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface ListFibermapProductsParams {
  type?: FibermapProductType;
  q?: string;
  active?: 'true' | 'false' | 'all';
  page?: number;
  pageSize?: number;
}

export interface CreateFibermapProductDto {
  type: Exclude<FibermapProductType, 'CABLE'>;
  manufacturer?: string;
  name: string;
  description?: string | null;
  specs?: Record<string, unknown>;
}

export interface CreateFibermapCableModelDto {
  manufacturer?: string;
  name: string;
  description?: string | null;
  fiberCount: number;
  tubeCount: number;
  fibersPerTube: number;
  colorStandard: FibermapColorStandard;
  tubeScheme: FibermapTubeScheme;
  customTubeColors?: FibermapColorCode[];
  excessFactor?: number;
  cableClass?: string | null;
}

// ─── Cabos / segmentos / reservas (FM-2) ────────────────────────────────────
export interface FibermapPathPoint {
  latitude: number;
  longitude: number;
}

export interface FibermapSegmentFeatureProperties {
  segmentId: string;
  cableId: string;
  cableName: string;
  seq: number;
  displayColor: string;
  fiberCount: number;
  geometricLengthM: number;
  measuredLengthM: number | null;
  opticalLengthM: number;
}

export interface FibermapCablesFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    properties: FibermapSegmentFeatureProperties;
  }>;
  truncated: boolean;
}

export interface FibermapSlack {
  id: string;
  elementId: string;
  elementName: string;
  segmentId: string;
  lengthM: number;
  createdAt: string;
}

export interface FibermapSegment {
  id: string;
  seq: number;
  fromElementId: string;
  fromElementName: string;
  toElementId: string;
  toElementName: string;
  path: FibermapPathPoint[];
  geometricLengthM: number;
  measuredLengthM: number | null;
  opticalLengthM: number;
  slacks: FibermapSlack[];
}

export interface FibermapCable {
  id: string;
  folderId: string;
  name: string;
  productId: string | null;
  productName: string | null;
  fiberCount: number;
  tubeCount: number;
  fibersPerTube: number;
  colorStandard: FibermapColorStandard;
  excessFactor: number;
  displayColor: string | null;
  notes: string | null;
  tubes: Array<{ tubeNumber: number; color: string }>;
  segments: FibermapSegment[];
  occupancy: {
    total: number;
    dark: number;
    active: number;
    reserved: number;
    broken: number;
  };
  totalGeometricM: number;
  totalOpticalM: number;
  totalSlackM: number;
  createdAt: string;
  updatedAt: string;
}

export interface FibermapCableStub {
  id: string;
  name: string;
  fiberCount: number;
  displayColor: string | null;
  tailElementId: string | null;
  segmentsCount: number;
}

export interface FibermapFolderContents {
  elements: Array<{
    id: string;
    type: FibermapElementType;
    name: string;
    latitude: number;
    longitude: number;
  }>;
  cables: Array<{
    id: string;
    name: string;
    fiberCount: number;
    displayColor: string | null;
  }>;
}

// ─── Ponto de acesso / grafo lógico (FM-3) ──────────────────────────────────
export type FibermapEndSide = 'A' | 'B' | 'U' | 'D';

export interface FibermapEndpointRef {
  type: 'FIBER_END' | 'PORT';
  fiberId?: string;
  side?: FibermapEndSide;
  cutId?: string;
  portId?: string;
}

export interface FibermapApFiberEnd {
  side: FibermapEndSide;
  cutId: string | null;
  state: 'FREE' | 'CONNECTED';
  connectionId: string | null;
}

export interface FibermapApFiber {
  id: string;
  fiberNumber: number;
  tubeNumber: number;
  color: string;
  status: 'DARK' | 'ACTIVE' | 'RESERVED' | 'BROKEN';
  state: 'FREE' | 'CONNECTED' | 'EXPRESS';
  ends: FibermapApFiberEnd[];
}

export interface FibermapApCable {
  id: string;
  name: string;
  displayColor: string | null;
  fiberCount: number;
  colorStandard: FibermapColorStandard;
  relation: 'STARTS' | 'ENDS' | 'PASSES' | 'LOOP';
  tubes: Array<{ tubeNumber: number; color: string }>;
  fibers: FibermapApFiber[];
}

export interface FibermapApPort {
  id: string;
  role: 'IN' | 'OUT' | 'BIDI';
  portNumber: number;
  label: string | null;
  faces: { C: string | null; F: string | null };
}

export interface FibermapApDevice {
  id: string;
  type: 'SPLITTER' | 'DIO' | 'OLT' | 'ONU_SHELF' | 'RACK';
  name: string;
  metadata: Record<string, unknown>;
  ports: FibermapApPort[];
}

export interface FibermapApConnectionSide {
  type: 'FIBER_END' | 'PORT';
  fiberId?: string;
  side?: FibermapEndSide;
  cutId?: string;
  portId?: string;
  cableName?: string;
  fiberNumber?: number;
  fiberColor?: string;
  deviceName?: string;
  portLabel?: string;
}

export interface FibermapApConnection {
  id: string;
  kind: 'FUSION' | 'CONNECTOR' | 'SPLITTER_PATH';
  lossDb: number | null;
  notes: string | null;
  a: FibermapApConnectionSide;
  b: FibermapApConnectionSide;
}

export interface FibermapAccessPoint {
  element: { id: string; name: string; type: string };
  cables: FibermapApCable[];
  devices: FibermapApDevice[];
  connections: FibermapApConnection[];
  defaultFusionLossDb: number;
  defaultConnectorLossDb: number;
}

// ─── Atenuação ──────────────────────────────────────────────────────────────
export type FibermapAttenuationKey =
  | 'FIBER_1310' | 'FIBER_1490' | 'FIBER_1550'
  | 'FUSION' | 'CONNECTOR_PAIR'
  | 'SPLITTER_1_2' | 'SPLITTER_1_4' | 'SPLITTER_1_8'
  | 'SPLITTER_1_16' | 'SPLITTER_1_32' | 'SPLITTER_1_64'
  | 'UNBALANCED_10_TAP' | 'UNBALANCED_10_PASS'
  | 'UNBALANCED_20_TAP' | 'UNBALANCED_20_PASS'
  | 'UNBALANCED_30_TAP' | 'UNBALANCED_30_PASS'
  | 'UNBALANCED_50_TAP' | 'UNBALANCED_50_PASS';

export interface FibermapAttenuation {
  values: Record<FibermapAttenuationKey, number>;
  overridden: FibermapAttenuationKey[];
}

// ─── Client ─────────────────────────────────────────────────────────────────
function qs(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export const fibermapApi = {
  // Pastas
  listFolders: () => api.get<FibermapFolder[]>('/v1/fibermap/folders'),
  createFolder: (dto: { name: string; parentId?: string | null; sortOrder?: number }) =>
    api.post<FibermapFolder>('/v1/fibermap/folders', dto),
  updateFolder: (
    id: string,
    dto: { name?: string; parentId?: string | null; sortOrder?: number },
  ) => api.patch<FibermapFolder>(`/v1/fibermap/folders/${id}`, dto),
  deleteFolder: (id: string) => api.delete<void>(`/v1/fibermap/folders/${id}`),
  folderContents: (id: string) =>
    api.get<FibermapFolderContents>(`/v1/fibermap/folders/${id}/contents`),

  // Elementos (mapa)
  listElements: (params: {
    bbox: [number, number, number, number];
    types?: FibermapElementType[];
    folderId?: string;
    limit?: number;
  }) =>
    api.get<FibermapElementsFeatureCollection>(
      `/v1/fibermap/elements${qs({
        bbox: params.bbox.join(','),
        types: params.types?.length ? params.types.join(',') : undefined,
        folderId: params.folderId,
        limit: params.limit,
      })}`,
    ),
  searchElements: (q: string, limit = 12) =>
    api.get<FibermapElementSearchHit[]>(
      `/v1/fibermap/elements/search${qs({ q, limit })}`,
    ),
  getElement: (id: string) => api.get<FibermapElement>(`/v1/fibermap/elements/${id}`),
  createElement: (dto: CreateFibermapElementDto) =>
    api.post<FibermapElement>('/v1/fibermap/elements', dto),
  updateElement: (id: string, dto: UpdateFibermapElementDto) =>
    api.patch<FibermapElement>(`/v1/fibermap/elements/${id}`, dto),
  deleteElement: (id: string) => api.delete<void>(`/v1/fibermap/elements/${id}`),

  // Fotos (2 passos: presign → PUT direto no MinIO → register)
  presignPhoto: (elementId: string, dto: { fileName: string; contentType: string }) =>
    api.post<{ uploadUrl: string; storageKey: string; expiresIn: number }>(
      `/v1/fibermap/elements/${elementId}/photos/presign`,
      dto,
    ),
  registerPhoto: (
    elementId: string,
    dto: { storageKey: string; fileName?: string; caption?: string },
  ) =>
    api.post<FibermapElementPhoto>(`/v1/fibermap/elements/${elementId}/photos`, dto),
  photoDownloadUrl: (elementId: string, photoId: string) =>
    api.get<{ downloadUrl: string; expiresIn: number }>(
      `/v1/fibermap/elements/${elementId}/photos/${photoId}/download`,
    ),
  deletePhoto: (elementId: string, photoId: string) =>
    api.delete<void>(`/v1/fibermap/elements/${elementId}/photos/${photoId}`),

  // Cabos / segmentos / reservas (FM-2)
  listCables: (params: {
    bbox: [number, number, number, number];
    folderId?: string;
    limit?: number;
  }) =>
    api.get<FibermapCablesFeatureCollection>(
      `/v1/fibermap/cables${qs({
        bbox: params.bbox.join(','),
        folderId: params.folderId,
        limit: params.limit,
      })}`,
    ),
  getCable: (id: string) => api.get<FibermapCable>(`/v1/fibermap/cables/${id}`),
  cablesEndingAt: (elementId: string) =>
    api.get<FibermapCableStub[]>(`/v1/fibermap/cables/ending-at/${elementId}`),
  createCable: (dto: {
    folderId: string;
    name: string;
    productId: string;
    displayColor?: string | null;
    notes?: string | null;
  }) => api.post<FibermapCable>('/v1/fibermap/cables', dto),
  updateCable: (
    id: string,
    dto: {
      folderId?: string;
      name?: string;
      displayColor?: string | null;
      notes?: string | null;
      excessFactor?: number;
    },
  ) => api.patch<FibermapCable>(`/v1/fibermap/cables/${id}`, dto),
  deleteCable: (id: string) => api.delete<void>(`/v1/fibermap/cables/${id}`),
  addSegment: (
    cableId: string,
    dto: {
      fromElementId: string;
      toElementId: string;
      path: FibermapPathPoint[];
      measuredLengthM?: number | null;
    },
  ) => api.post<FibermapCable>(`/v1/fibermap/cables/${cableId}/segments`, dto),
  updateSegment: (
    segmentId: string,
    dto: { path?: FibermapPathPoint[]; measuredLengthM?: number | null },
  ) => api.patch<FibermapCable>(`/v1/fibermap/segments/${segmentId}`, dto),
  deleteSegment: (segmentId: string) =>
    api.delete<FibermapCable>(`/v1/fibermap/segments/${segmentId}`),
  addSlack: (
    cableId: string,
    dto: { elementId: string; segmentId: string; lengthM: number },
  ) => api.post<FibermapCable>(`/v1/fibermap/cables/${cableId}/slacks`, dto),
  deleteSlack: (slackId: string) =>
    api.delete<FibermapCable>(`/v1/fibermap/slacks/${slackId}`),

  // Ponto de acesso / grafo lógico (FM-3)
  accessPoint: (elementId: string) =>
    api.get<FibermapAccessPoint>(`/v1/fibermap/elements/${elementId}/access-point`),
  createConnection: (dto: {
    elementId: string;
    kind: 'FUSION' | 'CONNECTOR';
    a: FibermapEndpointRef;
    b: FibermapEndpointRef;
    lossDb?: number | null;
    notes?: string | null;
  }) => api.post<{ id: string }>('/v1/fibermap/connections', dto),
  bulkFuse: (dto: {
    elementId: string;
    aCableId: string;
    aStartFiber: number;
    bCableId: string;
    bStartFiber: number;
    count: number;
  }) =>
    api.post<{ created: number; skipped: Array<{ aFiber: number; bFiber: number; reason: string }> }>(
      '/v1/fibermap/connections/bulk-fuse',
      dto,
    ),
  updateConnection: (id: string, dto: { lossDb?: number | null; notes?: string | null }) =>
    api.patch<void>(`/v1/fibermap/connections/${id}`, dto),
  deleteConnection: (id: string) => api.delete<void>(`/v1/fibermap/connections/${id}`),
  cutFiber: (fiberId: string, elementId: string) =>
    api.post<{ id: string }>(`/v1/fibermap/fibers/${fiberId}/cut`, { elementId }),
  deleteCut: (cutId: string) => api.delete<void>(`/v1/fibermap/cuts/${cutId}`),
  createDevice: (
    elementId: string,
    dto: {
      type: 'SPLITTER' | 'DIO' | 'OLT';
      name: string;
      ratio?: '1x2' | '1x4' | '1x8' | '1x16' | '1x32' | '1x64';
      topology?: 'BALANCED' | 'UNBALANCED';
      tapPercent?: number;
      portsCount?: number;
    },
  ) => api.post<{ id: string }>(`/v1/fibermap/elements/${elementId}/devices`, dto),
  updateDevice: (id: string, dto: { name?: string }) =>
    api.patch<void>(`/v1/fibermap/devices/${id}`, dto),
  deleteDevice: (id: string) => api.delete<void>(`/v1/fibermap/devices/${id}`),

  // Catálogo
  listProducts: (params: ListFibermapProductsParams = {}) =>
    api.get<Paginated<FibermapProduct>>(
      `/v1/fibermap/catalog/products${qs(params as Record<string, string | number | undefined>)}`,
    ),
  getProduct: (id: string) =>
    api.get<FibermapProduct>(`/v1/fibermap/catalog/products/${id}`),
  createProduct: (dto: CreateFibermapProductDto) =>
    api.post<FibermapProduct>('/v1/fibermap/catalog/products', dto),
  createCableModel: (dto: CreateFibermapCableModelDto) =>
    api.post<FibermapProduct>('/v1/fibermap/catalog/cable-models', dto),
  updateProduct: (
    id: string,
    dto: Partial<Omit<CreateFibermapProductDto, 'type'>>,
  ) => api.patch<FibermapProduct>(`/v1/fibermap/catalog/products/${id}`, dto),
  deactivateProduct: (id: string) =>
    api.post<FibermapProduct>(`/v1/fibermap/catalog/products/${id}/deactivate`, {}),
  activateProduct: (id: string) =>
    api.post<FibermapProduct>(`/v1/fibermap/catalog/products/${id}/activate`, {}),
  deleteProduct: (id: string) =>
    api.delete<void>(`/v1/fibermap/catalog/products/${id}`),

  // Parâmetros
  getAttenuation: () =>
    api.get<FibermapAttenuation>('/v1/fibermap/settings/attenuation-defaults'),
  patchAttenuation: (values: Partial<Record<FibermapAttenuationKey, number>>) =>
    api.patch<FibermapAttenuation>('/v1/fibermap/settings/attenuation-defaults', {
      values,
    }),
};

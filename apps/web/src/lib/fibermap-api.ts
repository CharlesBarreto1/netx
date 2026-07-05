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

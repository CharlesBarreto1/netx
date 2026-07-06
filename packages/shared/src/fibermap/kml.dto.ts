/**
 * FiberMap — DTOs do import/export KML (FM-7, spec §12).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Objetivo prático: migrar a base exportada do Tomodat. Fluxo preview/commit
 * SÍNCRONO (decisão nº7 — sem BullMQ, mesmo padrão do optical/kml.service):
 *   1. POST /import/kml/preview (multipart + folderId) → o que SERIA criado,
 *      com colisões de nome e a resolução das pontas dos cabos;
 *   2. POST /import/kml/confirm → cria por item (transação por item), snap
 *      das pontas em elementos ≤ 25 m ou POLE automático (spec §12);
 *   3. GET /export/kml?folderId= → KML 2.2 (Google Earth), elementos como
 *      Placemark/Point com `netx-type` em ExtendedData (round-trip fiel) e
 *      segmentos como LineString na cor do cabo.
 */
import { z } from 'zod';

export const FIBERMAP_KML_IMPORT_TYPES = ['POP', 'CEO', 'CTO', 'POLE'] as const;
export type FibermapKmlImportType = (typeof FIBERMAP_KML_IMPORT_TYPES)[number];

// =============================================================================
// Export
// =============================================================================
export const FibermapKmlExportQuerySchema = z.object({
  /** Limita a uma pasta; omitido = planta inteira do tenant. */
  folderId: z.string().uuid().optional(),
});
export type FibermapKmlExportQuery = z.infer<typeof FibermapKmlExportQuerySchema>;

/** JSON em vez de attachment: o client baixa via Blob (auth por header). */
export interface FibermapKmlExportResponse {
  fileName: string;
  kml: string;
  elements: number;
  cables: number;
}

// =============================================================================
// Import — preview
// =============================================================================
export const FibermapKmlPreviewQuerySchema = z.object({
  /** Pasta destino — colisões de nome são avaliadas contra ela. */
  folderId: z.string().uuid(),
});
export type FibermapKmlPreviewQuery = z.infer<typeof FibermapKmlPreviewQuerySchema>;

export interface FibermapKmlImportElementPreview {
  name: string;
  /** Inferido pelo nome (CTO/CEO/POP, senão POLE) ou netx-type do arquivo. */
  type: FibermapKmlImportType;
  latitude: number;
  longitude: number;
  description: string | null;
  status: 'CREATE' | 'SKIP';
  reason: string | null;
}

export interface FibermapKmlImportCablePreview {
  name: string;
  vertices: number;
  lengthMeters: number;
  description: string | null;
  /** Resolução best-effort das pontas ('CPN-011' ou null = poste novo). */
  fromElementName: string | null;
  toElementName: string | null;
  status: 'CREATE' | 'SKIP';
  reason: string | null;
  /** Ecoado pro confirm. */
  path: Array<{ latitude: number; longitude: number }>;
}

export interface FibermapKmlImportPreview {
  folderId: string;
  elements: FibermapKmlImportElementPreview[];
  cables: FibermapKmlImportCablePreview[];
  warnings: string[];
}

// =============================================================================
// Import — confirm
// =============================================================================
const KmlPathPointSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

export const ConfirmFibermapKmlImportRequestSchema = z.object({
  folderId: z.string().uuid(),
  elements: z
    .array(
      z.object({
        name: z.string().min(1).max(160),
        type: z.enum(FIBERMAP_KML_IMPORT_TYPES),
        latitude: z.coerce.number().min(-90).max(90),
        longitude: z.coerce.number().min(-180).max(180),
        description: z.string().max(2000).nullish(),
      }),
    )
    .max(20_000),
  cables: z
    .array(
      z.object({
        name: z.string().min(1).max(160),
        path: z.array(KmlPathPointSchema).min(2).max(2000),
        description: z.string().max(2000).nullish(),
      }),
    )
    .max(5_000),
});
export type ConfirmFibermapKmlImportRequest = z.infer<
  typeof ConfirmFibermapKmlImportRequestSchema
>;

export interface FibermapKmlImportResult {
  elementsCreated: number;
  /** POLEs criados automaticamente nas pontas sem elemento ≤ 25 m. */
  polesCreated: number;
  cablesCreated: number;
  skipped: Array<{ item: string; reason: string }>;
}

/**
 * DTOs do import/export KML/KMZ (R4.5d OSP).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Doc: docs/architecture/osp-network.md
 *
 * KML é o formato XML do Google Earth — projetistas de FTTH normalmente
 * desenham a planta lá ou no QGIS, exportam .kml/.kmz e entregam pro ISP.
 * O NetX importa esse arquivo direto, evitando re-digitação.
 *
 * Mapeamento heurístico:
 *   <Placemark><Point>      → OpticalEnclosure (type=CTO, capacity=16 default)
 *   <Placemark><LineString> → FiberCable (type=DISTRIBUTION, fiberCount=12 default)
 *   <name>                  → code
 *   <description>           → notes
 *   <styleUrl>              → ignorado em v1
 *
 * Operador pode editar tudo depois — o objetivo do import é só popular
 * a planta com geometrias já validadas em campo.
 */
import { z } from 'zod';

import { FiberCableTypeSchema } from './fiber.dto';
import { OpticalEnclosureTypeSchema } from './optical.dto';

// =============================================================================
// Import — Request
// =============================================================================
/**
 * Preview do que SERIA criado, retornado pelo parse antes do commit.
 * Frontend mostra esta lista e operador confirma.
 */
export interface KmlImportPreview {
  enclosures: Array<{
    name: string;
    latitude: number;
    longitude: number;
    description?: string;
  }>;
  cables: Array<{
    name: string;
    fiberCount: number;
    path: Array<{ latitude: number; longitude: number }>;
    lengthMeters: number;
    description?: string;
  }>;
  /** Warnings que não impedem o import mas avisam o operador. */
  warnings: string[];
}

export const ConfirmKmlImportRequestSchema = z.object({
  preview: z.object({
    enclosures: z.array(
      z.object({
        name: z.string().min(1).max(120),
        latitude: z.coerce.number().min(-90).max(90),
        longitude: z.coerce.number().min(-180).max(180),
        description: z.string().optional(),
      }),
    ),
    cables: z.array(
      z.object({
        name: z.string().min(1).max(120),
        fiberCount: z.coerce.number().int().min(1).max(432),
        path: z.array(
          z.object({
            latitude: z.coerce.number().min(-90).max(90),
            longitude: z.coerce.number().min(-180).max(180),
          }),
        ).min(2),
        lengthMeters: z.coerce.number().min(0),
        description: z.string().optional(),
      }),
    ),
    warnings: z.array(z.string()),
  }),
  /**
   * Defaults aplicados a TODOS os itens importados. Operador pode editar
   * cada um depois individualmente.
   */
  defaults: z.object({
    enclosureType: OpticalEnclosureTypeSchema.default('CTO'),
    enclosureCapacity: z.coerce.number().int().min(1).max(256).default(16),
    cableType: FiberCableTypeSchema.default('DISTRIBUTION'),
    cableFiberCount: z.coerce.number().int().min(1).max(432).default(12),
  }),
});
export type ConfirmKmlImportRequest = z.infer<
  typeof ConfirmKmlImportRequestSchema
>;

export interface KmlImportResult {
  enclosuresCreated: number;
  cablesCreated: number;
  errors: string[];
  /** Lote do import — passe pra desfazer o import inteiro. Null se nada criado. */
  importBatchId: string | null;
}

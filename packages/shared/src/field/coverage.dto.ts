import { z } from 'zod';

/**
 * Consulta de cobertura (NetX Field / nova venda): dado um ponto (lat/lng),
 * existe CTO com porta livre por perto? Leitura pura sobre o FiberMap (OSP
 * v2: FibermapElement type=CTO + portas OUT de splitter). Busca por raio via
 * PostGIS (ST_DWithin/KNN no geom do elemento).
 */
export const CoverageCheckQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  /** Raio de busca em metros (default 500m, teto 5km). */
  radiusMeters: z.coerce.number().int().min(50).max(5000).default(500),
  /** Só devolve caixas com porta livre (default true). */
  onlyWithFreePort: z.coerce.boolean().default(true),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type CoverageCheckQuery = z.infer<typeof CoverageCheckQuerySchema>;

export interface CoverageEnclosure {
  id: string;
  code: string;
  type: 'CTO' | 'NAP' | 'SPLITTER' | 'EMENDA' | 'RESERVA';
  latitude: number;
  longitude: number;
  /** Distância do ponto consultado, em metros (PostGIS geography). */
  distanceMeters: number;
  /** No FiberMap = total de portas OUT (igual a portsTotal; compat de shape). */
  capacity: number;
  portsTotal: number;
  portsFree: number;
  hasFreePort: boolean;
}

export interface CoverageCheckResponse {
  query: { latitude: number; longitude: number; radiusMeters: number };
  /** Caixas dentro do raio, ordenadas por distância. */
  enclosures: CoverageEnclosure[];
  /** true se há ao menos uma CTO com porta livre no raio. */
  covered: boolean;
}

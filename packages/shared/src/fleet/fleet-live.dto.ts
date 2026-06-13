import { z } from 'zod';

import type { VehicleMapIcon } from './vehicle.dto';

/**
 * Aba "Ao vivo" — posições em tempo real dos veículos com rastreador, vindas do
 * Traccar (self-hosted) e filtradas por tenant no backend. O frontend faz
 * polling via SWR no endpoint de posições.
 */

/**
 * Estado do veículo no mapa:
 *  - MOVING:  reportou velocidade acima do limiar parado.
 *  - STOPPED: parado, mas reportou recentemente.
 *  - OFFLINE: sem report dentro da janela considerada online.
 */
export const LiveVehicleStatusSchema = z.enum([
  'MOVING',
  'STOPPED',
  'OFFLINE',
]);
export type LiveVehicleStatus = z.infer<typeof LiveVehicleStatusSchema>;

/**
 * Bolinha de status ao lado do ícone do veículo (semântica de ignição):
 *  - ON:    ignição ligada (verde).
 *  - IDLE:  ignição ligada, mas parado há mais de 2 min (amarelo).
 *  - OFF:   ignição desligada (cinza).
 *  - STALE: sem sincronizar há mais de 4 h (vermelho).
 * Rastreador sem informação de ignição (ACC): deriva de movimento —
 * andando = ON, parado = OFF.
 */
export const LiveDotStatusSchema = z.enum(['ON', 'IDLE', 'OFF', 'STALE']);
export type LiveDotStatus = z.infer<typeof LiveDotStatusSchema>;

export interface LivePositionResponse {
  vehicleId: string;
  plate: string;
  label: string; // marca + modelo, ou a placa se faltar
  trackerUniqueId: string | null;
  latitude: number;
  longitude: number;
  speed: number | null; // km/h
  course: number | null; // heading em graus
  address: string | null;
  /** Horário reportado pelo rastreador (ISO 8601). */
  deviceTime: string;
  /** Quando o NetX recebeu/gravou (ISO 8601). */
  serverTime: string;
  status: LiveVehicleStatus;
  /** Bolinha de status (ignição/atividade) ao lado do ícone. */
  dot: LiveDotStatus;
  /** Ignição (ACC) reportada pelo rastreador; null = sem essa informação. */
  ignition: boolean | null;
  mapIcon: VehicleMapIcon;
  driverName: string | null;
}

export interface FleetLiveResponse {
  positions: LivePositionResponse[];
  /** ISO 8601 — momento em que o backend montou a resposta. */
  generatedAt: string;
  /** Quantos veículos com rastreador o tenant tem (mesmo sem posição ainda). */
  trackedVehicles: number;
  /** false quando o Traccar não está configurado (env ausente) — a UI avisa. */
  traccarConfigured: boolean;
}

// --- Histórico de percurso ---------------------------------------------------

/** Janela máxima de histórico por consulta (proteção contra payload gigante). */
export const FLEET_ROUTE_MAX_RANGE_DAYS = 7;

export const FleetRouteQuerySchema = z
  .object({
    /** Início do período (ISO 8601). */
    from: z.coerce.date(),
    /** Fim do período (ISO 8601). */
    to: z.coerce.date(),
  })
  .refine((q) => q.to > q.from, { message: 'to deve ser maior que from' })
  .refine(
    (q) =>
      q.to.getTime() - q.from.getTime() <=
      FLEET_ROUTE_MAX_RANGE_DAYS * 24 * 60 * 60 * 1000,
    { message: `Período máximo de ${FLEET_ROUTE_MAX_RANGE_DAYS} dias` },
  );
export type FleetRouteQuery = z.infer<typeof FleetRouteQuerySchema>;

export interface RoutePointResponse {
  latitude: number;
  longitude: number;
  speed: number | null; // km/h
  course: number | null;
  /** Ignição (ACC) no momento do ponto; null = sem essa informação. */
  ignition: boolean | null;
  /** Horário reportado pelo rastreador (ISO 8601). */
  deviceTime: string;
}

export interface FleetRouteResponse {
  vehicleId: string;
  plate: string;
  from: string;
  to: string;
  /** Pontos em ordem cronológica. */
  points: RoutePointResponse[];
  /** true quando o Traccar devolveu mais pontos do que o teto e houve corte. */
  truncated: boolean;
}

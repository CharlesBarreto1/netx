import { z } from 'zod';

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

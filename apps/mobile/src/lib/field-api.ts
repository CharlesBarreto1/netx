/**
 * Client das rotas Field (BFF read-only): Assinante 360 + cobertura.
 * `silentUnauthorized` evita deslogar caso o backend ainda não tenha o endpoint.
 */
import { api } from './api';
import type { CoverageCheckResponse, Subscriber360Response } from '@netx/shared';

/** Assinante 360 — agregado ERP+CPE+óptica+RADIUS numa chamada. */
export function getSubscriber360(customerId: string, signal?: AbortSignal) {
  return api<Subscriber360Response>(`/field/subscriber360/${customerId}`, {
    silentUnauthorized: true,
    signal,
  });
}

/** Cobertura: existe CTO com porta livre perto deste ponto? */
export function coverageCheck(
  q: { latitude: number; longitude: number; radiusMeters?: number },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    latitude: String(q.latitude),
    longitude: String(q.longitude),
  });
  if (q.radiusMeters) params.set('radiusMeters', String(q.radiusMeters));
  return api<CoverageCheckResponse>(`/field/coverage?${params.toString()}`, {
    silentUnauthorized: true,
    signal,
  });
}

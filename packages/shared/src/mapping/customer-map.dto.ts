/**
 * DTOs do módulo Mapeamento — tela de clientes no mapa (Leaflet).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Payload minimalista pra otimizar transferência: 5k contratos ≈ 300KB JSON
 * cru (~30KB gzip). Sem campos pesados (notes, audit, etc) — quem quer
 * detalhe clica no pino e abre /contracts/[id].
 */
import { z } from 'zod';

import { ContractStatusSchema } from '../contracts/contract.dto';

export const ListCustomerMapQuerySchema = z.object({
  /** Status a incluir. Default = todos exceto CANCELLED. CSV: "ACTIVE,SUSPENDED". */
  status: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean)
        : undefined,
    )
    .pipe(z.array(ContractStatusSchema).optional()),
  /** Filtra só clientes online (sessão RADIUS ativa). */
  onlineOnly: z.coerce.boolean().optional(),
  /** Filtra por plano específico (UUID). */
  planId: z.string().uuid().optional(),
});
export type ListCustomerMapQuery = z.infer<typeof ListCustomerMapQuerySchema>;

/**
 * Ponto retornado pra cada contrato georreferenciado. O frontend usa pra
 * desenhar o pino e mostrar o popup. Mantenha enxuto.
 */
export interface CustomerMapPoint {
  id: string;
  /** Código humano do contrato (CTR-001234) ou null. */
  code: string | null;
  customerId: string;
  customerName: string;
  latitude: number;
  longitude: number;
  status: 'PENDING_INSTALL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  /**
   * Sessão RADIUS ativa? Determinado por radacct.acctstoptime IS NULL
   * com identificador do contrato (PPPoE username, circuitId ou MAC).
   * Sempre false pra contratos não-ACTIVE.
   */
  online: boolean;
  /** Identificador efetivo (pra debug — username PPPoE ou circuitId/MAC). */
  radiusIdentifier: string | null;
  planName: string | null;
  monthlyValue: number;
  /** Endereço textual pra popup quando coord pode estar imprecisa. */
  installationAddress: string;
}

export interface CustomerMapResponse {
  points: CustomerMapPoint[];
  /** Stats prontos pra header do mapa — evita o front recontar. */
  stats: {
    total: number;
    online: number;
    offline: number;
    suspended: number;
    pendingInstall: number;
    cancelled: number;
  };
}

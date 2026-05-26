/**
 * DTOs do módulo Mapeamento — tela de rede física (POPs + Equipamentos + OLTs).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Unifica os 3 tipos de equipamento georreferenciado num único endpoint pra
 * o front desenhar o mapa de Rede sem fazer 3 requests separados. Cada ponto
 * carrega `kind` que o renderizador usa pra escolher o ícone/cor.
 *
 * Não inclui clientes (esses ficam em /v1/mapping/customers) — separação
 * intencional: técnico em campo geralmente quer ver UMA camada por vez.
 */
import { z } from 'zod';

export const ListNetworkMapQuerySchema = z.object({
  /** Inclui POPs. Default true. */
  includePops: z.coerce.boolean().optional().default(true),
  /** Inclui Equipamentos (BNG/Router/Switch — não OLT, ver flag separada). Default true. */
  includeEquipment: z.coerce.boolean().optional().default(true),
  /** Inclui OLTs do módulo Provisioning (modelo rico, separado de network_equipment). Default true. */
  includeOlts: z.coerce.boolean().optional().default(true),
  /** Inclui caixas ópticas (CTO/NAP/Splitter/Emenda — R2). Default true. */
  includeEnclosures: z.coerce.boolean().optional().default(true),
});
export type ListNetworkMapQuery = z.infer<typeof ListNetworkMapQuerySchema>;

/**
 * Discriminator pra renderização: cada `kind` mapeia pra um ícone/cor no
 * frontend (ver `mapping/network/page.tsx`).
 */
export type NetworkMapPointKind =
  | 'POP'
  | 'BNG'
  | 'OLT'
  | 'ROUTER'
  | 'SWITCH'
  | 'OTHER'
  | 'CTO'
  | 'NAP'
  | 'SPLITTER'
  | 'EMENDA';

export interface NetworkMapPoint {
  id: string;
  kind: NetworkMapPointKind;
  /** Nome humano: "POP-Centro", "BNG-MK-01", "OLT MA5800", "CTO-001". */
  name: string;
  /** Código curto (NetworkPop.code, OpticalEnclosure.code) ou null. */
  code: string | null;
  latitude: number;
  longitude: number;
  /** POP associado (só pra equipment com popId). */
  popId: string | null;
  /** Status técnico — usado pra cor extra. POP/Equipment usam `isActive`; OLT usa enum próprio. */
  isActive: boolean;
  /** Detalhe adicional pra popup: vendor (Mikrotik, Huawei), modelo, IP. */
  vendor: string | null;
  model: string | null;
  ipAddress: string | null;
  /** Ocupação % (USED+RESERVED / capacity) — só preenchido pra caixas ópticas. */
  occupancyPct?: number;
  /** Capacidade total de portas — só preenchido pra caixas ópticas. */
  capacity?: number;
}

export interface NetworkMapResponse {
  points: NetworkMapPoint[];
  stats: {
    total: number;
    pops: number;
    equipment: number;
    olts: number;
    enclosures: number;
    withoutGeo: number;
  };
}

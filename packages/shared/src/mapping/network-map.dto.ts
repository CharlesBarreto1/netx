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
  /** Inclui cabos de fibra (polylines — R3). Default true. */
  includeCables: z.coerce.boolean().optional().default(true),
  /** Inclui pontos de fusão/emenda (R4). Default true. */
  includeSplices: z.coerce.boolean().optional().default(true),
  /** Inclui eventos OTDR ativos (R6). Default true — operador quer ver
   *  rompimentos primeiro. Resolvidos NÃO entram, ficam só no /events. */
  includeEvents: z.coerce.boolean().optional().default(true),
  /**
   * Filtra caixas/cabos por pasta (R4.5e). CSV de UUIDs. Aceita também a
   * string literal `unassigned` pra incluir itens sem pasta. Default
   * (omitido) = mostra tudo, igual ao comportamento antes do R4.5e.
   * Ex.: "uuid1,uuid2,unassigned" → 2 pastas específicas + órfãos.
   */
  folderIds: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
    ),
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

/** Trecho geográfico (cabo de fibra) — R3. */
export interface NetworkMapSegment {
  id: string;
  /** Código humano (CABO-BB-001). */
  code: string;
  type: 'BACKBONE' | 'DISTRIBUTION' | 'DROP';
  /** Polyline lat/lng — mesmo formato consumido pelo Leaflet. */
  path: Array<{ latitude: number; longitude: number }>;
  fiberCount: number;
  lengthMeters: number;
  isActive: boolean;
}

/** Evento OTDR ativo (rompimento / atenuação) — R6. */
export interface NetworkMapEvent {
  id: string;
  cableId: string;
  cableCode: string;
  latitude: number;
  longitude: number;
  type:
    | 'BREAK'
    | 'BEND'
    | 'REFLECTION'
    | 'ATTENUATION'
    | 'CONNECTOR'
    | 'OTHER';
  distanceMeters: number;
  fiberIndex: number | null;
  lossDb: number | null;
  reportedAt: string;
}

/** Ponto de fusão / emenda — R4. */
export interface NetworkMapSplice {
  id: string;
  latitude: number;
  longitude: number;
  /** "CABO-BB-001 f3 ↔ CABO-DIST-007 f5" pra popup. */
  label: string;
  cableACode: string;
  cableBCode: string;
  fiberAIndex: number;
  fiberBIndex: number;
  /** Cor TIA-598 da fibra A (hex). */
  fiberAColor: string;
  fiberBColor: string;
  lossDb: number | null;
  /** Classificação visual da perda. */
  lossClass: 'unmeasured' | 'good' | 'warning' | 'bad';
}

export interface NetworkMapResponse {
  points: NetworkMapPoint[];
  segments: NetworkMapSegment[];
  splices: NetworkMapSplice[];
  events: NetworkMapEvent[];
  stats: {
    total: number;
    pops: number;
    equipment: number;
    olts: number;
    enclosures: number;
    cables: number;
    splices: number;
    events: number;
    withoutGeo: number;
  };
}

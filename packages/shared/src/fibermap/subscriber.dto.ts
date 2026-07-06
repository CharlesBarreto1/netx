/**
 * FiberMap — DTOs da costura assinante ↔ planta (integração NetX, spec §11).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Fluxos atendidos:
 *   - Picker de CTO/porta no cadastro de contrato e no wizard de instalação
 *     (busca CTOs com ocupação → lista portas de drop com status);
 *   - Vínculo contrato ↔ porta (contracts.fibermap_port_id) — atribuir na
 *     venda/instalação, liberar no cancelamento/retirada;
 *   - Resolução da CTO do contrato pra integrações (Ufinet CTO_PORT usa o
 *     NOME do elemento CTO; subscriber360 exibe "CTO-X · porta N").
 */
import { z } from 'zod';

// ── Busca de CTOs (picker passo 1) ─────────────────────────────────────────
export const SearchFibermapCtosQuerySchema = z.object({
  /** Busca por nome do elemento (ILIKE %q%). */
  search: z.string().trim().max(120).optional(),
  folderId: z.string().uuid().optional(),
  /** Ordena por distância quando informado (par obrigatório). */
  nearLat: z.coerce.number().min(-90).max(90).optional(),
  nearLng: z.coerce.number().min(-180).max(180).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchFibermapCtosQuery = z.infer<typeof SearchFibermapCtosQuerySchema>;

export interface FibermapCtoSummary {
  elementId: string;
  name: string;
  folderId: string;
  latitude: number;
  longitude: number;
  address: string | null;
  splitters: number;
  outPortsTotal: number;
  /** Sem contrato vinculado E sem face física ocupada. */
  outPortsFree: number;
  occupancyPct: number;
  /** Metros até (nearLat, nearLng); null quando busca sem coordenada. */
  distanceM: number | null;
}

// ── Portas de uma CTO (picker passo 2) ─────────────────────────────────────
/**
 * Status da porta de drop:
 *   FREE      — sem contrato e sem conexão física (selecionável);
 *   CONNECTED — fibra/conector documentado no FiberMap mas sem contrato
 *               (selecionável — assinante ainda não cadastrado/importado);
 *   ASSIGNED  — já atende um contrato (bloqueada no picker).
 */
export type FibermapSubscriberPortStatus = 'FREE' | 'CONNECTED' | 'ASSIGNED';

export interface FibermapSubscriberPortRow {
  portId: string;
  deviceId: string;
  deviceName: string;
  /** Razão do splitter quando disponível (metadata.ratio), ex.: "1x8". */
  deviceRatio: string | null;
  portNumber: number;
  label: string | null;
  status: FibermapSubscriberPortStatus;
  /** Alguma face (conector/fusão) ocupada no grafo óptico. */
  connected: boolean;
  contract: {
    id: string;
    code: string | null;
    status: string;
    customerName: string;
  } | null;
}

export interface FibermapCtoPortsResponse {
  element: { id: string; name: string; latitude: number; longitude: number };
  ports: FibermapSubscriberPortRow[];
}

// ── Vínculo contrato ↔ porta ───────────────────────────────────────────────
export const AssignFibermapPortRequestSchema = z.object({
  contractId: z.string().uuid(),
});
export type AssignFibermapPortRequest = z.infer<typeof AssignFibermapPortRequestSchema>;

/** Referência resolvida da porta do contrato (pra exibição e integrações). */
export interface FibermapContractPortRef {
  portId: string;
  portNumber: number;
  label: string | null;
  deviceId: string;
  deviceName: string;
  elementId: string;
  /** Nome do elemento CTO — é o que a Ufinet recebe como CTO_PORT. */
  elementName: string;
  latitude: number;
  longitude: number;
}

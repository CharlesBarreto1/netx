/**
 * FiberMap — DTOs dos relatórios (FM-6, spec §6 "Reports").
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Três relatórios read-only:
 *   - cto-occupancy: ocupação das portas OUT dos splitters por CTO;
 *   - splice-book: caderno de emendas de um elemento (todas as conexões
 *     com os dois lados resolvidos e a perda);
 *   - cable-usage: uso de fibras por cabo (status) + comprimento óptico.
 */
import { z } from 'zod';

export const ListFibermapReportQuerySchema = z.object({
  folderId: z.string().uuid().optional(),
});
export type ListFibermapReportQuery = z.infer<typeof ListFibermapReportQuerySchema>;

export const FibermapSpliceBookQuerySchema = z.object({
  elementId: z.string().uuid(),
});
export type FibermapSpliceBookQuery = z.infer<typeof FibermapSpliceBookQuerySchema>;

export interface FibermapCtoOccupancyRow {
  elementId: string;
  name: string;
  folderId: string;
  splitters: number;
  outPortsTotal: number;
  /** Porta OUT com QUALQUER face ocupada conta como usada. */
  outPortsUsed: number;
  occupancyPct: number;
}

export interface FibermapSpliceBookRow {
  connectionId: string;
  kind: 'FUSION' | 'CONNECTOR' | 'SPLITTER_PATH';
  aLabel: string;
  bLabel: string;
  /** null = usa o default do tipo (spec §5.3). */
  lossDb: number | null;
  notes: string | null;
  createdAt: string;
}

export interface FibermapSpliceBookResponse {
  element: { id: string; name: string; type: string };
  rows: FibermapSpliceBookRow[];
}

export interface FibermapCableUsageRow {
  cableId: string;
  name: string;
  folderId: string;
  fiberCount: number;
  dark: number;
  active: number;
  reserved: number;
  broken: number;
  /** (active + reserved) / total. */
  usedPct: number;
  /** Σ coalesce(medido, geo×excesso) + sobras (spec §5.2). */
  totalOpticalM: number;
}

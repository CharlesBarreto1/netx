/**
 * RadacctService — leitura do schema `radius.radacct` populado pelo
 * FreeRADIUS via accounting requests do BNG/OLT.
 *
 * Lookup strategy (multi-fonte porque o sistema é híbrido):
 *   - PPPoE legacy:  radacct.username = contract.pppoe_username
 *   - IPoE/MAC auth: radacct.username = contract.mac_address (com `:`)
 *                    OU radacct.callingstationid = contract.mac_address sem `:`
 *   - circuit-id:    radacct.username = contract.circuit_id
 *
 * Consulta `username = ANY($1)` cobre os 3 primeiros sem N+1. Filtra por
 * tenant via NAS, mas como BNG hoje serve todos tenants num só RADIUS,
 * confiamos só no identificador do contrato.
 */
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

export interface ContractSessionLookup {
  pppoeUsername: string | null;
  macAddress: string | null;
  circuitId: string | null;
}

export interface RadacctSession {
  online: boolean;
  framedIp: string | null;
  sessionStart: string | null; // ISO
  sessionStop: string | null;  // ISO (null se ativo)
  uptimeSeconds: number;
  inputBytes: number;
  outputBytes: number;
  terminateCause: string | null;
  nasIp: string | null;
}

export interface DailyUsage {
  date: string;        // YYYY-MM-DD
  inputBytes: number;  // download cliente
  outputBytes: number; // upload cliente
}

@Injectable()
export class RadacctService {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────────────────────────────────────────────────────
  // Lookup helpers
  // ───────────────────────────────────────────────────────────────────────
  /**
   * Lista de identificadores possíveis pra match no radacct.
   * Importante: MAC sem `:` é convenção do `callingstationid` em alguns
   * BNGs, então geramos as 2 variantes.
   */
  private buildIdentifiers(c: ContractSessionLookup): {
    usernames: string[];
    callingStationIds: string[];
  } {
    const usernames: string[] = [];
    const callingStationIds: string[] = [];
    if (c.pppoeUsername) usernames.push(c.pppoeUsername);
    if (c.circuitId) usernames.push(c.circuitId);
    if (c.macAddress) {
      // Dois formatos: AA:BB:CC:DD:EE:FF (com :) e aabbccddeeff (sem)
      usernames.push(c.macAddress);
      const compact = c.macAddress.replace(/[:-]/g, '').toLowerCase();
      callingStationIds.push(compact);
      callingStationIds.push(c.macAddress.replace(/[:-]/g, '').toUpperCase());
    }
    return { usernames, callingStationIds };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Status atual (online/offline)
  // ───────────────────────────────────────────────────────────────────────
  async getCurrentSession(
    c: ContractSessionLookup,
  ): Promise<RadacctSession | null> {
    const { usernames, callingStationIds } = this.buildIdentifiers(c);
    if (usernames.length === 0 && callingStationIds.length === 0) return null;

    // Pega a sessão mais recente do contrato. Se acctstoptime IS NULL → online.
    // O `WHERE` cobre tanto username quanto callingstationid pra suportar
    // BNGs que só populam um dos dois.
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        framedipaddress: string | null;
        acctstarttime: Date;
        acctstoptime: Date | null;
        acctsessiontime: number | null;
        acctinputoctets: bigint | null;
        acctoutputoctets: bigint | null;
        acctterminatecause: string | null;
        nasipaddress: string | null;
      }>
    >(
      `SELECT framedipaddress, acctstarttime, acctstoptime, acctsessiontime,
              acctinputoctets, acctoutputoctets, acctterminatecause, nasipaddress
       FROM radius.radacct
       WHERE username = ANY($1::text[])
          OR callingstationid = ANY($2::text[])
       ORDER BY acctstarttime DESC
       LIMIT 1`,
      usernames,
      callingStationIds,
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      online: r.acctstoptime === null,
      framedIp: r.framedipaddress,
      sessionStart: r.acctstarttime.toISOString(),
      sessionStop: r.acctstoptime?.toISOString() ?? null,
      uptimeSeconds: Number(r.acctsessiontime ?? 0),
      inputBytes: Number(r.acctinputoctets ?? 0),
      outputBytes: Number(r.acctoutputoctets ?? 0),
      terminateCause: r.acctterminatecause,
      nasIp: r.nasipaddress,
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Consumo agregado por dia
  // ───────────────────────────────────────────────────────────────────────
  async getDailyUsage(
    c: ContractSessionLookup,
    days: number,
  ): Promise<DailyUsage[]> {
    const { usernames, callingStationIds } = this.buildIdentifiers(c);
    if (usernames.length === 0 && callingStationIds.length === 0) return [];

    const safeDays = Math.max(1, Math.min(180, Math.floor(days)));

    // Soma traffic por dia. Janela: últimos N dias até agora.
    // Considera apenas sessões que iniciaram na janela; sessões mais antigas
    // que estendem pra dentro da janela ficam de fora — boa aproximação pro
    // gráfico, exato seria fatiar por tempo.
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ day: Date; input_bytes: bigint; output_bytes: bigint }>
    >(
      `SELECT date_trunc('day', acctstarttime)::date AS day,
              COALESCE(SUM(acctinputoctets), 0)::bigint AS input_bytes,
              COALESCE(SUM(acctoutputoctets), 0)::bigint AS output_bytes
       FROM radius.radacct
       WHERE (username = ANY($1::text[]) OR callingstationid = ANY($2::text[]))
         AND acctstarttime >= NOW() - ($3 || ' days')::interval
       GROUP BY day
       ORDER BY day ASC`,
      usernames,
      callingStationIds,
      String(safeDays),
    );

    return rows.map((r) => ({
      date: r.day.toISOString().slice(0, 10),
      inputBytes: Number(r.input_bytes),
      outputBytes: Number(r.output_bytes),
    }));
  }
}

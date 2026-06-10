// Match em radacct normaliza MAC (strip prefix `N:`, separadores, case)
// pra cobrir formatos Mikrotik (`1:b8:9f:..`), Huawei, Cisco etc.
/**
 * RadacctService — leitura do schema `radius.radacct` populado pelo
 * FreeRADIUS via accounting requests do BNG/OLT.
 *
 * Lookup strategy (multi-fonte porque o sistema é híbrido):
 *   - PPPoE legacy:  radacct.username = contract.pppoe_username
 *   - IPoE/MAC auth: radacct.username = contract.mac_address  OU
 *                    radacct.callingstationid em qualquer formato
 *                    (`AA:BB:CC:DD:EE:FF`, `aabbccddeeff`, `1:aa:bb:..`).
 *                    Match feito por normalização SQL: strip prefix `N:`,
 *                    remove separadores, lowercase. Funciona para Mikrotik
 *                    (manda `1:aa:bb:..`), Huawei, Cisco etc.
 *   - circuit-id:    radacct.username = contract.circuit_id
 *
 * Filtra por tenant via NAS, mas como BNG hoje serve todos tenants num só
 * RADIUS, confiamos só no identificador do contrato.
 */
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Normaliza MAC pra hex lowercase de 12 chars.
 * `B8:9F:CC:DC:DC:13` → `b89fccdcdc13`
 * `1:b8:9f:cc:dc:dc:13` → `b89fccdcdc13` (strip prefix Mikrotik)
 * `B8-9F-CC-DC-DC-13` → `b89fccdcdc13`
 */
export function normalizeMacForRadius(mac: string | null | undefined): string {
  if (!mac) return '';
  return mac
    .replace(/^[0-9]+:/, '')   // strip prefix tipo `1:` (Mikrotik Option 82)
    .replace(/[:\-.]/g, '')    // strip separadores
    .toLowerCase();
}

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
   * Identificadores literais (usernames/callingStationIds exatos) +
   * MAC normalizado (hex lowercase 12 chars) pra comparação em SQL com
   * REGEXP_REPLACE — assim a query funciona com qualquer formato que o
   * BNG decida usar (`AA:BB:..`, `aabbcc..`, `1:aa:bb:..` Mikrotik etc.).
   */
  private buildIdentifiers(c: ContractSessionLookup): {
    usernames: string[];
    callingStationIds: string[];
    normalizedMac: string; // hex lowercase, '' se sem MAC
  } {
    const usernames: string[] = [];
    const callingStationIds: string[] = [];
    if (c.pppoeUsername) usernames.push(c.pppoeUsername);
    if (c.circuitId) {
      usernames.push(c.circuitId);
      callingStationIds.push(c.circuitId);
    }
    if (c.macAddress) {
      // Mantém variantes literais como fast-path (índice direto), normalização
      // SQL serve de fallback robusto.
      usernames.push(c.macAddress);
      usernames.push(c.macAddress.toLowerCase());
      const compact = c.macAddress.replace(/[:-]/g, '');
      callingStationIds.push(compact.toLowerCase());
      callingStationIds.push(compact.toUpperCase());
      callingStationIds.push(c.macAddress);
      callingStationIds.push(c.macAddress.toLowerCase());
    }
    return {
      usernames,
      callingStationIds,
      normalizedMac: normalizeMacForRadius(c.macAddress),
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Status atual (online/offline)
  // ───────────────────────────────────────────────────────────────────────
  async getCurrentSession(
    c: ContractSessionLookup,
  ): Promise<RadacctSession | null> {
    const { usernames, callingStationIds, normalizedMac } =
      this.buildIdentifiers(c);
    if (
      usernames.length === 0 &&
      callingStationIds.length === 0 &&
      !normalizedMac
    )
      return null;

    // Pega a sessão mais recente do contrato. Se acctstoptime IS NULL → online.
    // Match em 3 vias:
    //   1) username = ANY (literal)         → fast-path com índice
    //   2) callingstationid = ANY (literal) → fast-path com índice
    //   3) normalizado em SQL = $3          → cobre qualquer formato
    //      (`1:aa:bb:..` do Mikrotik, hyphenated, lowercase, etc.)
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
          OR ($3 <> '' AND LOWER(REGEXP_REPLACE(
                REGEXP_REPLACE(callingstationid, '^[0-9]+:', ''),
                '[:\\-.]', '', 'g')) = $3)
          OR ($3 <> '' AND LOWER(REGEXP_REPLACE(
                REGEXP_REPLACE(username, '^[0-9]+:', ''),
                '[:\\-.]', '', 'g')) = $3)
       ORDER BY acctstarttime DESC
       LIMIT 1`,
      usernames,
      callingStationIds,
      normalizedMac,
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
  // Snapshot online/offline do tenant — agregado pro dashboard
  // ───────────────────────────────────────────────────────────────────────
  /**
   * Conta contratos ACTIVE que estão online (sessão `acctstoptime IS NULL`)
   * vs offline (sem sessão ativa). Match por `pppoeUsername`, `circuitId` ou
   * `mac_address` (com e sem `:`).
   *
   * Caro pra DB porque cruza `contracts` × `radius.radacct`. Não é pra rodar
   * em refresh agressivo — dashboard usa SWR com `refreshInterval=30min`.
   */
  async getOnlineSnapshot(tenantId: string): Promise<{
    online: number;
    offline: number;
    totalActive: number;
    snapshotAt: string;
  }> {
    const totalActive = await this.prisma.contract.count({
      where: { tenantId, status: 'ACTIVE', deletedAt: null },
    });

    // Conta contracts ativos com sessão em radacct sem stop time.
    // Normaliza MAC dos dois lados pra hex lowercase (strip prefix Mikrotik
    // `N:`, separadores, case) — cobre qualquer formato de BNG.
    const onlineRows = await this.prisma.$queryRawUnsafe<
      Array<{ count: bigint }>
    >(
      `SELECT COUNT(DISTINCT c.id)::bigint AS count
         FROM contracts c
         JOIN radius.radacct r ON (
              (c.pppoe_username IS NOT NULL AND r.username = c.pppoe_username)
           OR (c.circuit_id IS NOT NULL AND (
                 r.username = c.circuit_id
              OR r.callingstationid = c.circuit_id
              ))
           OR (c.mac_address IS NOT NULL AND (
                 LOWER(REGEXP_REPLACE(
                   REGEXP_REPLACE(r.callingstationid, '^[0-9]+:', ''),
                   '[:\\-.]', '', 'g'
                 )) = LOWER(REPLACE(REPLACE(REPLACE(c.mac_address, ':', ''), '-', ''), '.', ''))
              OR LOWER(REGEXP_REPLACE(
                   REGEXP_REPLACE(r.username, '^[0-9]+:', ''),
                   '[:\\-.]', '', 'g'
                 )) = LOWER(REPLACE(REPLACE(REPLACE(c.mac_address, ':', ''), '-', ''), '.', ''))
              ))
         )
        WHERE c.tenant_id = $1::uuid
          AND c.status = 'ACTIVE'
          AND c.deleted_at IS NULL
          AND r.acctstoptime IS NULL`,
      tenantId,
    );

    const online = Number(onlineRows[0]?.count ?? 0);
    const offline = Math.max(0, totalActive - online);
    return {
      online,
      offline,
      totalActive,
      snapshotAt: new Date().toISOString(),
    };
  }

  /**
   * IDs dos contratos do tenant com sessão RADIUS ativa (`acctstoptime IS
   * NULL`). Mesmo match do snapshot (pppoe/circuit-id/MAC normalizado), mas
   * sem restringir por status — quem consome compõe com os próprios filtros
   * (a listagem de contratos usa pra filtrar online/offline). Mesma ressalva
   * de custo do snapshot: não usar em polling agressivo.
   */
  async getOnlineContractIds(tenantId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT DISTINCT c.id
         FROM contracts c
         JOIN radius.radacct r ON (
              (c.pppoe_username IS NOT NULL AND r.username = c.pppoe_username)
           OR (c.circuit_id IS NOT NULL AND (
                 r.username = c.circuit_id
              OR r.callingstationid = c.circuit_id
              ))
           OR (c.mac_address IS NOT NULL AND (
                 LOWER(REGEXP_REPLACE(
                   REGEXP_REPLACE(r.callingstationid, '^[0-9]+:', ''),
                   '[:\\-.]', '', 'g'
                 )) = LOWER(REPLACE(REPLACE(REPLACE(c.mac_address, ':', ''), '-', ''), '.', ''))
              OR LOWER(REGEXP_REPLACE(
                   REGEXP_REPLACE(r.username, '^[0-9]+:', ''),
                   '[:\\-.]', '', 'g'
                 )) = LOWER(REPLACE(REPLACE(REPLACE(c.mac_address, ':', ''), '-', ''), '.', ''))
              ))
         )
        WHERE c.tenant_id = $1::uuid
          AND c.deleted_at IS NULL
          AND r.acctstoptime IS NULL`,
      tenantId,
    );
    return rows.map((r) => r.id);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Consumo agregado por dia
  // ───────────────────────────────────────────────────────────────────────
  async getDailyUsage(
    c: ContractSessionLookup,
    days: number,
  ): Promise<DailyUsage[]> {
    const { usernames, callingStationIds, normalizedMac } =
      this.buildIdentifiers(c);
    if (
      usernames.length === 0 &&
      callingStationIds.length === 0 &&
      !normalizedMac
    )
      return [];

    const safeDays = Math.max(1, Math.min(180, Math.floor(days)));

    // Soma traffic por dia. Janela: últimos N dias até agora.
    // Match em 3 vias (literal username/csid + normalização SQL) pra
    // cobrir qualquer formato de BNG (ver getCurrentSession).
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ day: Date; input_bytes: bigint; output_bytes: bigint }>
    >(
      `SELECT date_trunc('day', acctstarttime)::date AS day,
              COALESCE(SUM(acctinputoctets), 0)::bigint AS input_bytes,
              COALESCE(SUM(acctoutputoctets), 0)::bigint AS output_bytes
       FROM radius.radacct
       WHERE (
              username = ANY($1::text[])
           OR callingstationid = ANY($2::text[])
           OR ($4 <> '' AND LOWER(REGEXP_REPLACE(
                 REGEXP_REPLACE(callingstationid, '^[0-9]+:', ''),
                 '[:\\-.]', '', 'g')) = $4)
           OR ($4 <> '' AND LOWER(REGEXP_REPLACE(
                 REGEXP_REPLACE(username, '^[0-9]+:', ''),
                 '[:\\-.]', '', 'g')) = $4)
            )
         AND acctstarttime >= NOW() - ($3 || ' days')::interval
       GROUP BY day
       ORDER BY day ASC`,
      usernames,
      callingStationIds,
      String(safeDays),
      normalizedMac,
    );

    return rows.map((r) => ({
      date: r.day.toISOString().slice(0, 10),
      inputBytes: Number(r.input_bytes),
      outputBytes: Number(r.output_bytes),
    }));
  }
}

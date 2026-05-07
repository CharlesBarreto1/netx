/**
 * RadiusAuthLogService — consulta `radius.radpostauth` (post-auth log do
 * FreeRADIUS) com lookup do contrato/cliente correspondente.
 *
 * Schema do FreeRADIUS:
 *   radpostauth(id, username, pass, reply, authdate, calledstationid,
 *               callingstationid, class)
 *   - reply = 'Access-Accept' ou 'Access-Reject'
 *   - class pode conter Module-Failure-Message se policy configurada
 *
 * Lookup multi-fonte (igual ao radacct):
 *   - PPPoE: contract.pppoe_username = pa.username
 *   - IPoE:  contract.mac_address    = pa.username (com `:`)
 *            OU contract.circuit_id  = pa.username
 *            OU contract.mac_address compactado = pa.callingstationid
 */
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

export interface AuthLogEntry {
  id: number;
  username: string;
  reply: string;            // Access-Accept | Access-Reject
  accepted: boolean;
  authdate: string;
  calledStationId: string | null;
  callingStationId: string | null;
  reason: string | null;    // do campo `class` se preenchido
  contract: {
    id: string;
    code: string | null;
  } | null;
  customer: {
    id: string;
    displayName: string;
  } | null;
}

export interface AuthLogQuery {
  page?: number;
  pageSize?: number;
  username?: string;
  status?: 'accepted' | 'rejected';
  dateFrom?: Date;
  dateTo?: Date;
}

@Injectable()
export class RadiusAuthLogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    tenantId: string,
    q: AuthLogQuery,
  ): Promise<{ data: AuthLogEntry[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 50));
    const offset = (page - 1) * pageSize;
    const status = q.status === 'accepted' ? 'Access-Accept' : q.status === 'rejected' ? 'Access-Reject' : null;

    // Filtros condicionais via parâmetros numerados.
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: bigint;
        username: string;
        reply: string;
        authdate: Date;
        calledstationid: string | null;
        callingstationid: string | null;
        class: string | null;
        contract_id: string | null;
        contract_code: string | null;
        customer_id: string | null;
        display_name: string | null;
      }>
    >(
      `SELECT
         pa.id, pa.username, pa.reply, pa.authdate,
         pa.calledstationid, pa.callingstationid, pa.class,
         c.id   AS contract_id,
         c.code AS contract_code,
         cu.id  AS customer_id,
         cu.display_name AS display_name
       FROM radius.radpostauth pa
       LEFT JOIN public.contracts c
         ON c.tenant_id = $1::uuid
        AND c.deleted_at IS NULL
        AND (
              c.pppoe_username = pa.username
           OR c.mac_address    = pa.username
           OR c.circuit_id     = pa.username
           OR (c.mac_address IS NOT NULL
               AND lower(replace(c.mac_address, ':', '')) = lower(pa.callingstationid))
         )
       LEFT JOIN public.customers cu ON cu.id = c.customer_id
       WHERE ($2::text IS NULL OR pa.username ILIKE '%' || $2 || '%')
         AND ($3::text IS NULL OR pa.reply = $3)
         AND ($4::timestamptz IS NULL OR pa.authdate >= $4)
         AND ($5::timestamptz IS NULL OR pa.authdate <= $5)
       ORDER BY pa.authdate DESC
       LIMIT $6 OFFSET $7`,
      tenantId,
      q.username ?? null,
      status,
      q.dateFrom ?? null,
      q.dateTo ?? null,
      pageSize,
      offset,
    );

    const totalRows = await this.prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
      `SELECT count(*)::bigint AS total
       FROM radius.radpostauth pa
       WHERE ($1::text IS NULL OR pa.username ILIKE '%' || $1 || '%')
         AND ($2::text IS NULL OR pa.reply = $2)
         AND ($3::timestamptz IS NULL OR pa.authdate >= $3)
         AND ($4::timestamptz IS NULL OR pa.authdate <= $4)`,
      q.username ?? null,
      status,
      q.dateFrom ?? null,
      q.dateTo ?? null,
    );

    const total = Number(totalRows[0]?.total ?? 0);

    return {
      data: rows.map((r) => ({
        id: Number(r.id),
        username: r.username,
        reply: r.reply,
        accepted: r.reply === 'Access-Accept',
        authdate: r.authdate.toISOString(),
        calledStationId: r.calledstationid,
        callingStationId: r.callingstationid,
        // O `class` do FreeRADIUS pode trazer Module-Failure-Message se a
        // policy de post-auth-fail estiver setada. Fallback simples.
        reason: r.class || null,
        contract:
          r.contract_id
            ? { id: r.contract_id, code: r.contract_code }
            : null,
        customer:
          r.customer_id
            ? { id: r.customer_id, displayName: r.display_name ?? '' }
            : null,
      })),
      total,
      page,
      pageSize,
    };
  }
}

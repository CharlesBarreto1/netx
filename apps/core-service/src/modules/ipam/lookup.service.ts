import { BadRequestException, Injectable } from '@nestjs/common';
import type { IpamLookupRequest } from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { ipToBigInt, normalizeIp, detectVersion, bigIntToIp } from './ip.util';
import { toBig, toDec } from './ipam.util';
import { CgnatParams, reverseLookup } from './cgnat.algo';

/**
 * Busca reversa (atendimento a ofício / Marco Civil): dado um IP (público ou
 * privado) + porta + horário, resolve QUAL cliente/contrato estava usando.
 *
 * Cruza três fontes:
 *   1. IpamAddress  — IP diretamente documentado (fixo/equipamento/corporativo).
 *   2. IpamCgnatEntry / fórmula CGNAT — IP público + porta → IP privado.
 *   3. radius.radacct — sessão RADIUS ativa naquele instante (Framed-IP privado
 *      → username → contrato), pra confirmar quem estava conectado.
 */
@Injectable()
export class IpamLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async lookup(tenantId: string, input: IpamLookupRequest) {
    let canonical: string;
    let num: bigint;
    let version: 4 | 6;
    try {
      canonical = normalizeIp(input.ip);
      num = ipToBigInt(input.ip);
      version = detectVersion(input.ip);
    } catch (e) {
      throw new BadRequestException(`IP inválido: ${(e as Error).message}`);
    }
    const port = input.port ?? null;
    const at = input.at ? new Date(input.at) : null;

    // 1) IP diretamente documentado no IPAM.
    const direct = await this.prisma.ipamAddress.findFirst({
      where: { tenantId, address: canonical },
      include: {
        customer: { select: { id: true, displayName: true, code: true } },
        contract: { select: { id: true, code: true, pppoeUsername: true } },
        equipment: { select: { id: true, name: true } },
        prefix: { select: { id: true, cidr: true, role: true } },
      },
    });

    // 2) CGNAT — só faz sentido pra IPv4 público + porta.
    let cgnat: CgnatResult | null = null;
    let privateIp: string | null = null;
    if (version === 4 && port !== null) {
      cgnat = await this.resolveCgnat(tenantId, canonical, num, port);
      privateIp = cgnat?.privateIp ?? null;
    }

    // IP privado a consultar no RADIUS: o do CGNAT, ou o próprio IP se já é o
    // Framed-IP (cenário de IP fixo sem CGNAT).
    const radiusIp = privateIp ?? canonical;

    // 3) Sessão RADIUS naquele instante (ou a mais recente se sem horário).
    const sessions = await this.radiusSessions(radiusIp, at);

    // Contrato resolvido: prioriza vínculo direto/CGNAT; senão pela sessão.
    const resolved = await this.resolveContract(tenantId, direct, cgnat, sessions);

    return {
      query: { ip: canonical, port, at: at?.toISOString() ?? null, version },
      directMatch: direct,
      cgnatMatch: cgnat,
      radiusIp,
      radiusSessions: sessions,
      resolved,
    };
  }

  /** Resolve IP público+porta → privado via tabela materializada ou fórmula. */
  private async resolveCgnat(
    tenantId: string,
    publicIp: string,
    publicNum: bigint,
    port: number,
  ): Promise<CgnatResult | null> {
    // Preferimos a entrada materializada (carrega o vínculo já resolvido).
    const entry = await this.prisma.ipamCgnatEntry.findFirst({
      where: {
        tenantId,
        publicIp,
        portStart: { lte: port },
        portEnd: { gte: port },
      },
      include: {
        contract: { select: { id: true, code: true, pppoeUsername: true } },
        customer: { select: { id: true, displayName: true, code: true } },
        plan: { select: { id: true, name: true } },
      },
    });
    if (entry) {
      return {
        source: 'materialized',
        planId: entry.planId,
        planName: entry.plan.name,
        privateIp: entry.privateIp,
        portStart: entry.portStart,
        portEnd: entry.portEnd,
        contract: entry.contract,
        customer: entry.customer,
      };
    }

    // Fallback O(1): acha um plano cujo bloco público contém o IP e calcula.
    const plans = await this.prisma.ipamCgnatPlan.findMany({
      where: {
        tenantId,
        deletedAt: null,
        publicPrefix: {
          version: 'V4',
          firstAddr: { lte: toDec(publicNum) },
          lastAddr: { gte: toDec(publicNum) },
        },
      },
      include: {
        publicPrefix: { select: { firstAddr: true, lastAddr: true, version: true } },
        cgnatPrefix: { select: { firstAddr: true, lastAddr: true, version: true } },
      },
    });
    for (const plan of plans) {
      if (plan.publicPrefix.version !== 'V4' || plan.cgnatPrefix.version !== 'V4') continue;
      const params: CgnatParams = {
        publicFirst: toBig(plan.publicPrefix.firstAddr),
        publicLast: toBig(plan.publicPrefix.lastAddr),
        cgnatFirst: toBig(plan.cgnatPrefix.firstAddr),
        cgnatLast: toBig(plan.cgnatPrefix.lastAddr),
        portsPerClient: plan.portsPerClient,
        portBase: plan.portBase,
        maxPort: plan.maxPort,
      };
      const privNum = reverseLookup(publicNum, port, params);
      if (privNum !== null) {
        const privateIp = bigIntToIp(privNum, 4);
        return {
          source: 'computed',
          planId: plan.id,
          planName: plan.name,
          privateIp,
          portStart: null,
          portEnd: null,
          contract: null,
          customer: null,
        };
      }
    }
    return null;
  }

  private async radiusSessions(framedIp: string, at: Date | null) {
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        username: string | null;
        framedipaddress: string | null;
        acctstarttime: Date | null;
        acctstoptime: Date | null;
        callingstationid: string | null;
        nasipaddress: string | null;
      }>
    >(
      `SELECT username, framedipaddress, acctstarttime, acctstoptime, callingstationid, nasipaddress
         FROM radius.radacct
        WHERE framedipaddress = $1
          ${at ? 'AND acctstarttime <= $2 AND (acctstoptime IS NULL OR acctstoptime >= $2)' : ''}
        ORDER BY acctstarttime DESC
        LIMIT 5`,
      ...(at ? [framedIp, at] : [framedIp]),
    );
    return rows.map((r) => ({
      username: r.username,
      framedIp: r.framedipaddress,
      online: r.acctstoptime === null,
      sessionStart: r.acctstarttime?.toISOString() ?? null,
      sessionStop: r.acctstoptime?.toISOString() ?? null,
      callingStationId: r.callingstationid,
      nasIp: r.nasipaddress,
    }));
  }

  /** Junta as pistas num "melhor palpite" de contrato/cliente. */
  private async resolveContract(
    tenantId: string,
    direct: DirectMatch,
    cgnat: CgnatResult | null,
    sessions: Array<{ username: string | null }>,
  ) {
    if (direct?.contract) return { via: 'ipam-direct', contract: direct.contract, customer: direct.customer };
    if (cgnat?.contract) return { via: 'cgnat-entry', contract: cgnat.contract, customer: cgnat.customer };

    const username = sessions.find((s) => s.username)?.username ?? null;
    if (username) {
      const contract = await this.prisma.contract.findFirst({
        where: { tenantId, deletedAt: null, pppoeUsername: username },
        select: {
          id: true,
          code: true,
          pppoeUsername: true,
          customer: { select: { id: true, displayName: true, code: true } },
        },
      });
      if (contract)
        return { via: 'radius-username', contract, customer: contract.customer };
    }
    return { via: null, contract: null, customer: null };
  }
}

interface CgnatResult {
  source: 'materialized' | 'computed';
  planId: string;
  planName: string;
  privateIp: string;
  portStart: number | null;
  portEnd: number | null;
  contract: { id: string; code: string | null; pppoeUsername: string | null } | null;
  customer: { id: string; displayName: string; code: string | null } | null;
}

type DirectMatch = {
  contract: { id: string; code: string | null; pppoeUsername: string | null } | null;
  customer: { id: string; displayName: string; code: string | null } | null;
} | null;

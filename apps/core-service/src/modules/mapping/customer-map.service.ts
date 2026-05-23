/**
 * CustomerMapService — listagem de pontos pra mapa de Clientes (Mapeamento).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Carrega contratos georreferenciados + cruza com `radius.radacct` numa
 * query batch única pra detectar quem está online. Não usa N+1 (importante
 * pra operações com milhares de contratos).
 *
 * Política de "online":
 *   - ACTIVE + tem row em radacct.acctstoptime IS NULL com identificador
 *     que bate (PPPoE/MAC/circuitId) → verde
 *   - SUSPENDED → amarelo (não checa RADIUS, irrelevante)
 *   - ACTIVE + sem sessão → vermelho ("deveria estar online mas não está")
 *   - PENDING_INSTALL → azul (extra; UI esconde por default)
 *   - CANCELLED → cinza (extra; UI esconde por default)
 */
import { Injectable, Logger } from '@nestjs/common';
import { ContractStatus, type Prisma } from '@prisma/client';
import type {
  CustomerMapPoint,
  CustomerMapResponse,
  ListCustomerMapQuery,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { normalizeMacForRadius } from '../radius/radacct.service';

@Injectable()
export class CustomerMapService {
  private readonly logger = new Logger(CustomerMapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listCustomerPoints(
    tenantId: string,
    query: ListCustomerMapQuery,
  ): Promise<CustomerMapResponse> {
    // Status filter: default = todos exceto CANCELLED (operador raramente
    // quer ver cancelados no mapa, mas pode habilitar via query).
    const statusFilter: ContractStatus[] = (query.status as ContractStatus[]) ?? [
      ContractStatus.PENDING_INSTALL,
      ContractStatus.ACTIVE,
      ContractStatus.SUSPENDED,
    ];

    const contracts = await this.prisma.contract.findMany({
      where: {
        tenantId,
        deletedAt: null,
        latitude: { not: null },
        longitude: { not: null },
        status: { in: statusFilter },
        ...(query.planId ? { planId: query.planId } : {}),
      },
      select: {
        id: true,
        code: true,
        customerId: true,
        status: true,
        latitude: true,
        longitude: true,
        monthlyValue: true,
        installationAddress: true,
        pppoeUsername: true,
        macAddress: true,
        circuitId: true,
        customer: { select: { displayName: true } },
        plan: { select: { name: true } },
      },
    });

    // Set de identificadores online — uma query batch contra radacct.
    // Só consulta pra contratos ACTIVE (outros são offline por definição).
    const activeContracts = contracts.filter(
      (c) => c.status === ContractStatus.ACTIVE,
    );
    const onlineIds = activeContracts.length
      ? await this.fetchOnlineContractIds(activeContracts)
      : new Set<string>();

    const points: CustomerMapPoint[] = contracts.map((c) => {
      // Identifier "de exibição" — útil pra debug no popup. PPPoE > circuit > MAC.
      const radiusIdentifier =
        c.pppoeUsername ?? c.circuitId ?? c.macAddress ?? null;
      const isActive = c.status === ContractStatus.ACTIVE;
      const online = isActive && onlineIds.has(c.id);
      return {
        id: c.id,
        code: c.code,
        customerId: c.customerId,
        customerName: c.customer.displayName,
        latitude: Number(c.latitude),
        longitude: Number(c.longitude),
        status: c.status as CustomerMapPoint['status'],
        online,
        radiusIdentifier,
        planName: c.plan?.name ?? null,
        monthlyValue: Number(c.monthlyValue),
        installationAddress: c.installationAddress,
      };
    });

    const filtered = query.onlineOnly
      ? points.filter((p) => p.online)
      : points;

    const stats = {
      total: filtered.length,
      online: filtered.filter((p) => p.online).length,
      offline: filtered.filter(
        (p) => p.status === 'ACTIVE' && !p.online,
      ).length,
      suspended: filtered.filter((p) => p.status === 'SUSPENDED').length,
      pendingInstall: filtered.filter((p) => p.status === 'PENDING_INSTALL').length,
      cancelled: filtered.filter((p) => p.status === 'CANCELLED').length,
    };

    return { points: filtered, stats };
  }

  /**
   * Query batch única: pra cada contrato ACTIVE, decide se tem sessão RADIUS
   * ativa olhando `radacct.acctstoptime IS NULL` com username/callingstationid
   * casando com qualquer identificador conhecido do contrato.
   *
   * Cobre 3 estratégias de match (mesma lógica de RadacctService.getCurrentSession,
   * mas em batch pra evitar N+1):
   *   1. username/callingstationid igual a um identificador literal
   *   2. mesmo, mas normalizado (strip "1:" Mikrotik, hyphens, lowercase)
   *
   * Retorna Set<contractId> dos que têm sessão ativa.
   */
  private async fetchOnlineContractIds(
    contracts: Array<{
      id: string;
      pppoeUsername: string | null;
      macAddress: string | null;
      circuitId: string | null;
    }>,
  ): Promise<Set<string>> {
    // Mapa identifier (normalizado) → Set<contractId>. Um contrato pode ter
    // múltiplos identificadores; sessão num qualquer = online.
    const identToContracts = new Map<string, Set<string>>();
    const literalIds = new Set<string>();

    const add = (key: string, contractId: string) => {
      if (!key) return;
      let s = identToContracts.get(key);
      if (!s) {
        s = new Set();
        identToContracts.set(key, s);
      }
      s.add(contractId);
    };

    for (const c of contracts) {
      if (c.pppoeUsername) {
        literalIds.add(c.pppoeUsername);
        add(c.pppoeUsername.toLowerCase(), c.id);
      }
      if (c.circuitId) {
        literalIds.add(c.circuitId);
        add(c.circuitId.toLowerCase(), c.id);
      }
      if (c.macAddress) {
        literalIds.add(c.macAddress);
        const norm = normalizeMacForRadius(c.macAddress);
        if (norm) add(norm, c.id);
      }
    }

    if (literalIds.size === 0 && identToContracts.size === 0) {
      return new Set();
    }

    // 1 query SQL com 2 cláusulas OR. radacct é grande mas tem índice em
    // acctstoptime IS NULL (radacct_active_session_idx) e em username.
    // Tamanho do batch limitado pelo número de contratos ACTIVE com geo —
    // tipicamente centenas, raramente milhares; OK.
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ username: string | null; callingstationid: string | null }>
    >(
      `SELECT username, callingstationid
       FROM radius.radacct
       WHERE acctstoptime IS NULL
         AND (
           username = ANY($1::text[])
           OR callingstationid = ANY($1::text[])
           OR LOWER(REGEXP_REPLACE(
                REGEXP_REPLACE(COALESCE(callingstationid, ''), '^[0-9]+:', ''),
                '[:\\-.]', '', 'g')) = ANY($2::text[])
           OR LOWER(REGEXP_REPLACE(
                REGEXP_REPLACE(COALESCE(username, ''), '^[0-9]+:', ''),
                '[:\\-.]', '', 'g')) = ANY($2::text[])
         )`,
      Array.from(literalIds),
      Array.from(identToContracts.keys()),
    );

    const online = new Set<string>();
    for (const r of rows) {
      // Match literal direto
      if (r.username && literalIds.has(r.username)) {
        for (const c of contracts) {
          if (
            c.pppoeUsername === r.username ||
            c.circuitId === r.username ||
            c.macAddress === r.username
          ) {
            online.add(c.id);
          }
        }
      }
      if (r.callingstationid && literalIds.has(r.callingstationid)) {
        for (const c of contracts) {
          if (
            c.circuitId === r.callingstationid ||
            c.macAddress === r.callingstationid
          ) {
            online.add(c.id);
          }
        }
      }
      // Match normalizado: pega ambos username e callingstationid
      for (const value of [r.username, r.callingstationid]) {
        if (!value) continue;
        const norm = value
          .replace(/^[0-9]+:/, '')
          .replace(/[:\-.]/g, '')
          .toLowerCase();
        const matches = identToContracts.get(norm);
        if (matches) {
          matches.forEach((cid) => online.add(cid));
        }
        // Lowercase literal (caso "joao" cadastrado vs "JOAO" no radacct)
        const lowerMatches = identToContracts.get(value.toLowerCase());
        if (lowerMatches) {
          lowerMatches.forEach((cid) => online.add(cid));
        }
      }
    }

    return online;
  }
}

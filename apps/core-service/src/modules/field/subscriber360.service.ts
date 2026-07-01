/**
 * Subscriber360Service — BFF READ-ONLY do "Assinante 360" (NetX Field / atendente).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Junta numa única chamada, para um assinante (Customer):
 *   - ERP: cliente, contratos (plano/valor/status), faturas em aberto, O.S recentes
 *   - CPE: ONT vinculada + sinal óptico persistido (lastRx/lastTx)
 *   - Rede óptica: porta/CTO onde o contrato é atendido
 *   - RADIUS: se a sessão está ativa (online) — mesma lógica batch do mapa
 *
 * É PURA LEITURA: não escreve, não é dono de schema, não chama equipamento.
 * Ações contextuais (desbloqueio, reprovisionar, abrir O.S) continuam batendo
 * na API do módulo dono — este serviço só monta a visão.
 *
 * NMS (outage por PON) é enriquecimento futuro — não há link determinístico
 * Olt→device NMS hoje (ver brief). O contrato de resposta já reserva espaço.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  Subscriber360Contract,
  Subscriber360Invoice,
  Subscriber360Response,
  Subscriber360ServiceOrder,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { normalizeMacForRadius } from '../radius/radacct.service';

/** Deriva o displayStatus (OVERDUE não é persistido — é derivado na leitura). */
function osDisplayStatus(status: string, scheduledAt: Date | null): string {
  if (
    (status === 'OPEN' || status === 'SCHEDULED') &&
    scheduledAt &&
    scheduledAt.getTime() < Date.now()
  ) {
    return 'OVERDUE';
  }
  return status;
}

@Injectable()
export class Subscriber360Service {
  constructor(private readonly prisma: PrismaService) {}

  async getByCustomer(tenantId: string, customerId: string): Promise<Subscriber360Response> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId, deletedAt: null },
      select: {
        id: true,
        code: true,
        displayName: true,
        type: true,
        status: true,
        primaryPhone: true,
        primaryEmail: true,
      },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');

    const contracts = await this.prisma.contract.findMany({
      where: { tenantId, customerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        code: true,
        status: true,
        authMethod: true,
        monthlyValue: true,
        bandwidthMbps: true,
        uploadMbps: true,
        pppoeUsername: true,
        circuitId: true,
        macAddress: true,
        installationAddress: true,
        latitude: true,
        longitude: true,
        activatedAt: true,
        plan: { select: { name: true } },
        ont: {
          select: {
            id: true,
            snGpon: true,
            status: true,
            lastRxPower: true,
            lastTxPower: true,
            lastSeenAt: true,
          },
        },
        opticalPort: {
          select: { number: true, enclosure: { select: { code: true } } },
        },
      },
    });

    const onlineIds = await this.fetchOnlineContractIds(
      contracts.filter((c) => c.status === 'ACTIVE'),
    );

    const contractIds = contracts.map((c) => c.id);

    // Faturas em aberto (OPEN/OVERDUE) de todos os contratos do assinante.
    const invoices = contractIds.length
      ? await this.prisma.contractInvoice.findMany({
          where: {
            tenantId,
            contractId: { in: contractIds },
            status: { in: ['OPEN', 'OVERDUE'] },
          },
          orderBy: { dueDate: 'asc' },
          select: {
            id: true,
            contractId: true,
            amount: true,
            dueDate: true,
            status: true,
          },
        })
      : [];

    // O.S recentes (últimas 10) do assinante.
    const serviceOrders = contractIds.length
      ? await this.prisma.serviceOrder.findMany({
          where: { tenantId, contractId: { in: contractIds }, deletedAt: null },
          orderBy: { openedAt: 'desc' },
          take: 10,
          select: {
            id: true,
            code: true,
            status: true,
            scheduledAt: true,
            openedAt: true,
            reason: { select: { name: true } },
          },
        })
      : [];

    const now = Date.now();
    const contractsOut: Subscriber360Contract[] = contracts.map((c) => ({
      id: c.id,
      code: c.code,
      status: c.status as Subscriber360Contract['status'],
      authMethod: c.authMethod as Subscriber360Contract['authMethod'],
      planName: c.plan?.name ?? null,
      monthlyValue: Number(c.monthlyValue),
      bandwidthMbps: c.bandwidthMbps,
      uploadMbps: c.uploadMbps ?? null,
      pppoeUsername: c.pppoeUsername,
      installationAddress: c.installationAddress,
      latitude: c.latitude != null ? Number(c.latitude) : null,
      longitude: c.longitude != null ? Number(c.longitude) : null,
      activatedAt: c.activatedAt ? c.activatedAt.toISOString() : null,
      connection: {
        online: c.status === 'ACTIVE' && onlineIds.has(c.id),
        radiusIdentifier: c.pppoeUsername ?? c.circuitId ?? c.macAddress ?? null,
      },
      ont: c.ont
        ? {
            id: c.ont.id,
            snGpon: c.ont.snGpon,
            status: c.ont.status as NonNullable<Subscriber360Contract['ont']>['status'],
            lastRxPowerDbm: c.ont.lastRxPower != null ? Number(c.ont.lastRxPower) : null,
            lastTxPowerDbm: c.ont.lastTxPower != null ? Number(c.ont.lastTxPower) : null,
            lastSeenAt: c.ont.lastSeenAt ? c.ont.lastSeenAt.toISOString() : null,
          }
        : null,
      opticalPort: c.opticalPort
        ? { enclosureCode: c.opticalPort.enclosure.code, number: c.opticalPort.number }
        : null,
    }));

    const openInvoices: Subscriber360Invoice[] = invoices.map((i) => {
      const overdue = i.status === 'OVERDUE' || i.dueDate.getTime() < now;
      return {
        id: i.id,
        contractId: i.contractId,
        amount: Number(i.amount),
        dueDate: i.dueDate.toISOString().slice(0, 10),
        status: overdue ? 'OVERDUE' : 'OPEN',
      };
    });

    const recentServiceOrders: Subscriber360ServiceOrder[] = serviceOrders.map((o) => ({
      id: o.id,
      code: o.code,
      status: o.status as Subscriber360ServiceOrder['status'],
      displayStatus: osDisplayStatus(o.status, o.scheduledAt),
      reasonName: o.reason?.name ?? '—',
      scheduledAt: o.scheduledAt ? o.scheduledAt.toISOString() : null,
      openedAt: o.openedAt.toISOString(),
    }));

    const balanceDue = openInvoices.reduce((sum, i) => sum + i.amount, 0);

    return {
      customer: {
        id: customer.id,
        code: customer.code,
        displayName: customer.displayName,
        type: customer.type as Subscriber360Response['customer']['type'],
        status: customer.status,
        primaryPhone: customer.primaryPhone,
        primaryEmail: customer.primaryEmail,
      },
      contracts: contractsOut,
      openInvoices,
      recentServiceOrders,
      balanceDue,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Set<contractId> dos contratos com sessão RADIUS ativa. Mesma estratégia
   * batch do CustomerMapService (radacct.acctstoptime IS NULL casando por
   * PPPoE/circuitId/MAC, literal e normalizado), mas escopado ao assinante
   * (poucos contratos).
   */
  private async fetchOnlineContractIds(
    contracts: Array<{
      id: string;
      pppoeUsername: string | null;
      circuitId: string | null;
      macAddress: string | null;
    }>,
  ): Promise<Set<string>> {
    if (contracts.length === 0) return new Set();

    const identToContracts = new Map<string, Set<string>>();
    const literalIds = new Set<string>();
    const add = (key: string | null, contractId: string) => {
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
        add(normalizeMacForRadius(c.macAddress), c.id);
      }
    }

    if (literalIds.size === 0 && identToContracts.size === 0) return new Set();

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
      for (const value of [r.username, r.callingstationid]) {
        if (!value) continue;
        if (literalIds.has(value)) {
          for (const c of contracts) {
            if (
              c.pppoeUsername === value ||
              c.circuitId === value ||
              c.macAddress === value
            ) {
              online.add(c.id);
            }
          }
        }
        const norm = value
          .replace(/^[0-9]+:/, '')
          .replace(/[:\-.]/g, '')
          .toLowerCase();
        identToContracts.get(norm)?.forEach((cid) => online.add(cid));
        identToContracts.get(value.toLowerCase())?.forEach((cid) => online.add(cid));
      }
    }
    return online;
  }
}

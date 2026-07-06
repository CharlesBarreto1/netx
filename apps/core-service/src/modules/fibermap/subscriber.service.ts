/**
 * FibermapSubscriberService — costura assinante ↔ planta (spec §11).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * É a única porta de entrada pro vínculo contrato ↔ porta de drop
 * (contracts.fibermap_port_id). Consumidores:
 *   - Controller (picker de CTO/porta no cadastro/instalação);
 *   - ProvisioningService.installCustomer (vincula na ativação; resolve o
 *     nome da CTO pro CTO_PORT da Ufinet);
 *   - ServiceOrders (retirada libera a porta);
 *   - Contracts.cancel (libera a porta);
 *   - Field/subscriber360 (exibe "CTO-X · porta N").
 *
 * Ocupação física (fibra/conector plugado na porta) vem de
 * fibermap_connection_endpoints — mesma fonte da unicidade do grafo (FM-3).
 * Ocupação comercial (contrato) vem de contracts.fibermap_port_id. Uma porta
 * só é ASSIGNED quando tem contrato; CONNECTED (fibra documentada sem
 * contrato) continua selecionável — cobre assinante legado ainda não ligado.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  fibermapPortKey,
  type FibermapContractPortRef,
  type FibermapCtoPortsResponse,
  type FibermapCtoSummary,
  type FibermapSubscriberPortRow,
  type SearchFibermapCtosQuery,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

const round1 = (v: number): number => Math.round(v * 10) / 10;

@Injectable()
export class FibermapSubscriberService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────
  // Picker — passo 1: CTOs com ocupação
  // ───────────────────────────────────────────────────────────────────────
  async searchCtos(
    tenantId: string,
    q: SearchFibermapCtosQuery,
  ): Promise<FibermapCtoSummary[]> {
    // Com coordenada: pré-filtra por distância via GiST (KNN) pra não varrer
    // a planta inteira; sem coordenada: busca por nome.
    let idsByDistance: Array<{ id: string; distance_m: number }> | null = null;
    if (q.nearLat != null && q.nearLng != null) {
      idsByDistance = await this.prisma.$queryRaw<
        Array<{ id: string; distance_m: number }>
      >`
        SELECT e.id,
               ST_Distance(e.geom::geography,
                           ST_SetSRID(ST_MakePoint(${q.nearLng}, ${q.nearLat}), 4326)::geography
               )::float8 AS distance_m
          FROM fibermap_elements e
         WHERE e.tenant_id = ${tenantId}::uuid
           AND e.type = 'CTO'
           AND e.deleted_at IS NULL
           ${q.folderId ? Prisma.sql`AND e.folder_id = ${q.folderId}::uuid` : Prisma.empty}
           ${q.search ? Prisma.sql`AND e.name ILIKE ${'%' + q.search + '%'}` : Prisma.empty}
         ORDER BY e.geom <-> ST_SetSRID(ST_MakePoint(${q.nearLng}, ${q.nearLat}), 4326)
         LIMIT ${q.limit}`;
    }

    const ctos = await this.prisma.fibermapElement.findMany({
      where: idsByDistance
        ? { id: { in: idsByDistance.map((r) => r.id) }, tenantId, deletedAt: null }
        : {
            tenantId,
            type: 'CTO',
            deletedAt: null,
            ...(q.folderId ? { folderId: q.folderId } : {}),
            ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
          },
      select: {
        id: true,
        name: true,
        folderId: true,
        latitude: true,
        longitude: true,
        address: true,
        devices: {
          where: { type: 'SPLITTER', deletedAt: null },
          select: {
            id: true,
            ports: { where: { role: 'OUT' }, select: { id: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
      take: q.limit,
    });

    const portIds = ctos.flatMap((c) => c.devices.flatMap((d) => d.ports.map((p) => p.id)));
    const [usedKeys, assigned] = await Promise.all([
      this.findConnectedPortIds(portIds),
      portIds.length
        ? this.prisma.contract.findMany({
            where: { fibermapPortId: { in: portIds }, deletedAt: null },
            select: { fibermapPortId: true },
          })
        : Promise.resolve([]),
    ]);
    const assignedSet = new Set(assigned.map((a) => a.fibermapPortId as string));

    const distByCto = new Map(
      (idsByDistance ?? []).map((r) => [r.id, Math.round(Number(r.distance_m))]),
    );

    const rows = ctos.map((cto) => {
      const ports = cto.devices.flatMap((d) => d.ports);
      const busy = ports.filter((p) => assignedSet.has(p.id) || usedKeys.has(p.id)).length;
      return {
        elementId: cto.id,
        name: cto.name,
        folderId: cto.folderId,
        latitude: Number(cto.latitude),
        longitude: Number(cto.longitude),
        address: cto.address,
        splitters: cto.devices.length,
        outPortsTotal: ports.length,
        outPortsFree: ports.length - busy,
        occupancyPct: ports.length ? round1((busy / ports.length) * 100) : 0,
        distanceM: distByCto.get(cto.id) ?? null,
      };
    });
    // KNN já devolve ordenado; a re-consulta Prisma reordena por nome.
    if (idsByDistance) {
      rows.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
    }
    return rows;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Picker — passo 2: portas de drop de uma CTO
  // ───────────────────────────────────────────────────────────────────────
  async listCtoPorts(
    tenantId: string,
    elementId: string,
  ): Promise<FibermapCtoPortsResponse> {
    const element = await this.prisma.fibermapElement.findFirst({
      where: { id: elementId, tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        latitude: true,
        longitude: true,
        devices: {
          where: { type: 'SPLITTER', deletedAt: null },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            metadata: true,
            ports: {
              where: { role: 'OUT' },
              orderBy: { portNumber: 'asc' },
              select: { id: true, portNumber: true, label: true },
            },
          },
        },
      },
    });
    if (!element) throw new NotFoundException('Elemento não encontrado');

    const portIds = element.devices.flatMap((d) => d.ports.map((p) => p.id));
    const [usedKeys, contracts] = await Promise.all([
      this.findConnectedPortIds(portIds),
      portIds.length
        ? this.prisma.contract.findMany({
            where: { fibermapPortId: { in: portIds }, deletedAt: null },
            select: {
              id: true,
              code: true,
              status: true,
              fibermapPortId: true,
              customer: { select: { displayName: true } },
            },
          })
        : Promise.resolve([]),
    ]);
    const byPort = new Map(contracts.map((c) => [c.fibermapPortId as string, c]));

    const ports: FibermapSubscriberPortRow[] = element.devices.flatMap((d) => {
      const meta = (d.metadata ?? {}) as Record<string, unknown>;
      const ratio = typeof meta.ratio === 'string' ? meta.ratio : null;
      return d.ports.map((p) => {
        const contract = byPort.get(p.id) ?? null;
        const connected = usedKeys.has(p.id);
        return {
          portId: p.id,
          deviceId: d.id,
          deviceName: d.name,
          deviceRatio: ratio,
          portNumber: p.portNumber,
          label: p.label,
          connected,
          contract: contract
            ? {
                id: contract.id,
                code: contract.code,
                status: contract.status,
                customerName: contract.customer.displayName,
              }
            : null,
          status: contract ? 'ASSIGNED' : connected ? 'CONNECTED' : 'FREE',
        } satisfies FibermapSubscriberPortRow;
      });
    });

    return {
      element: {
        id: element.id,
        name: element.name,
        latitude: Number(element.latitude),
        longitude: Number(element.longitude),
      },
      ports,
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Vínculo contrato ↔ porta
  // ───────────────────────────────────────────────────────────────────────
  /**
   * Atribui a porta ao contrato (idempotente pro mesmo par). Regras:
   * porta OUT de splitter em elemento CTO vivo; contrato vivo; porta sem
   * outro contrato; contrato troca de porta livremente (re-instalação).
   */
  async assignPort(
    tenantId: string,
    actorUserId: string | null,
    portId: string,
    contractId: string,
  ): Promise<FibermapContractPortRef> {
    const port = await this.prisma.fibermapOpticalPort.findFirst({
      where: { id: portId, tenantId, role: 'OUT' },
      select: {
        id: true,
        device: {
          select: {
            type: true,
            deletedAt: true,
            element: { select: { id: true, type: true, deletedAt: true } },
          },
        },
        contract: { select: { id: true, code: true } },
      },
    });
    if (!port || port.device.deletedAt || port.device.element.deletedAt) {
      throw new NotFoundException('Porta de drop não encontrada');
    }
    if (port.device.type !== 'SPLITTER' || port.device.element.type !== 'CTO') {
      throw new BadRequestException('A porta precisa ser OUT de splitter dentro de uma CTO');
    }
    if (port.contract && port.contract.id !== contractId) {
      throw new ConflictException(
        `Porta já atende o contrato ${port.contract.code ?? port.contract.id}`,
      );
    }

    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, tenantId, deletedAt: null },
      select: { id: true, code: true, fibermapPortId: true },
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado');

    if (contract.fibermapPortId !== portId) {
      await this.prisma.contract.update({
        where: { id: contract.id },
        data: { fibermapPortId: portId },
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'fibermap.port.assigned',
        resource: 'contracts',
        resourceId: contract.id,
        beforeState: { fibermapPortId: contract.fibermapPortId },
        afterState: { fibermapPortId: portId },
      });
    }
    return this.getContractPortRef(tenantId, contractId) as Promise<FibermapContractPortRef>;
  }

  /** Libera a porta do contrato (cancelamento/retirada). No-op sem vínculo. */
  async releaseByContract(
    tenantId: string,
    actorUserId: string | null,
    contractId: string,
  ): Promise<void> {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, tenantId },
      select: { id: true, fibermapPortId: true },
    });
    if (!contract?.fibermapPortId) return;
    await this.prisma.contract.update({
      where: { id: contract.id },
      data: { fibermapPortId: null },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.port.released',
      resource: 'contracts',
      resourceId: contract.id,
      beforeState: { fibermapPortId: contract.fibermapPortId },
      afterState: { fibermapPortId: null },
    });
  }

  /**
   * Referência resolvida da porta do contrato — null sem vínculo. O
   * elementName é o CTO_PORT da Ufinet (código completo da caixa, ex.:
   * "JLMPY-PY13734" — AGENTS.md "Integração Ufinet").
   */
  async getContractPortRef(
    tenantId: string,
    contractId: string,
  ): Promise<FibermapContractPortRef | null> {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, tenantId },
      select: {
        fibermapPort: {
          select: {
            id: true,
            portNumber: true,
            label: true,
            device: {
              select: {
                id: true,
                name: true,
                element: {
                  select: { id: true, name: true, latitude: true, longitude: true },
                },
              },
            },
          },
        },
      },
    });
    const port = contract?.fibermapPort;
    if (!port) return null;
    return {
      portId: port.id,
      portNumber: port.portNumber,
      label: port.label,
      deviceId: port.device.id,
      deviceName: port.device.name,
      elementId: port.device.element.id,
      elementName: port.device.element.name,
      latitude: Number(port.device.element.latitude),
      longitude: Number(port.device.element.longitude),
    };
  }

  /** Referências em lote (subscriber360/listas). Map vazio sem vínculos. */
  async getContractPortRefs(
    tenantId: string,
    contractIds: string[],
  ): Promise<Map<string, FibermapContractPortRef>> {
    if (contractIds.length === 0) return new Map();
    const rows = await this.prisma.contract.findMany({
      where: { id: { in: contractIds }, tenantId, fibermapPortId: { not: null } },
      select: {
        id: true,
        fibermapPort: {
          select: {
            id: true,
            portNumber: true,
            label: true,
            device: {
              select: {
                id: true,
                name: true,
                element: {
                  select: { id: true, name: true, latitude: true, longitude: true },
                },
              },
            },
          },
        },
      },
    });
    const out = new Map<string, FibermapContractPortRef>();
    for (const r of rows) {
      const port = r.fibermapPort;
      if (!port) continue;
      out.set(r.id, {
        portId: port.id,
        portNumber: port.portNumber,
        label: port.label,
        deviceId: port.device.id,
        deviceName: port.device.name,
        elementId: port.device.element.id,
        elementName: port.device.element.name,
        latitude: Number(port.device.element.latitude),
        longitude: Number(port.device.element.longitude),
      });
    }
    return out;
  }

  /** Ids de portas com QUALQUER face (conector/fusão) ocupada no grafo. */
  private async findConnectedPortIds(portIds: string[]): Promise<Set<string>> {
    if (portIds.length === 0) return new Set();
    const keys = portIds.flatMap((id) => [
      fibermapPortKey(id, 'CONNECTOR'),
      fibermapPortKey(id, 'FUSION'),
    ]);
    const used = await this.prisma.fibermapConnectionEndpoint.findMany({
      where: { endpointKey: { in: keys } },
      select: { endpointKey: true },
    });
    return new Set(used.map((u) => u.endpointKey.split(':')[1]));
  }
}

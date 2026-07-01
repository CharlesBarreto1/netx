import { ConflictException, Injectable, Logger } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { IpamAddressesService } from './addresses.service';
import { normalizeIp, isValidIp } from './ip.util';

/**
 * Sincronização bidirecional entre o cadastro (Contrato/Equipamento) e o IPAM.
 * O IPAM é a documentação; NÃO escrevemos no RADIUS aqui (o contrato faz isso
 * via radius-applier). A regra é espelhar:
 *
 *   Contrato.framedIpAddress  ⇄  IpamAddress(kind=CONTRACT, contractId)
 *   NetworkEquipment.ipAddress →  IpamAddress(kind=EQUIPMENT, equipmentId)
 *
 * Cada direção escreve APENAS o outro lado (via Prisma cru, sem passar pelo
 * service que dispararia o hook oposto) — então não há laço de sincronização.
 *
 * Colisão de IP (dois donos no mesmo endereço) vira ConflictException e ABORTA
 * a operação de origem — é exatamente a garantia pedida: "nunca 2 clientes/
 * equipamentos no mesmo IP". Já a ausência de prefixo que contenha o IP é
 * tolerada (só não documenta; não bloqueia o cadastro).
 */
@Injectable()
export class IpamSyncService {
  private readonly logger = new Logger(IpamSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly addresses: IpamAddressesService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Espelha o IP fixo de um contrato no IPAM e garante que o
   * Contract.framedIpAddress reflita o endereço. Idempotente — serve tanto pro
   * hook do contrato quanto pra atribuição feita de dentro do IPAM.
   */
  async setContractIp(
    tenantId: string,
    actorId: string | null,
    contractId: string,
    ip: string | null,
  ): Promise<void> {
    const normalized = ip && isValidIp(ip) ? normalizeIp(ip) : null;

    // Solta o IP anterior deste contrato se mudou/limpou.
    const prev = await this.prisma.ipamAddress.findFirst({
      where: { tenantId, contractId },
    });
    if (prev && prev.address !== normalized) {
      await this.addresses.release(tenantId, actorId, prev.id);
    }

    if (!normalized) {
      await this.setContractFramedIp(contractId, null);
      return;
    }

    // customerId do contrato — pra o IP aparecer na aba IPAM do cliente.
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { customerId: true },
    });

    // Documenta/ocupa o IP vinculado ao contrato (lança em colisão real).
    try {
      await this.addresses.create(
        tenantId,
        actorId,
        {
          address: normalized,
          prefixId: null,
          status: 'USED',
          kind: 'CONTRACT',
          contractId,
          customerId: contract?.customerId ?? null,
          isGateway: false,
        } as never,
        'CONTRACT',
      );
    } catch (e) {
      if (e instanceof ConflictException) throw e; // colisão → aborta o save
      // Sem prefixo que contenha o IP (ou outro erro brando) → só loga.
      this.logger.warn(`setContractIp: IPAM não documentou ${normalized}: ${(e as Error).message}`);
    }

    await this.setContractFramedIp(contractId, normalized);
  }

  /** Escreve o Framed-IP direto na tabela (sem passar pelo ContractsService). */
  private async setContractFramedIp(contractId: string, ip: string | null): Promise<void> {
    const c = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { framedIpAddress: true },
    });
    if (!c || c.framedIpAddress === ip) return;
    await this.prisma.contract.update({
      where: { id: contractId },
      data: { framedIpAddress: ip },
    });
  }

  /** Espelha o IP de gerência de um equipamento no IPAM. */
  async setEquipmentIp(
    tenantId: string,
    actorId: string | null,
    equipmentId: string,
    ip: string | null,
  ): Promise<void> {
    const normalized = ip && isValidIp(ip) ? normalizeIp(ip) : null;
    const prev = await this.prisma.ipamAddress.findFirst({
      where: { tenantId, equipmentId },
    });
    if (prev && prev.address !== normalized) {
      await this.addresses.release(tenantId, actorId, prev.id);
    }
    if (!normalized) return;
    try {
      await this.addresses.create(
        tenantId,
        actorId,
        {
          address: normalized,
          prefixId: null,
          status: 'USED',
          kind: 'EQUIPMENT',
          equipmentId,
          isGateway: false,
        } as never,
        'EQUIPMENT',
      );
    } catch (e) {
      if (e instanceof ConflictException) throw e;
      this.logger.warn(`setEquipmentIp: IPAM não documentou ${normalized}: ${(e as Error).message}`);
    }
  }

  /** Libera todos os IPs vinculados a um contrato (ao cancelar/excluir). */
  async releaseContract(tenantId: string, actorId: string | null, contractId: string): Promise<void> {
    const rows = await this.prisma.ipamAddress.findMany({ where: { tenantId, contractId } });
    for (const r of rows) await this.addresses.release(tenantId, actorId, r.id);
  }

  /** Libera IPs vinculados a um equipamento (ao excluir). */
  async releaseEquipment(tenantId: string, actorId: string | null, equipmentId: string): Promise<void> {
    const rows = await this.prisma.ipamAddress.findMany({ where: { tenantId, equipmentId } });
    for (const r of rows) await this.addresses.release(tenantId, actorId, r.id);
  }
}

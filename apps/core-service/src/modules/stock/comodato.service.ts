import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import { StockLocationsService } from './stock-locations.service';

/**
 * ComodatoService — operações de alocação/devolução de equipamento patrimonial
 * a um Contract.
 *
 * Modelo de negócio: ISP não vende equipamento; só empresta (comodato). Quando
 * cliente vira inadimplente ou cancela contrato, equipamento volta pro estoque.
 *
 * Operações:
 *   - allocate(): SerialItem.status IN_STOCK → ALLOCATED + StockMovement(COMODATO_OUT)
 *                 SerialItem.contractId = contractId; .allocatedAt = now
 *                 SerialItem.locationId = null (não está em local físico, está com cliente)
 *   - returnItem(): inverso — ALLOCATED → IN_STOCK no local especificado
 *                 + StockMovement(COMODATO_RETURN)
 *
 * Não exigimos `unitCost` nas operações de comodato — usamos o
 * SerialItem.acquisitionCost (valor pago na compra) pra preservar custo histórico.
 */
@Injectable()
export class ComodatoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly locations: StockLocationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // QUERIES
  // ---------------------------------------------------------------------------

  /**
   * Lista equipamentos em comodato num contrato específico. Inclui produto
   * e movimentos (auditoria de quando foi alocado/devolvido). Filtra por
   * status=ALLOCATED por padrão; passe `includeReturned=true` pra ver histórico
   * completo (seriais que foram devolvidos mas têm vínculo histórico via
   * movements).
   */
  async listByContract(
    tenantId: string,
    contractId: string,
    options: { includeReturned?: boolean } = {},
  ) {
    if (options.includeReturned) {
      // Histórico via movimentos — pega todos os COMODATO_OUT desse contrato,
      // mesmo que o SerialItem já tenha sido devolvido (contract_id = null hoje).
      const movements = await this.prisma.stockMovement.findMany({
        where: {
          tenantId,
          contractId,
          type: { in: ['COMODATO_OUT', 'COMODATO_RETURN'] },
        },
        include: {
          serialItem: { include: { product: true, location: true } },
          createdBy: { select: { firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return movements;
    }

    // Default: só os atualmente alocados (SerialItem.contractId == contractId).
    return this.prisma.serialItem.findMany({
      where: {
        tenantId,
        contractId,
        status: 'ALLOCATED',
      },
      include: {
        product: { select: { id: true, sku: true, name: true, brand: true, model: true } },
      },
      orderBy: { allocatedAt: 'desc' },
    });
  }

  /**
   * Lista seriais DISPONÍVEIS pra comodato (status=IN_STOCK + product=PATRIMONIAL).
   * Filtra pelos locais que o operador tem acesso (ACL).
   *
   * `productId` opcional — se passado, restringe ao produto específico.
   */
  async listAvailable(
    tenantId: string,
    userId: string,
    options: { productId?: string; isAdmin?: boolean } = {},
  ) {
    // Pega lista de locais que o user pode ver (admin vê todos)
    let locationIds: string[] | undefined;
    if (!options.isAdmin) {
      const locs = await this.prisma.stockLocationUser.findMany({
        where: { userId },
        select: { locationId: true },
      });
      locationIds = locs.map((l) => l.locationId);
      if (locationIds.length === 0) {
        // User sem nenhum acesso a local → ele NUNCA vê seriais (a menos que admin)
        return [];
      }
    }

    return this.prisma.serialItem.findMany({
      where: {
        tenantId,
        status: 'IN_STOCK',
        product: { type: 'PATRIMONIAL' },
        ...(options.productId ? { productId: options.productId } : {}),
        ...(locationIds ? { locationId: { in: locationIds } } : {}),
      },
      include: {
        product: { select: { id: true, sku: true, name: true } },
        location: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ product: { name: 'asc' } }, { serial: 'asc' }],
      take: 500,
    });
  }

  // ---------------------------------------------------------------------------
  // MUTATIONS
  // ---------------------------------------------------------------------------

  /**
   * Aloca um serial específico a um contrato. Idempotência: se já tá alocado
   * NESSE contrato, retorna sem erro. Se tá alocado em OUTRO contrato, falha
   * (operador precisa devolver primeiro).
   */
  async allocate(
    tenantId: string,
    actorUserId: string,
    input: { contractId: string; serialItemId: string; notes?: string | null },
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Confere contrato (mesmo tenant, não cancelado)
      const contract = await tx.contract.findFirst({
        where: { id: input.contractId, tenantId, deletedAt: null },
        select: { id: true, status: true, customerId: true },
      });
      if (!contract) throw new NotFoundException('Contrato não encontrado');
      if (contract.status === 'CANCELLED') {
        throw new ConflictException(
          'Não dá pra alocar equipamento a contrato cancelado',
        );
      }

      // 2. Confere serial (mesmo tenant, patrimonial)
      const serial = await tx.serialItem.findFirst({
        where: { id: input.serialItemId, tenantId },
        include: { product: { select: { type: true, name: true } } },
      });
      if (!serial) throw new NotFoundException('Serial não encontrado');
      if (serial.product.type !== 'PATRIMONIAL') {
        throw new BadRequestException(
          `Produto ${serial.product.name} não é patrimonial — não pode ser alocado`,
        );
      }

      // 3. Estado válido pra alocar?
      if (serial.status === 'ALLOCATED') {
        if (serial.contractId === input.contractId) {
          // Idempotente — já está alocado nesse contrato, ok
          return serial;
        }
        throw new ConflictException(
          `Serial ${serial.serial} já está alocado em outro contrato — devolva primeiro`,
        );
      }
      if (serial.status !== 'IN_STOCK') {
        throw new BadRequestException(
          `Serial em status ${serial.status} não pode ser alocado (esperado IN_STOCK)`,
        );
      }
      if (!serial.locationId) {
        throw new BadRequestException(
          'Serial está em IN_STOCK mas sem localização — corrija o estado primeiro',
        );
      }

      // 4. Custo do movimento — usa acquisitionCost se houver, senão Product.cost
      const product = await tx.product.findUnique({
        where: { id: serial.productId },
        select: { cost: true },
      });
      const unitCost = Number(serial.acquisitionCost ?? product?.cost ?? 0);

      // 5. Atualiza serial: ALLOCATED, contractId setado, locationId = null
      //    (sai do local físico, está "com cliente")
      const updated = await tx.serialItem.update({
        where: { id: serial.id },
        data: {
          status: 'ALLOCATED',
          contractId: input.contractId,
          locationId: null,
          allocatedAt: new Date(),
          returnedAt: null,
        },
      });

      // 6. StockMovement(COMODATO_OUT)
      await tx.stockMovement.create({
        data: {
          tenantId,
          type: 'COMODATO_OUT',
          productId: serial.productId,
          serialItemId: serial.id,
          fromLocationId: serial.locationId, // saiu deste local
          toLocationId: null,                 // não foi pra local físico (foi pro cliente)
          quantity: 1,
          unitCost,
          totalCost: unitCost,
          contractId: input.contractId,
          notes: input.notes ?? null,
          createdById: actorUserId,
        },
      });

      // 7. Audit
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'comodato.allocated',
        resource: 'serial_items',
        resourceId: serial.id,
        afterState: {
          serial: serial.serial,
          contractId: input.contractId,
          unitCost,
        },
      });

      return updated;
    });
  }

  /**
   * Materializa como PATRIMÔNIO um equipamento em comodato JÁ INSTALADO no
   * cliente, descoberto pela integração (OLT + Hubsoft) — NÃO passou pelo
   * estoque do NetX. Diferente de `allocate()` (que exige um SerialItem IN_STOCK
   * pré-existente num local), aqui o bem é criado "como-encontrado" direto em
   * ALLOCATED, vinculado ao contrato, sem local físico. Idempotente por
   * (tenant, produto, serial): re-rodar a materialização não duplica.
   *
   * Product: 1 por (vendor, modelo) da ONU — SKU estável `ONU-<VENDOR>-<MODELO>`
   * (ou `ONU-COMODATO-HS<idProduto>` quando não há modelo), type PATRIMONIAL.
   * O `id_produto` do Hubsoft fica na descrição pra rastreio. Não inventamos
   * custo (acquisitionCost null) — é bem herdado, não comprado pelo NetX.
   */
  async materializeAsFoundComodato(
    tenantId: string,
    actorUserId: string,
    input: {
      contractId: string;
      serial: string;
      macAddress?: string | null;
      hubsoftProdutoId?: string | null;
      vendor?: string | null; // prefixo/fabricante da ONU (ex.: "PARKS", "NOKIA")
      model?: string | null; // modelo reportado pela OLT (ex.: "HG260")
    },
  ): Promise<{ serialItemId: string; created: boolean }> {
    const serial = input.serial.trim();
    if (!serial) throw new BadRequestException('Serial vazio');

    return this.prisma.$transaction(async (tx) => {
      // 1) Produto (idempotente por SKU). Identidade estável por vendor+modelo.
      const vendor = (input.vendor ?? '').trim().toUpperCase() || 'ONU';
      const model = (input.model ?? '').trim().toUpperCase();
      const sku = model
        ? `ONU-${vendor}-${model}`.slice(0, 64)
        : `ONU-COMODATO-HS${(input.hubsoftProdutoId ?? 'NA').toString().trim()}`.slice(0, 64);
      const name = model ? `ONU ${vendor} ${model}` : `ONU ${vendor} (comodato Hubsoft)`;

      let product = await tx.product.findFirst({
        where: { tenantId, sku },
        select: { id: true },
      });
      if (!product) {
        product = await tx.product.create({
          data: {
            tenantId,
            sku,
            name: name.slice(0, 255),
            brand: vendor.slice(0, 120),
            model: model ? model.slice(0, 120) : null,
            type: 'PATRIMONIAL',
            description: input.hubsoftProdutoId
              ? `Materializado do comodato Hubsoft (id_produto ${input.hubsoftProdutoId}).`
              : 'Materializado do comodato Hubsoft.',
          },
          select: { id: true },
        });
      }

      // 2) SerialItem (idempotente por tenant+produto+serial). Se já existe,
      //    garante o vínculo com o contrato (sem quebrar um vínculo pré-existente
      //    a OUTRO contrato — nesse caso não mexe, deixa pra revisão manual).
      const existing = await tx.serialItem.findFirst({
        where: { tenantId, productId: product.id, serial },
        select: { id: true, status: true, contractId: true },
      });
      if (existing) {
        if (existing.contractId && existing.contractId !== input.contractId) {
          // Conflito real — outro contrato já reivindica este serial. Não força.
          return { serialItemId: existing.id, created: false };
        }
        if (existing.status !== 'ALLOCATED' || existing.contractId !== input.contractId) {
          await tx.serialItem.update({
            where: { id: existing.id },
            data: {
              status: 'ALLOCATED',
              contractId: input.contractId,
              locationId: null,
              allocatedAt: existing.contractId ? undefined : new Date(),
            },
          });
        }
        return { serialItemId: existing.id, created: false };
      }

      const created = await tx.serialItem.create({
        data: {
          tenantId,
          productId: product.id,
          serial,
          status: 'ALLOCATED',
          contractId: input.contractId,
          locationId: null,
          allocatedAt: new Date(),
          notes:
            'Comodato materializado da descoberta OLT↔Hubsoft (equipamento já ' +
            'instalado no cliente — não passou pelo estoque do NetX).' +
            (input.macAddress ? ` MAC ${input.macAddress}.` : ''),
        },
        select: { id: true },
      });

      // 3) Movimento COMODATO_OUT "como-encontrado" (from/to null: não saiu de
      //    local físico do NetX). Custo 0 — bem herdado, não comprado.
      await tx.stockMovement.create({
        data: {
          tenantId,
          type: 'COMODATO_OUT',
          productId: product.id,
          serialItemId: created.id,
          fromLocationId: null,
          toLocationId: null,
          quantity: 1,
          unitCost: 0,
          totalCost: 0,
          contractId: input.contractId,
          notes: 'Materialização de comodato existente (descoberta OLT↔Hubsoft).',
          createdById: actorUserId,
        },
      });

      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'comodato.materialized',
        resource: 'serial_items',
        resourceId: created.id,
        afterState: { serial, contractId: input.contractId, productSku: sku },
      });

      return { serialItemId: created.id, created: true };
    });
  }

  /**
   * Devolve um serial alocado — volta pra estoque no local especificado.
   * O operador precisa ter acesso de escrita no `toLocationId`.
   */
  async returnItem(
    tenantId: string,
    actorUserId: string,
    input: { serialItemId: string; toLocationId: string; notes?: string | null },
    options: { isAdmin?: boolean; skipOntLinkGuard?: boolean } = {},
  ) {
    // Pré-check de ACL fora da transaction (mais barato).
    // Admin bypassa; demais usuários precisam ter canWrite=true no local.
    // `assertCanWrite` lança ForbiddenException se faltar.
    if (!options.isAdmin) {
      await this.locations.assertCanWrite(tenantId, actorUserId, input.toLocationId);
    }

    return this.prisma.$transaction(async (tx) => {
      const serial = await tx.serialItem.findFirst({
        where: { id: input.serialItemId, tenantId },
        include: { product: { select: { type: true } } },
      });
      if (!serial) throw new NotFoundException('Serial não encontrado');
      if (serial.status !== 'ALLOCATED') {
        throw new BadRequestException(
          `Serial em status ${serial.status} não pode ser devolvido (esperado ALLOCATED)`,
        );
      }
      if (!serial.contractId) {
        throw new BadRequestException(
          'Serial em ALLOCATED mas sem contractId — estado inconsistente',
        );
      }

      // Guarda-rail: bloqueia devolver avulsa uma ONT que ainda é a ONT
      // PROVISIONADA do contrato (Ont.snGpon == serial). Devolver só o item de
      // estoque deixaria a Ont row + Tr069Device apontando pro equipamento
      // antigo — o TR-069 não atualiza e o contrato fica inconsistente. A troca
      // correta passa pelo swapOnt (que repassa skipOntLinkGuard=true).
      if (!options.skipOntLinkGuard) {
        const linkedOnt = await tx.ont.findFirst({
          where: {
            tenantId,
            contractId: serial.contractId,
            snGpon: { equals: serial.serial, mode: 'insensitive' },
          },
          select: { id: true },
        });
        if (linkedOnt) {
          throw new ConflictException(
            'Esta ONT está provisionada e vinculada ao contrato no TR-069. ' +
              'Para trocar o equipamento use "Trocar ONT" no contrato (ou a O.S de ' +
              'troca) — esse fluxo devolve a antiga e atualiza o provisionamento. ' +
              'A devolução avulsa deixaria o contrato inconsistente.',
          );
        }
      }

      // Confere que o local existe (e é mesmo tenant)
      const location = await tx.stockLocation.findFirst({
        where: { id: input.toLocationId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!location) throw new NotFoundException('Local destino não encontrado');

      const product = await tx.product.findUnique({
        where: { id: serial.productId },
        select: { cost: true },
      });
      const unitCost = Number(serial.acquisitionCost ?? product?.cost ?? 0);

      const originalContractId = serial.contractId;

      // Atualiza serial: IN_STOCK no local destino, sem contractId
      const updated = await tx.serialItem.update({
        where: { id: serial.id },
        data: {
          status: 'IN_STOCK',
          contractId: null,
          locationId: input.toLocationId,
          returnedAt: new Date(),
        },
      });

      // StockMovement(COMODATO_RETURN)
      await tx.stockMovement.create({
        data: {
          tenantId,
          type: 'COMODATO_RETURN',
          productId: serial.productId,
          serialItemId: serial.id,
          fromLocationId: null,                  // veio do cliente
          toLocationId: input.toLocationId,      // entrou neste local
          quantity: 1,
          unitCost,
          totalCost: unitCost,
          contractId: originalContractId,        // preserva referência ao contrato origem
          notes: input.notes ?? null,
          createdById: actorUserId,
        },
      });

      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'comodato.returned',
        resource: 'serial_items',
        resourceId: serial.id,
        afterState: {
          serial: serial.serial,
          fromContractId: originalContractId,
          toLocationId: input.toLocationId,
        },
      });

      return updated;
    });
  }
}

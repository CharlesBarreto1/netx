import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ProductType } from '@prisma/client';
import {
  AddOsConsumptionRequestSchema,
  AddPurchaseSerialsRequestSchema,
  AllocateComodatoRequestSchema,
  ChangeSerialStatusRequestSchema,
  CreateAdjustmentRequestSchema,
  CreatePurchaseRequestSchema,
  CreateProductRequestSchema,
  CreateStockLocationRequestSchema,
  CreateSupplierRequestSchema,
  CreateStockTransferRequestSchema,
  ListSerialItemsQuerySchema,
  ListStockMovementsQuerySchema,
  RenameSerialRequestSchema,
  StockReportQuerySchema,
  ReturnComodatoRequestSchema,
  DeployAssetRequestSchema,
  ReturnDeployedAssetRequestSchema,
  SetLocationAccessRequestSchema,
  UpdateProductRequestSchema,
  UpdatePurchaseRequestSchema,
  UpdateStockLocationRequestSchema,
  UpdateSupplierRequestSchema,
  type AddOsConsumptionRequest,
  type AddPurchaseSerialsRequest,
  type AllocateComodatoRequest,
  type AuthenticatedPrincipal,
  type ChangeSerialStatusRequest,
  type CreateAdjustmentRequest,
  type CreatePurchaseRequest,
  type CreateProductRequest,
  type CreateStockLocationRequest,
  type CreateSupplierRequest,
  type CreateStockTransferRequest,
  type ListSerialItemsQuery,
  type ListStockMovementsQuery,
  type RenameSerialRequest,
  type StockReportQuery,
  type ReturnComodatoRequest,
  type DeployAssetRequest,
  type ReturnDeployedAssetRequest,
  type SetLocationAccessRequest,
  type UpdateProductRequest,
  type UpdatePurchaseRequest,
  type UpdateStockLocationRequest,
  type UpdateSupplierRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';

import { ComodatoService } from './comodato.service';
import { DeploymentService } from './deployment.service';
import { OsConsumptionService } from './os-consumption.service';
import { ProductsService } from './products.service';
import { PurchasesService } from './purchases.service';
import { StockLocationsService } from './stock-locations.service';
import { StockMovementsService } from './stock-movements.service';
import { SerialItemsService } from './serial-items.service';
import { SuppliersService } from './suppliers.service';

// ─────────────────────────────────────────────────────────────────────────────
// SUPPLIERS — /v1/stock/suppliers
// ─────────────────────────────────────────────────────────────────────────────
@ApiTags('stock')
@ApiBearerAuth()
@Controller('stock/suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermissions('stock.read')
  list(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.suppliers.list(u.tenantId, {
      search,
      isActive: isActive === undefined ? undefined : isActive === 'true',
    });
  }

  @Get(':id')
  @RequirePermissions('stock.read')
  findById(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.suppliers.findById(u.tenantId, id);
  }

  @Post()
  @RequirePermissions('stock.write')
  create(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateSupplierRequestSchema) body: CreateSupplierRequest,
  ) {
    return this.suppliers.create(u.tenantId, u.sub, body);
  }

  @Patch(':id')
  @RequirePermissions('stock.write')
  update(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateSupplierRequestSchema) body: UpdateSupplierRequest,
  ) {
    return this.suppliers.update(u.tenantId, u.sub, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('stock.delete')
  async remove(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.suppliers.remove(u.tenantId, u.sub, id);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTS — /v1/stock/products
// ─────────────────────────────────────────────────────────────────────────────
@ApiTags('stock')
@ApiBearerAuth()
@Controller('stock/products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions('stock.read')
  list(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.products.list(u.tenantId, {
      search,
      type: type ? (type.toUpperCase() as ProductType) : undefined,
      isActive: isActive === undefined ? undefined : isActive === 'true',
    });
  }

  @Get(':id')
  @RequirePermissions('stock.read')
  findById(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.products.findById(u.tenantId, id);
  }

  @Post()
  @RequirePermissions('stock.write')
  create(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateProductRequestSchema) body: CreateProductRequest,
  ) {
    return this.products.create(u.tenantId, u.sub, body);
  }

  @Patch(':id')
  @RequirePermissions('stock.write')
  update(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateProductRequestSchema) body: UpdateProductRequest,
  ) {
    return this.products.update(u.tenantId, u.sub, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('stock.delete')
  async remove(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.products.remove(u.tenantId, u.sub, id);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STOCK LOCATIONS — /v1/stock/locations
// ─────────────────────────────────────────────────────────────────────────────
@ApiTags('stock')
@ApiBearerAuth()
@Controller('stock/locations')
export class StockLocationsController {
  constructor(private readonly locations: StockLocationsService) {}

  // listAll: admin (ou role com stock.admin) vê todos.
  // listMine: operador vê só os locais aos quais tem acesso.
  @Get()
  @RequirePermissions('stock.read')
  list(@CurrentUser() u: AuthenticatedPrincipal) {
    // Se tem `stock.admin`, mostra tudo; senão filtra por user.
    if (u.permissions.includes('stock.admin') || u.permissions.includes('*')) {
      return this.locations.listAll(u.tenantId);
    }
    return this.locations.listForUser(u.tenantId, u.sub);
  }

  @Get(':id')
  @RequirePermissions('stock.read')
  findById(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.locations.findById(u.tenantId, id);
  }

  @Post()
  @RequirePermissions('stock.admin')
  create(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateStockLocationRequestSchema) body: CreateStockLocationRequest,
  ) {
    return this.locations.create(u.tenantId, u.sub, body);
  }

  @Patch(':id')
  @RequirePermissions('stock.admin')
  update(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateStockLocationRequestSchema) body: UpdateStockLocationRequest,
  ) {
    return this.locations.update(u.tenantId, u.sub, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('stock.admin')
  async remove(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.locations.remove(u.tenantId, u.sub, id);
  }

  // ACL granular — substitui access list do local.
  @Post(':id/access')
  @RequirePermissions('stock.admin')
  setAccess(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(SetLocationAccessRequestSchema) body: SetLocationAccessRequest,
  ) {
    return this.locations.setAccess(u.tenantId, u.sub, id, body);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PURCHASES — /v1/stock/purchases
// ─────────────────────────────────────────────────────────────────────────────
@ApiTags('stock')
@ApiBearerAuth()
@Controller('stock/purchases')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  @RequirePermissions('stock.read')
  list(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query('supplierId') supplierId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.purchases.list(u.tenantId, { supplierId, dateFrom, dateTo });
  }

  @Get(':id')
  @RequirePermissions('stock.read')
  findById(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.purchases.findById(u.tenantId, id);
  }

  /** Trilha de auditoria da compra (criação, edições, com before/after). */
  @Get(':id/audit')
  @RequirePermissions('stock.read')
  auditTrail(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.purchases.auditTrail(u.tenantId, id);
  }

  @Post()
  @RequirePermissions('stock.purchase.create')
  create(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreatePurchaseRequestSchema) body: CreatePurchaseRequest,
  ) {
    const isManager = u.permissions.includes('cash_registers.manage');
    return this.purchases.create(u.tenantId, u.sub, body, isManager);
  }

  /**
   * Edita (substitui) uma compra lançada errada — reverte a versão antiga e
   * reaplica os itens novos numa transação. Só funciona se nada da compra
   * original foi movimentado (mesmas travas do delete).
   */
  @Patch(':id')
  @RequirePermissions('stock.purchase.update')
  update(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdatePurchaseRequestSchema) body: UpdatePurchaseRequest,
  ) {
    const isManager = u.permissions.includes('cash_registers.manage');
    return this.purchases.update(u.tenantId, u.sub, id, body, isManager);
  }

  /** Exclui (reverte) uma compra lançada errada — só se nada foi movimentado. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('stock.purchase.delete')
  async remove(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.purchases.delete(u.tenantId, u.sub, id);
  }

  // ── Seriais de uma linha PATRIMONIAL (entrada incremental) ─────────────────

  /** Lista os seriais já cadastrados numa linha (com status/local). */
  @Get(':id/items/:itemId/serials')
  @RequirePermissions('stock.read')
  listItemSerials(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
  ) {
    return this.purchases.listItemSerials(u.tenantId, id, itemId);
  }

  /** Adiciona um lote de seriais a uma linha PATRIMONIAL já lançada. */
  @Post(':id/items/:itemId/serials')
  @RequirePermissions('stock.purchase.update')
  addSerials(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @ZodBody(AddPurchaseSerialsRequestSchema) body: AddPurchaseSerialsRequest,
  ) {
    return this.purchases.addSerials(u.tenantId, u.sub, id, itemId, body.serials);
  }

  /** Remove um serial adicionado por engano (só se ainda IN_STOCK, intocado). */
  @Delete(':id/items/:itemId/serials/:serialItemId')
  @RequirePermissions('stock.purchase.update')
  removeSerial(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Param('serialItemId', new ParseUUIDPipe()) serialItemId: string,
  ) {
    return this.purchases.removeSerial(u.tenantId, u.sub, id, itemId, serialItemId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STOCK MOVEMENTS (kardex) + ajustes + transfers
// /v1/stock/movements
// /v1/stock/adjustments
// /v1/stock/transfers
// ─────────────────────────────────────────────────────────────────────────────
@ApiTags('stock')
@ApiBearerAuth()
@Controller('stock')
export class StockMovementsController {
  constructor(private readonly movements: StockMovementsService) {}

  @Get('movements')
  @RequirePermissions('stock.read')
  list(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query() query: Record<string, string>,
  ) {
    const parsed = ListStockMovementsQuerySchema.parse(query) as ListStockMovementsQuery;
    return this.movements.listKardex(u.tenantId, parsed);
  }

  @Post('adjustments')
  @RequirePermissions('stock.adjust')
  adjust(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateAdjustmentRequestSchema) body: CreateAdjustmentRequest,
  ) {
    return this.movements.adjust(u.tenantId, u.sub, body);
  }

  @Post('transfers')
  @RequirePermissions('stock.write')
  transfer(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateStockTransferRequestSchema) body: CreateStockTransferRequest,
  ) {
    return this.movements.transfer(u.tenantId, u.sub, body);
  }

  /** Reverte um ajuste de inventário ou consumo em O.S lançado errado. */
  @Delete('movements/:id')
  @HttpCode(204)
  @RequirePermissions('stock.adjust')
  async reverseMovement(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.movements.reverseMovement(u.tenantId, u.sub, id);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SERIAL ITEMS (patrimônios) — /v1/stock/serial-items
// ─────────────────────────────────────────────────────────────────────────────
@ApiTags('stock')
@ApiBearerAuth()
@Controller('stock/serial-items')
export class SerialItemsController {
  constructor(private readonly serials: SerialItemsService) {}

  /** Lista patrimônios com busca por serial + filtro de status/local/produto. */
  @Get()
  @RequirePermissions('stock.read')
  list(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query() query: Record<string, string>,
  ) {
    const parsed = ListSerialItemsQuerySchema.parse(query) as ListSerialItemsQuery;
    return this.serials.list(u.tenantId, parsed);
  }

  /** Relatório agregado (totais + por produto/status) + detalhe pra export. */
  @Get('report')
  @RequirePermissions('stock.read')
  report(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query() query: Record<string, string>,
  ) {
    const parsed = StockReportQuerySchema.parse(query) as StockReportQuery;
    return this.serials.report(u.tenantId, parsed);
  }

  /** Histórico (timeline) do equipamento: compra, transferências, comodato… */
  @Get(':id/history')
  @RequirePermissions('stock.read')
  history(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.serials.history(u.tenantId, id);
  }

  /**
   * Muda o status de um patrimônio: defeito/baixa/venda/inutilização
   * (descontabiliza) ou reativação (volta ao estoque). Permissão de ajuste.
   */
  @Patch(':id/status')
  @RequirePermissions('stock.adjust')
  changeStatus(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(ChangeSerialStatusRequestSchema) body: ChangeSerialStatusRequest,
  ) {
    return this.serials.changeStatus(u.tenantId, u.sub, id, body);
  }

  /**
   * Corrige o serial (erro de digitação) de um patrimônio. Não movimenta
   * estoque, então funciona mesmo com o item já em comodato.
   */
  @Patch(':id/serial')
  @RequirePermissions('stock.adjust')
  renameSerial(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(RenameSerialRequestSchema) body: RenameSerialRequest,
  ) {
    return this.serials.renameSerial(u.tenantId, u.sub, id, body.serial);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMODATO — /v1/stock/comodato
// ─────────────────────────────────────────────────────────────────────────────
// Endpoints:
//   GET    /v1/stock/comodato/contracts/:contractId   → seriais alocados nesse contrato
//   GET    /v1/stock/comodato/available?productId=:id → seriais IN_STOCK disponíveis
//   POST   /v1/stock/comodato/allocate                → aloca serial a contrato
//   POST   /v1/stock/comodato/return                  → devolve serial pro estoque
@ApiTags('stock')
@ApiBearerAuth()
@Controller('stock/comodato')
export class ComodatoController {
  constructor(private readonly comodato: ComodatoService) {}

  @Get('contracts/:contractId')
  @RequirePermissions('contracts.read', 'stock.read')
  listByContract(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
    @Query('includeReturned') includeReturned?: string,
  ) {
    return this.comodato.listByContract(u.tenantId, contractId, {
      includeReturned: includeReturned === 'true' || includeReturned === '1',
    });
  }

  @Get('available')
  @RequirePermissions('stock.read')
  listAvailable(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query('productId') productId?: string,
  ) {
    return this.comodato.listAvailable(u.tenantId, u.sub, {
      productId,
      isAdmin: u.permissions.includes('stock.admin'),
    });
  }

  @Post('allocate')
  @RequirePermissions('contracts.write', 'stock.write')
  allocate(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(AllocateComodatoRequestSchema) body: AllocateComodatoRequest,
  ) {
    return this.comodato.allocate(u.tenantId, u.sub, body);
  }

  @Post('return')
  @RequirePermissions('stock.write')
  returnItem(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(ReturnComodatoRequestSchema) body: ReturnComodatoRequest,
  ) {
    return this.comodato.returnItem(u.tenantId, u.sub, body, {
      isAdmin: u.permissions.includes('stock.admin'),
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DEPLOY — bem instalado na rede PRÓPRIA (irmão do comodato, destino diferente)
//   GET    /v1/stock/deploy/pops/:popId  → bens instalados neste POP
//   GET    /v1/stock/deploy/available    → bens IN_STOCK prontos pra instalar
//   POST   /v1/stock/deploy              → instala bem no POP/equipamento
//   POST   /v1/stock/deploy/return       → recolhe bem de volta pro estoque
@ApiTags('stock')
@ApiBearerAuth()
@Controller('stock/deploy')
export class DeploymentController {
  constructor(private readonly deployment: DeploymentService) {}

  @Get('pops/:popId')
  @RequirePermissions('network.read', 'stock.read')
  listByPop(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('popId', new ParseUUIDPipe()) popId: string,
  ) {
    return this.deployment.listByPop(u.tenantId, popId);
  }

  @Get('available')
  @RequirePermissions('stock.read')
  listAvailable(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query('productId') productId?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.deployment.listAvailable(u.tenantId, { productId, locationId });
  }

  @Post()
  @RequirePermissions('network.write', 'stock.write')
  deploy(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(DeployAssetRequestSchema) body: DeployAssetRequest,
  ) {
    return this.deployment.deploy(u.tenantId, u.sub, body);
  }

  @Post('return')
  @RequirePermissions('network.write', 'stock.write')
  returnAsset(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(ReturnDeployedAssetRequestSchema) body: ReturnDeployedAssetRequest,
  ) {
    return this.deployment.returnToStock(u.tenantId, u.sub, body, {
      isAdmin: u.permissions.includes('stock.admin'),
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OS CONSUMPTION — /v1/service-orders/:id/consumption
// ─────────────────────────────────────────────────────────────────────────────
// Endpoints:
//   GET    /v1/service-orders/:id/consumption  → lista materiais consumidos
//   POST   /v1/service-orders/:id/consumption  → adiciona consumo (técnico)
@ApiTags('stock')
@ApiBearerAuth()
@Controller('service-orders/:id/consumption')
export class OsConsumptionController {
  constructor(private readonly consumption: OsConsumptionService) {}

  @Get()
  @RequirePermissions('service_orders.read', 'stock.read')
  list(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) serviceOrderId: string,
  ) {
    return this.consumption.listByServiceOrder(u.tenantId, serviceOrderId);
  }

  @Post()
  @RequirePermissions('service_orders.write', 'stock.adjust')
  add(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) serviceOrderId: string,
    @ZodBody(AddOsConsumptionRequestSchema) body: AddOsConsumptionRequest,
  ) {
    return this.consumption.addConsumption(
      u.tenantId,
      u.sub,
      { serviceOrderId, items: body.items },
      { isAdmin: u.permissions.includes('stock.admin') },
    );
  }
}

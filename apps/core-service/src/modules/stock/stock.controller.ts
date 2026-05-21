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
  AllocateComodatoRequestSchema,
  CreateAdjustmentRequestSchema,
  CreatePurchaseRequestSchema,
  CreateProductRequestSchema,
  CreateStockLocationRequestSchema,
  CreateSupplierRequestSchema,
  CreateStockTransferRequestSchema,
  ListStockMovementsQuerySchema,
  ReturnComodatoRequestSchema,
  SetLocationAccessRequestSchema,
  UpdateProductRequestSchema,
  UpdateStockLocationRequestSchema,
  UpdateSupplierRequestSchema,
  type AddOsConsumptionRequest,
  type AllocateComodatoRequest,
  type AuthenticatedPrincipal,
  type CreateAdjustmentRequest,
  type CreatePurchaseRequest,
  type CreateProductRequest,
  type CreateStockLocationRequest,
  type CreateSupplierRequest,
  type CreateStockTransferRequest,
  type ListStockMovementsQuery,
  type ReturnComodatoRequest,
  type SetLocationAccessRequest,
  type UpdateProductRequest,
  type UpdateStockLocationRequest,
  type UpdateSupplierRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';

import { ComodatoService } from './comodato.service';
import { OsConsumptionService } from './os-consumption.service';
import { ProductsService } from './products.service';
import { PurchasesService } from './purchases.service';
import { StockLocationsService } from './stock-locations.service';
import { StockMovementsService } from './stock-movements.service';
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

  @Post()
  @RequirePermissions('stock.purchase.create')
  create(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreatePurchaseRequestSchema) body: CreatePurchaseRequest,
  ) {
    return this.purchases.create(u.tenantId, u.sub, body);
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

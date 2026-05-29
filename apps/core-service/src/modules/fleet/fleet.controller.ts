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
import {
  CreateDriverRequestSchema,
  CreateFleetExpenseRequestSchema,
  CreateMaintenancePlanRequestSchema,
  CreateMaintenanceRecordRequestSchema,
  CreateVehicleRequestSchema,
  ListDriversQuerySchema,
  ListFleetExpensesQuerySchema,
  ListMaintenancePlansQuerySchema,
  ListMaintenanceRecordsQuerySchema,
  ListVehiclesQuerySchema,
  UpdateDriverRequestSchema,
  UpdateFleetExpenseRequestSchema,
  UpdateMaintenancePlanRequestSchema,
  UpdateVehicleRequestSchema,
  type AuthenticatedPrincipal,
  type CreateDriverRequest,
  type CreateFleetExpenseRequest,
  type CreateMaintenancePlanRequest,
  type CreateMaintenanceRecordRequest,
  type CreateVehicleRequest,
  type UpdateDriverRequest,
  type UpdateFleetExpenseRequest,
  type UpdateMaintenancePlanRequest,
  type UpdateVehicleRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';

import { DriversService } from './drivers.service';
import { FleetExpensesService } from './fleet-expenses.service';
import { FleetLiveService } from './fleet-live.service';
import { MaintenanceService } from './maintenance.service';
import { VehiclesService } from './vehicles.service';

// ─────────────────────────────────────────────────────────────────────────────
// VEÍCULOS — /v1/fleet/vehicles
// ─────────────────────────────────────────────────────────────────────────────
@ApiTags('fleet')
@ApiBearerAuth()
@Controller('fleet/vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  @RequirePermissions('fleet.read')
  list(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query() query: Record<string, string>,
  ) {
    return this.vehicles.list(u.tenantId, ListVehiclesQuerySchema.parse(query));
  }

  @Get(':id')
  @RequirePermissions('fleet.read')
  findById(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.vehicles.findById(u.tenantId, id);
  }

  @Post()
  @RequirePermissions('fleet.write')
  create(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateVehicleRequestSchema) body: CreateVehicleRequest,
  ) {
    return this.vehicles.create(u.tenantId, u.sub, body);
  }

  @Patch(':id')
  @RequirePermissions('fleet.write')
  update(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateVehicleRequestSchema) body: UpdateVehicleRequest,
  ) {
    return this.vehicles.update(u.tenantId, u.sub, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('fleet.delete')
  async remove(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.vehicles.remove(u.tenantId, u.sub, id);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MOTORISTAS — /v1/fleet/drivers
// ─────────────────────────────────────────────────────────────────────────────
@ApiTags('fleet')
@ApiBearerAuth()
@Controller('fleet/drivers')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Get()
  @RequirePermissions('fleet.read')
  list(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query() query: Record<string, string>,
  ) {
    return this.drivers.list(u.tenantId, ListDriversQuerySchema.parse(query));
  }

  @Get(':id')
  @RequirePermissions('fleet.read')
  findById(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.drivers.findById(u.tenantId, id);
  }

  @Post()
  @RequirePermissions('fleet.write')
  create(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateDriverRequestSchema) body: CreateDriverRequest,
  ) {
    return this.drivers.create(u.tenantId, u.sub, body);
  }

  @Patch(':id')
  @RequirePermissions('fleet.write')
  update(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateDriverRequestSchema) body: UpdateDriverRequest,
  ) {
    return this.drivers.update(u.tenantId, u.sub, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('fleet.delete')
  async remove(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.drivers.remove(u.tenantId, u.sub, id);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DESPESAS — /v1/fleet/expenses
// ─────────────────────────────────────────────────────────────────────────────
@ApiTags('fleet')
@ApiBearerAuth()
@Controller('fleet/expenses')
export class FleetExpensesController {
  constructor(private readonly expenses: FleetExpensesService) {}

  @Get()
  @RequirePermissions('fleet.read')
  list(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query() query: Record<string, string>,
  ) {
    return this.expenses.list(u.tenantId, ListFleetExpensesQuerySchema.parse(query));
  }

  @Get(':id')
  @RequirePermissions('fleet.read')
  findById(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.expenses.findById(u.tenantId, id);
  }

  @Post()
  @RequirePermissions('fleet.expense.create')
  create(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateFleetExpenseRequestSchema) body: CreateFleetExpenseRequest,
  ) {
    return this.expenses.create(u.tenantId, u.sub, body);
  }

  @Patch(':id')
  @RequirePermissions('fleet.expense.create')
  update(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateFleetExpenseRequestSchema) body: UpdateFleetExpenseRequest,
  ) {
    return this.expenses.update(u.tenantId, u.sub, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('fleet.expense.create')
  async remove(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.expenses.remove(u.tenantId, u.sub, id);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MANUTENÇÕES — /v1/fleet/maintenance/{plans,records}
// ─────────────────────────────────────────────────────────────────────────────
@ApiTags('fleet')
@ApiBearerAuth()
@Controller('fleet/maintenance')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  // ---- PLANS (preventiva) ----
  @Get('plans')
  @RequirePermissions('fleet.read')
  listPlans(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query() query: Record<string, string>,
  ) {
    return this.maintenance.listPlans(u.tenantId, ListMaintenancePlansQuerySchema.parse(query));
  }

  @Get('plans/:id')
  @RequirePermissions('fleet.read')
  findPlan(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.maintenance.findPlan(u.tenantId, id);
  }

  @Post('plans')
  @RequirePermissions('fleet.maintenance.manage')
  createPlan(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateMaintenancePlanRequestSchema) body: CreateMaintenancePlanRequest,
  ) {
    return this.maintenance.createPlan(u.tenantId, u.sub, body);
  }

  @Patch('plans/:id')
  @RequirePermissions('fleet.maintenance.manage')
  updatePlan(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateMaintenancePlanRequestSchema) body: UpdateMaintenancePlanRequest,
  ) {
    return this.maintenance.updatePlan(u.tenantId, u.sub, id, body);
  }

  @Delete('plans/:id')
  @HttpCode(204)
  @RequirePermissions('fleet.maintenance.manage')
  async removePlan(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.maintenance.removePlan(u.tenantId, u.sub, id);
  }

  // ---- RECORDS (executada) ----
  @Get('records')
  @RequirePermissions('fleet.read')
  listRecords(
    @CurrentUser() u: AuthenticatedPrincipal,
    @Query() query: Record<string, string>,
  ) {
    return this.maintenance.listRecords(
      u.tenantId,
      ListMaintenanceRecordsQuerySchema.parse(query),
    );
  }

  @Post('records')
  @RequirePermissions('fleet.maintenance.manage')
  createRecord(
    @CurrentUser() u: AuthenticatedPrincipal,
    @ZodBody(CreateMaintenanceRecordRequestSchema) body: CreateMaintenanceRecordRequest,
  ) {
    return this.maintenance.createRecord(u.tenantId, u.sub, body);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AO VIVO — /v1/fleet/live/positions
// ─────────────────────────────────────────────────────────────────────────────
@ApiTags('fleet')
@ApiBearerAuth()
@Controller('fleet/live')
export class FleetLiveController {
  constructor(private readonly live: FleetLiveService) {}

  @Get('positions')
  @RequirePermissions('fleet.live.read')
  positions(@CurrentUser() u: AuthenticatedPrincipal) {
    return this.live.getLivePositions(u.tenantId);
  }
}

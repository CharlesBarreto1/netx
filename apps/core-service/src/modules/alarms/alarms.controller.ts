/**
 * /v1/alarms — Central de Alarmes CPE/OLT.
 *   GET  /alarms/incidents              — lista incidents correlacionados
 *   GET  /alarms/incidents/:id          — detalhe
 *   POST /alarms/incidents/:id/ack      — reconhecer
 *   POST /alarms/incidents/:id/resolve  — resolver manualmente
 *   GET  /alarms/policy                 — config de limiares do tenant
 *   PATCH /alarms/policy                — atualizar config
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Observable } from 'rxjs';
import {
  ListIncidentsQuerySchema,
  UpdateAlarmPolicySchema,
  type AuthenticatedPrincipal,
  type ListIncidentsQuery,
  type UpdateAlarmPolicy,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody, ZodValidationPipe } from '../../common/zod.pipe';
import { RequiresModule } from '../licensing/license.decorators';

import { AlarmStream, type SseEvent } from './alarm-stream.service';
import { AlarmsService } from './alarms.service';

@ApiTags('alarms')
@ApiBearerAuth()
@RequiresModule('netx-cpe')
@Controller('alarms')
export class AlarmsController {
  constructor(
    private readonly svc: AlarmsService,
    private readonly stream: AlarmStream,
  ) {}

  /** SSE — stream de incidents + quedas/retornos por ONT (real-time, Fase 3). */
  @Sse('stream')
  @RequirePermissions('provisioning.read')
  streamEvents(@CurrentUser() user: AuthenticatedPrincipal): Observable<SseEvent> {
    return this.stream.forTenant(user.tenantId);
  }

  @Get('rssi/cto/:id')
  @RequirePermissions('provisioning.read')
  rssiByCto(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.rssiByCto(user.tenantId, id);
  }

  @Get('signal-report')
  @RequirePermissions('provisioning.read')
  signalReport(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.svc.signalReport(user.tenantId);
  }

  @Get('incidents')
  @RequirePermissions('provisioning.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(ListIncidentsQuerySchema)) q: ListIncidentsQuery,
  ) {
    return this.svc.listIncidents(user.tenantId, q);
  }

  @Get('incidents/:id')
  @RequirePermissions('provisioning.read')
  get(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.getIncident(user.tenantId, id);
  }

  @Post('incidents/:id/ack')
  @HttpCode(200)
  @RequirePermissions('provisioning.write')
  ack(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.acknowledge(user.tenantId, user.sub, id);
  }

  @Post('incidents/:id/resolve')
  @HttpCode(200)
  @RequirePermissions('provisioning.write')
  resolve(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.resolve(user.tenantId, id);
  }

  @Get('policy')
  @RequirePermissions('provisioning.read')
  getPolicy(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.svc.getPolicy(user.tenantId);
  }

  @Patch('policy')
  @RequirePermissions('olts.admin')
  updatePolicy(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(UpdateAlarmPolicySchema) input: UpdateAlarmPolicy,
  ) {
    return this.svc.updatePolicy(user.tenantId, input);
  }
}

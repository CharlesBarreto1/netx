/**
 * WifiOptController — API do rollout em ondas do pacote de otimização Wi-Fi.
 *
 *   GET  /v1/tr069/wifi-opt/waves                       — lista ondas + progresso
 *   POST /v1/tr069/wifi-opt/waves                       — cria onda (name + deviceIds)
 *   GET  /v1/tr069/wifi-opt/waves/:id                   — detalhe (devices/estados)
 *   POST /v1/tr069/wifi-opt/waves/:id/start             — inicia ({force?} destrava 48h)
 *   POST /v1/tr069/wifi-opt/waves/:id/cancel            — aborta
 *   POST /v1/tr069/wifi-opt/devices/:waveDeviceId/rollback — rollback manual
 *   POST /v1/tr069/wifi-opt/_tasks/run-tick             — roda o motor manualmente (debug)
 *
 * Permissions: tudo `tr069.admin` (o `force` do start não precisa de permissão
 * extra — a rota inteira já é admin). Licença: `netx-cpe`.
 *
 * Bodies validados com zod LOCAL (padrão DeactivateInstallSchema do
 * provisioning.controller) — o espelho em @netx/shared/provisioning-api fica
 * pro estágio da UI.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '@netx/shared';
import { z } from 'zod';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { RequiresModule } from '../licensing/license.decorators';

import { WifiOptRolloutService } from './wifi-opt-rollout.service';

/** Corpo da criação de onda — v1: name + textarea de deviceIds (OUI-SN). */
const CreateWifiOptWaveSchema = z.object({
  name: z.string().min(1).max(120),
  deviceIds: z.array(z.string().min(1).max(128)).min(1).max(500),
});
type CreateWifiOptWave = z.infer<typeof CreateWifiOptWaveSchema>;

/** Corpo do start — `force` destrava a regra das 48h/GATE_FAILED. */
const StartWifiOptWaveSchema = z.object({
  force: z.boolean().optional(),
});
type StartWifiOptWave = z.infer<typeof StartWifiOptWaveSchema>;

@ApiTags('tr069')
@ApiBearerAuth()
@RequiresModule('netx-cpe')
@Controller('tr069/wifi-opt')
export class WifiOptController {
  constructor(private readonly rollout: WifiOptRolloutService) {}

  @Get('waves')
  @RequirePermissions('tr069.admin')
  listWaves(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.rollout.listWaves(user.tenantId);
  }

  @Post('waves')
  @RequirePermissions('tr069.admin')
  createWave(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(CreateWifiOptWaveSchema) body: CreateWifiOptWave,
  ) {
    return this.rollout.createWave(user.tenantId, body);
  }

  @Get('waves/:id')
  @RequirePermissions('tr069.admin')
  getWave(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.rollout.getWave(user.tenantId, id);
  }

  @Post('waves/:id/start')
  @HttpCode(200)
  @RequirePermissions('tr069.admin')
  startWave(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(StartWifiOptWaveSchema) body: StartWifiOptWave,
  ) {
    return this.rollout.startWave(user.tenantId, id, body.force ?? false);
  }

  @Post('waves/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('tr069.admin')
  cancelWave(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.rollout.cancelWave(user.tenantId, id);
  }

  /** Rollback manual de um device já empurrado (operador viu problema). */
  @Post('devices/:waveDeviceId/rollback')
  @HttpCode(200)
  @RequirePermissions('tr069.admin')
  rollbackDevice(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('waveDeviceId', new ParseUUIDPipe()) waveDeviceId: string,
  ) {
    return this.rollout.rollbackDevice(user.tenantId, waveDeviceId);
  }

  /**
   * Roda o motor de ondas manualmente (debug — padrão run-overdue-scan).
   * Pula a flag env, mas respeita flag de tenant e janela horária.
   */
  @Post('_tasks/run-tick')
  @HttpCode(200)
  @RequirePermissions('tr069.admin')
  runTick() {
    return this.rollout.runOnce();
  }
}

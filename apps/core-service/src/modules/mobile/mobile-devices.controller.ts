import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import {
  PairDeviceRequestSchema,
  type AuthenticatedPrincipal,
  type PairDeviceRequest,
} from '@netx/shared';

import { CurrentUser } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { MobileDevicesService } from './mobile-devices.service';

@ApiTags('mobile')
@ApiBearerAuth()
@Controller('mobile/devices')
export class MobileDevicesController {
  constructor(private readonly devices: MobileDevicesService) {}

  /**
   * POST /v1/mobile/devices/pair
   *
   * Chamado pelo app logo após o login bem-sucedido. Idempotente — múltiplas
   * chamadas com o mesmo (user, deviceId) só atualizam metadata + lastSeenAt.
   *
   * Não requer permissão extra além de estar autenticado — qualquer user
   * que conseguiu logar pode parear o próprio device. Quem decide se aquele
   * user PODE usar o app é o admin via permissão `mobile.use` (a checar nas
   * rotas de dados subsequentes — Fase 1).
   */
  @Post('pair')
  @HttpCode(200)
  pair(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(PairDeviceRequestSchema) body: PairDeviceRequest,
    @Req() req: Request,
  ) {
    return this.devices.pair(user.tenantId, user.sub, body, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}

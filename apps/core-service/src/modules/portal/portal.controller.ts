/**
 * Endpoints do Portal do Cliente.
 *
 * Rotas públicas (login) e rotas autenticadas com PortalJwtGuard.
 * Decoradas com @Public pra que o JwtAuthGuard global as ignore.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 * @provenance MDg0NzI5Njg5MDE=
 */
import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { Public } from '../../common/decorators';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import {
  PortalLoginRequestSchema,
  type PortalLoginRequest,
  type AuthenticatedPrincipal,
} from '@netx/shared';
import { PortalAuthService } from './portal-auth.service';
import { PortalJwtGuard, type PortalPrincipal } from './portal-jwt.guard';
import { PortalService } from './portal.service';

/**
 * Dois controllers porque os prefixos são diferentes:
 *   - operador: /v1/customers/:id/portal-access (autenticado JWT operador)
 *   - cliente:  /v1/portal/* (login público + JWT portal)
 *
 * O `setGlobalPrefix('v1')` em main.ts já adiciona o `v1/`. Não duplicar.
 */
@ApiTags('portal')
@Controller('customers')
export class PortalAccessController {
  constructor(private readonly auth: PortalAuthService) {}

  @Post(':id/portal-access')
  @RequirePermissions('customers.update')
  async issueAccess(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id') customerId: string,
  ) {
    const result = await this.auth.issueAccessCode(
      user.tenantId,
      customerId,
      user.sub,
    );
    return {
      code: result.code,
      expiresAt: result.expiresAt.toISOString(),
    };
  }

  @Post(':id/portal-access/revoke')
  @RequirePermissions('customers.update')
  async revokeAccess(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id') customerId: string,
  ) {
    await this.auth.revokeAccess(user.tenantId, customerId, user.sub);
    return { ok: true };
  }
}

@ApiTags('portal')
@Controller('portal')
// ThrottlerGuard local pro escopo do controller. Combinado com @Throttle()
// no /login, gera limite agressivo só pra esse endpoint público — sem afrouxar
// nem apertar globais.
@UseGuards(ThrottlerGuard)
export class PortalController {
  constructor(
    private readonly auth: PortalAuthService,
    private readonly portal: PortalService,
  ) {}

  /**
   * Login do cliente. 10 tentativas / minuto / IP — protege contra brute
   * force de código (6 chars alfanum = ~57^6 ≈ 34B, mas códigos frescos
   * costumam ser TTL curto então defesa em profundidade ajuda).
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('login')
  async login(
    @ZodBody(PortalLoginRequestSchema) body: PortalLoginRequest,
    @Req() req: Request,
  ) {
    const ip = (req.ip ?? req.socket?.remoteAddress) as string | undefined;
    const ua = req.headers['user-agent'];
    return this.auth.login(
      body.tenantSlug ?? process.env.DEFAULT_TENANT_SLUG ?? 'default',
      body.taxId,
      body.code,
      ip,
      typeof ua === 'string' ? ua : undefined,
    );
  }

  @Public()
  @UseGuards(PortalJwtGuard)
  @Get('me')
  async me(@Req() req: Request) {
    const p = req.portal as PortalPrincipal;
    return this.portal.getMe(p.tenantId, p.customerId);
  }

  @Public()
  @UseGuards(PortalJwtGuard)
  @Get('contracts')
  async contracts(@Req() req: Request) {
    const p = req.portal as PortalPrincipal;
    return this.portal.getContracts(p.tenantId, p.customerId);
  }

  @Public()
  @UseGuards(PortalJwtGuard)
  @Get('invoices')
  async invoices(@Req() req: Request) {
    const p = req.portal as PortalPrincipal;
    return this.portal.getInvoices(p.tenantId, p.customerId);
  }
}

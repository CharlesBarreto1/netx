/**
 * Endpoints do Portal do Cliente.
 *
 * Rotas públicas (login) e rotas autenticadas com PortalJwtGuard.
 * Decoradas com @Public pra que o JwtAuthGuard global as ignore.
 */
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { Public } from '../../common/decorators';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '@netx/shared';
import { PortalAuthService } from './portal-auth.service';
import { PortalJwtGuard, type PortalPrincipal } from './portal-jwt.guard';
import { PortalService } from './portal.service';

@ApiTags('portal')
@Controller()
export class PortalController {
  constructor(
    private readonly auth: PortalAuthService,
    private readonly portal: PortalService,
  ) {}

  // ─── Operador: gera código de acesso ─────────────────────────────────────
  @Post('v1/customers/:id/portal-access')
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

  @Post('v1/customers/:id/portal-access/revoke')
  @RequirePermissions('customers.update')
  async revokeAccess(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id') customerId: string,
  ) {
    await this.auth.revokeAccess(user.tenantId, customerId, user.sub);
    return { ok: true };
  }

  // ─── Cliente: login ──────────────────────────────────────────────────────
  @Public()
  @Post('v1/portal/login')
  async login(
    @Body() body: { tenantSlug: string; taxId: string; code: string },
    @Req() req: Request,
  ) {
    const ip = (req.ip ?? req.socket?.remoteAddress) as string | undefined;
    const ua = req.headers['user-agent'];
    return this.auth.login(
      body.tenantSlug ?? 'default',
      body.taxId,
      body.code,
      ip,
      typeof ua === 'string' ? ua : undefined,
    );
  }

  // ─── Cliente: dados próprios ─────────────────────────────────────────────
  @Public()
  @UseGuards(PortalJwtGuard)
  @Get('v1/portal/me')
  async me(@Req() req: Request) {
    const p = req.portal as PortalPrincipal;
    return this.portal.getMe(p.tenantId, p.customerId);
  }

  @Public()
  @UseGuards(PortalJwtGuard)
  @Get('v1/portal/contracts')
  async contracts(@Req() req: Request) {
    const p = req.portal as PortalPrincipal;
    return this.portal.getContracts(p.tenantId, p.customerId);
  }

  @Public()
  @UseGuards(PortalJwtGuard)
  @Get('v1/portal/invoices')
  async invoices(@Req() req: Request) {
    const p = req.portal as PortalPrincipal;
    return this.portal.getInvoices(p.tenantId, p.customerId);
  }
}

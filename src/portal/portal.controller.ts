import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import { WikiService } from '../wiki/wiki.service';
import { PortalAuthGuard, type PortalRequest } from './portal-auth.guard';
import { PortalService } from './portal.service';

const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const PaySchema = z.object({
  invoiceId: z.string().uuid(),
  method: z.enum(['PIX', 'CARD']).default('PIX'),
});

/** Central do cliente — /v1/portal. Login público; resto exige Bearer JWT. */
@Controller('portal')
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly wiki: WikiService,
  ) {}

  @Post('login')
  login(@Body() body: unknown) {
    const r = LoginSchema.safeParse(body);
    if (!r.success) throw new BadRequestException('e-mail/senha obrigatórios');
    return this.portal.login(r.data.email, r.data.password);
  }

  @UseGuards(PortalAuthGuard)
  @Get('me')
  me(@Req() req: PortalRequest) {
    return this.portal.me(req.portalUser!.lid);
  }

  @UseGuards(PortalAuthGuard)
  @Get('invoices')
  invoices(@Req() req: PortalRequest) {
    return this.portal.invoices(req.portalUser!.lid);
  }

  @UseGuards(PortalAuthGuard)
  @Post('trust-unlock')
  trustUnlock(@Req() req: PortalRequest) {
    return this.portal.grantTrustUnlock(req.portalUser!.lid, req.portalUser!.email);
  }

  @UseGuards(PortalAuthGuard)
  @Post('pay')
  pay(@Req() req: PortalRequest, @Body() body: unknown) {
    const r = PaySchema.safeParse(body);
    if (!r.success) throw new BadRequestException('invoiceId inválido');
    return this.portal.pay(req.portalUser!.lid, r.data.invoiceId, r.data.method);
  }

  // ── Central de ajuda (wiki do cliente — só artigos CLIENT, read-only) ─────
  @UseGuards(PortalAuthGuard)
  @Get('wiki')
  wikiList() {
    return this.wiki.list('CLIENT');
  }

  @UseGuards(PortalAuthGuard)
  @Get('wiki/:slug')
  wikiArticle(@Param('slug') slug: string) {
    return this.wiki.getBySlug(slug, 'CLIENT');
  }
}

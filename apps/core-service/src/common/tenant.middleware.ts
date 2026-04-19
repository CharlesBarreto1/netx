import { Injectable, NestMiddleware, BadRequestException } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { ClsService } from 'nestjs-cls';

import { loadConfig } from '@netx/config';

import { PrismaService } from '../modules/prisma/prisma.service';
import type { TenantClsStore } from './tenant-context';

/**
 * Resolves the current tenant from the incoming request, caches it in CLS,
 * and attaches it to req.tenant / req.tenantId. Strategy is configurable:
 *
 *  - subdomain: ` ${slug}.netx.app ` → slug
 *  - header:    X-Tenant-Id (slug or uuid)
 *  - jwt:       read from claim (done in JwtStrategy instead)
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly config = loadConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<TenantClsStore>,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const slug = this.resolveSlug(req);

    if (!slug) {
      // Anonymous routes (login, health) can operate without tenant.
      return next();
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true, status: true, locale: true, timezone: true, currency: true },
    });

    if (!tenant || tenant.status === 'CHURNED') {
      throw new BadRequestException({
        type: 'urn:netx:error:tenant-not-resolved',
        title: 'Tenant not found',
        detail: `Unknown tenant "${slug}"`,
      });
    }

    (req as Request & { tenant: unknown; tenantId: string }).tenant = tenant;
    (req as Request & { tenant: unknown; tenantId: string }).tenantId = tenant.id;
    this.cls.set('tenantId', tenant.id);
    this.cls.set('tenantSlug', tenant.slug);

    next();
  }

  private resolveSlug(req: Request): string | undefined {
    switch (this.config.tenancy.strategy) {
      case 'subdomain': {
        const host = req.hostname;
        const parts = host.split('.');
        if (parts.length >= 3) return parts[0];
        // fallback: header-based during local dev
        return (req.headers[this.config.tenancy.headerName] as string | undefined)?.trim();
      }
      case 'header':
        return (req.headers[this.config.tenancy.headerName] as string | undefined)?.trim();
      case 'jwt':
        // JwtStrategy fills it in later
        return undefined;
      default:
        return undefined;
    }
  }
}

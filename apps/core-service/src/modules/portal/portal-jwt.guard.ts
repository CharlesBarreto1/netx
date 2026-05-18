/**
 * Guard simples pro Portal — extrai e valida o JWT com audience='netx-portal'.
 * Não usa Passport pra evitar conflito com a strategy 'jwt' já registrada
 * globalmente como APP_GUARD; é mais limpo deixar o portal como cidadão
 * separado.
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { loadConfig } from '@netx/config';
import jwt from 'jsonwebtoken';

export interface PortalPrincipal {
  customerId: string;
  tenantId: string;
}

declare module 'express' {
  interface Request {
    portal?: PortalPrincipal;
  }
}

@Injectable()
export class PortalJwtGuard implements CanActivate {
  private readonly logger = new Logger(PortalJwtGuard.name);
  private readonly secret: string;

  constructor() {
    // Secret dedicado pro portal — ver justificativa em portal-auth.service.ts.
    this.secret = loadConfig().jwt.portalSecret;
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const auth = req.headers?.authorization as string | undefined;
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing portal token');
    }
    const token = auth.slice('Bearer '.length).trim();
    try {
      const payload = jwt.verify(token, this.secret, {
        issuer: 'netx',
        audience: 'netx-portal',
        algorithms: ['HS256'],
      }) as { sub: string; tid: string; scope?: string };
      if (payload.scope !== 'portal' || !payload.sub || !payload.tid) {
        throw new UnauthorizedException('Invalid portal token');
      }
      req.portal = { customerId: payload.sub, tenantId: payload.tid };
      return true;
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired portal token');
    }
  }
}

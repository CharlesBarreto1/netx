import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { verifyPortalJwt, type PortalJwtPayload } from '../common/jwt';

export interface PortalRequest {
  headers: Record<string, string>;
  portalUser?: PortalJwtPayload;
}

/** Protege rotas da central do cliente. Bearer JWT HS256. */
@Injectable()
export class PortalAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<PortalRequest>();
    const auth = req.headers['authorization'] ?? '';
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    const payload = m ? verifyPortalJwt(m[1].trim()) : null;
    if (!payload) throw new UnauthorizedException('sessão inválida ou expirada');
    req.portalUser = payload;
    return true;
  }
}

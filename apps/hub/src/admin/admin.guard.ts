import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { verifyAdminJwt, type AdminJwtPayload } from '../common/jwt';

export interface AdminRequest {
  headers: Record<string, string>;
  admin?: AdminJwtPayload;
}

/**
 * Protege o painel admin (equipe NetX). Login e-mail+senha → Bearer JWT.
 * (Substitui o antigo HUB_ADMIN_TOKEN único.)
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    const auth = req.headers['authorization'] ?? '';
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    const payload = m ? verifyAdminJwt(m[1].trim()) : null;
    if (!payload) throw new UnauthorizedException('sessão admin inválida ou expirada');
    req.admin = payload;
    return true;
  }
}

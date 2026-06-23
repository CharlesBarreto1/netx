import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ModuleCode } from '@netx/shared';

import { IS_PUBLIC_KEY } from '../../common/decorators';
import { LicensingService } from './licensing.service';
import { REQUIRES_MODULE_KEY } from './license.decorators';

/**
 * ModuleEntitlementGuard — guard global que aplica o entitlement POR MÓDULO em
 * runtime (invariantes 2b/9). Roda depois do LicenseGuard.
 *
 * DEFAULT-PERMISSIVO por design — só bloqueia quando há certeza de que o módulo
 * não está licenciado:
 *   - Licenciamento desligado (sem hubUrl/key)        → libera (fail-open).
 *   - Rota sem @RequiresModule                         → libera.
 *   - Rota @Public                                     → libera.
 *   - Token sem o claim `modules` (instância legada)   → libera (entitledModules
 *     devolve o catálogo inteiro).
 *   - Módulo exigido presente nos módulos habilitados  → libera.
 *   - Caso contrário                                   → 402 Payment Required.
 *
 * Assim, ligar este guard é no-op para a produção atual (cujo token ainda não
 * carimba `modules`).
 */
@Injectable()
export class ModuleEntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly licensing: LicensingService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    if (!this.licensing.isEnabled()) return true; // fail-open

    const required = this.reflector.getAllAndOverride<ModuleCode | undefined>(
      REQUIRES_MODULE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true; // rota não exige módulo específico

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    if (this.licensing.entitledModules().includes(required)) return true;

    // Não licenciado → 402 (o front trata como a tela de licença/upsell).
    throw new HttpException(
      {
        type: 'urn:netx:error:license:module',
        title: 'Módulo não licenciado',
        status: HttpStatus.PAYMENT_REQUIRED,
        detail: `O módulo "${required}" não está habilitado nesta licença.`,
        license: { module: required },
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

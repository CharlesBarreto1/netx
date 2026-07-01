import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { MfaService } from './mfa.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { StepUpGuard } from '../../common/guards/step-up.guard';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    AuditModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    MfaService,
    JwtStrategy,
    // Global auth pipeline: JWT → Permissions → Step-up. Routes opt-out com
    // @Public(); StepUpGuard só atua em rotas @RequireStepUp() (passthrough senão).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: StepUpGuard },
  ],
  // forwardRef não é necessário aqui — MfaService e AuthService são
  // resolvidos pelo Nest mesmo com a referência circular declarada
  // (AuthService usa @Inject(forwardRef(() => MfaService))).
  exports: [AuthService, MfaService],
})
export class AuthModule {}

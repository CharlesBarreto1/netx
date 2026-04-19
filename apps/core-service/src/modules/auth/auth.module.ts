import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    AuditModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    // Global auth pipeline: JWT → Permissions. Routes opt-out with @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}

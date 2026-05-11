import {
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

import {
  ChangePasswordRequestSchema,
  DisableMfaRequestSchema,
  LoginRequestSchema,
  RefreshTokenRequestSchema,
  VerifyMfaRequestSchema,
} from '@netx/shared';
import type {
  AuthenticatedPrincipal,
  ChangePasswordRequest,
  DisableMfaRequest,
  LoginRequest,
  LoginResponse,
  RefreshTokenRequest,
  VerifyMfaRequest,
} from '@netx/shared';

import { CurrentUser, Public } from '../../common/decorators';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { ZodBody } from '../../common/zod.pipe';

@ApiTags('auth')
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @ZodBody(LoginRequestSchema) body: LoginRequest,
    @Req() req: Request,
  ): Promise<LoginResponse> {
    return this.auth.login(body, req.ip, req.headers['user-agent']);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@ZodBody(RefreshTokenRequestSchema) body: RefreshTokenRequest) {
    return this.auth.refresh(body.refreshToken);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthenticatedPrincipal) {
    await this.auth.logout(user.sessionId);
  }

  @ApiBearerAuth()
  @Post('password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(ChangePasswordRequestSchema) body: ChangePasswordRequest,
  ) {
    await this.auth.changePassword(user.sub, body.currentPassword, body.newPassword);
  }

  // ---------------------------------------------------------------------------
  // MFA
  // ---------------------------------------------------------------------------
  @ApiBearerAuth()
  @Post('mfa/setup')
  @HttpCode(200)
  setupMfa(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.mfa.setup(user.sub);
  }

  @ApiBearerAuth()
  @Post('mfa/verify')
  @HttpCode(200)
  verifyMfa(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(VerifyMfaRequestSchema) body: VerifyMfaRequest,
  ) {
    return this.mfa.verify(user.tenantId, user.sub, body.token);
  }

  @ApiBearerAuth()
  @Post('mfa/disable')
  @HttpCode(204)
  async disableMfa(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(DisableMfaRequestSchema) body: DisableMfaRequest,
  ) {
    await this.mfa.disable(user.tenantId, user.sub, body.password);
  }

  @ApiBearerAuth()
  @Post('mfa/regenerate-backup-codes')
  @HttpCode(200)
  regenerateBackupCodes(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.mfa.regenerateBackupCodes(user.tenantId, user.sub);
  }
}

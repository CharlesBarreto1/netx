import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

import { LoginRequestSchema, RefreshTokenRequestSchema, ChangePasswordRequestSchema } from '@netx/shared';
import type { LoginRequest, RefreshTokenRequest, ChangePasswordRequest, AuthenticatedPrincipal, LoginResponse } from '@netx/shared';

import { CurrentUser, Public } from '../../common/decorators';
import { AuthService } from './auth.service';
import { ZodBody } from '../../common/zod.pipe';

@ApiTags('auth')
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
}

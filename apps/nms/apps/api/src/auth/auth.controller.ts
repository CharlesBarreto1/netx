import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { LoginSchema, type LoginDto } from './auth.dto.js';
import { CurrentUser, Public } from './auth.decorators.js';
import type { AuthUser } from './auth.types.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(LoginSchema)) dto: LoginDto) {
    return this.auth.login(dto.username, dto.password);
  }

  /** Identidade da sessão atual — usada pela web para decidir o que mostrar. */
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}

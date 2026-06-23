import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { AdminAuthService } from './admin-auth.service';
import { AdminGuard } from './admin.guard';

const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const CreateAdminSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().max(120).optional(),
});

/**
 * Login da equipe NetX (painel admin). /login é público; criar/listar admins
 * exige sessão admin (Bearer JWT).
 */
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  login(@Body() body: unknown) {
    const r = LoginSchema.safeParse(body);
    if (!r.success) throw new BadRequestException('e-mail/senha obrigatórios');
    return this.auth.login(r.data.email, r.data.password);
  }

  @UseGuards(AdminGuard)
  @Get('me')
  me() {
    return { ok: true };
  }

  @UseGuards(AdminGuard)
  @Get('admins')
  list() {
    return this.auth.list();
  }

  @UseGuards(AdminGuard)
  @Post('admins')
  create(@Body() body: unknown) {
    const r = CreateAdminSchema.safeParse(body);
    if (!r.success) throw new BadRequestException('dados inválidos (senha mín. 8)');
    return this.auth.create(r.data.email, r.data.password, r.data.name);
  }
}

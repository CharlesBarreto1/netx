import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { randomBytes } from 'crypto';

import { hashPassword, verifyPassword } from '@netx/auth';
import { loadConfig } from '@netx/config';
import type {
  MfaBackupCodesResponse,
  SetupMfaResponse,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * MFA TOTP — Time-based One-Time Password (RFC 6238).
 *
 * Fluxo:
 *   1. POST /auth/mfa/setup → gera secret novo + retorna QR + URL otpauth.
 *      Secret fica gravado em `user.mfaSecret` mas `mfaEnabled` continua
 *      false até a verificação dar OK.
 *   2. POST /auth/mfa/verify { token } → valida e seta mfaEnabled=true.
 *   3. POST /auth/mfa/disable { password } → exige senha atual, limpa
 *      secret e backup codes.
 *
 * Backup codes:
 *   - 10 códigos de 8 chars hex aleatórios.
 *   - Hashados com Argon2 antes de gravar (são "senhas" pra todos os efeitos).
 *   - Cada código é single-use: ao validar, removemos do array.
 *   - Mostrados em texto puro UMA VEZ na resposta (nunca mais visíveis).
 */
@Injectable()
export class MfaService {
  private readonly argon2Config = loadConfig().argon2;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    // Janela de 1 step (30s) pra tolerar drift de relógio mínimo. Padrão.
    authenticator.options = { window: 1 };
  }

  // ---------------------------------------------------------------------------
  // SETUP
  // ---------------------------------------------------------------------------
  async setup(userId: string): Promise<SetupMfaResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: { select: { name: true, slug: true } } },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if (user.mfaEnabled) {
      throw new ConflictException(
        'MFA já está ativo. Desative antes de reconfigurar.',
      );
    }

    const secret = authenticator.generateSecret();
    const issuer = `NetX (${user.tenant.slug})`;
    const accountLabel = user.email;
    const otpauthUrl = authenticator.keyuri(accountLabel, issuer, secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 240 });

    // Salva o secret mas NÃO ativa ainda.
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: secret, mfaEnabled: false, mfaBackupCodes: [] },
    });

    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  // ---------------------------------------------------------------------------
  // VERIFY (ativa)
  // ---------------------------------------------------------------------------
  async verify(
    tenantId: string,
    userId: string,
    token: string,
  ): Promise<MfaBackupCodesResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if (!user.mfaSecret) {
      throw new BadRequestException('Configure MFA primeiro (setup).');
    }
    if (!authenticator.check(token, user.mfaSecret)) {
      throw new ForbiddenException('Código inválido. Tente novamente.');
    }

    // Gera 10 backup codes em plain pra mostrar UMA VEZ. Hash antes de salvar.
    const plainCodes = Array.from({ length: 10 }, () =>
      randomBytes(4).toString('hex').toUpperCase(),
    );
    const hashedCodes = await Promise.all(
      plainCodes.map((c) => hashPassword(c, this.argon2Config)),
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: true,
        mfaBackupCodes: hashedCodes,
      },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'mfa.enabled',
      resource: 'users',
      resourceId: userId,
    });
    return { codes: plainCodes };
  }

  // ---------------------------------------------------------------------------
  // DISABLE
  // ---------------------------------------------------------------------------
  async disable(
    tenantId: string,
    userId: string,
    password: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if (!user.mfaEnabled) {
      throw new BadRequestException('MFA não está ativo.');
    }
    if (!user.passwordHash) {
      throw new BadRequestException('Conta sem senha — fluxo SSO.');
    }
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) throw new ForbiddenException('Senha incorreta.');

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
        mfaBackupCodes: [],
      },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'mfa.disabled',
      resource: 'users',
      resourceId: userId,
    });
  }

  // ---------------------------------------------------------------------------
  // REGENERATE BACKUP CODES
  // ---------------------------------------------------------------------------
  async regenerateBackupCodes(
    tenantId: string,
    userId: string,
  ): Promise<MfaBackupCodesResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaEnabled) {
      throw new BadRequestException('Ative MFA primeiro.');
    }
    const plainCodes = Array.from({ length: 10 }, () =>
      randomBytes(4).toString('hex').toUpperCase(),
    );
    const hashedCodes = await Promise.all(
      plainCodes.map((c) => hashPassword(c, this.argon2Config)),
    );
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaBackupCodes: hashedCodes },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'mfa.backup_codes_regenerated',
      resource: 'users',
      resourceId: userId,
    });
    return { codes: plainCodes };
  }

  // ---------------------------------------------------------------------------
  // INTERNAL — usado pelo AuthService.login
  // ---------------------------------------------------------------------------
  /**
   * Verifica TOTP OU consome um backup code. Retorna `true` se válido.
   * Quando consome backup code, remove do array.
   */
  async verifyTokenOrBackup(userId: string, token: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaEnabled || !user.mfaSecret) return false;

    // 1. Tenta TOTP primeiro (mais comum).
    if (authenticator.check(token, user.mfaSecret)) return true;

    // 2. Backup code: hash não é direto — precisa bater com algum hashed do array.
    //    Quando achar, remove o hash pra single-use.
    const codes = (user.mfaBackupCodes ?? []) as string[];
    for (const hash of codes) {
      // verifyPassword é Argon2.
      // Backup codes têm 8 chars — o user pode digitar com ou sem hyphen.
      const cleanedToken = token.replace(/[-\s]/gu, '').toUpperCase();
      if (await verifyPassword(hash, cleanedToken)) {
        await this.prisma.user.update({
          where: { id: userId },
          data: { mfaBackupCodes: codes.filter((c) => c !== hash) },
        });
        return true;
      }
    }
    return false;
  }
}

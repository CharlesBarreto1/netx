/**
 * Autenticação do humano dentro do fluxo OIDC.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * O oidc-provider não autentica ninguém: ele redireciona para uma tela nossa
 * ("interaction") e espera o resultado. Este serviço é o que valida credencial
 * nessa tela.
 *
 * NÃO reusa AuthService.login() de propósito: aquele emite JWT interno e cria
 * uma Session do NetX. Aqui a sessão que importa é a do OIDC, gerida pelo
 * provider. Criar uma sessão interna junto seria estado órfão que ninguém
 * revoga no desligamento.
 *
 * O que ele COPIA do login interno, e não pode divergir:
 *   - status ACTIVE obrigatório
 *   - erro genérico para não permitir enumerar e-mail
 *   - MFA exigida quando o usuário tem MFA ligada
 *
 * Esse último ponto é o que impede o SSO de virar um desvio da MFA: sem ele,
 * quem tem MFA no NetX entraria no Nextcloud só com senha.
 */
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';

import { verifyPassword } from '@netx/auth';

import { AuditService } from '../audit/audit.service';
import { MfaService } from '../auth/mfa.service';
import { PrismaService } from '../prisma/prisma.service';

export interface InteractionLoginInput {
  tenantId: string;
  email: string;
  password: string;
  mfaToken?: string;
  ip?: string;
  userAgent?: string;
}

/** Motivo da recusa, para a tela decidir o que pedir em seguida. */
export type LoginFailure = 'invalid_credentials' | 'mfa_required' | 'mfa_invalid';

export class InteractionLoginError extends UnauthorizedException {
  constructor(readonly reason: LoginFailure, detail: string) {
    super({ type: `urn:netx:error:${reason.replace(/_/g, '-')}`, title: detail, reason });
  }
}

@Injectable()
export class OidcInteractionService {
  private readonly logger = new Logger(OidcInteractionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mfa: MfaService,
    private readonly audit: AuditService,
  ) {}

  /** Valida credencial e devolve o id do usuário que vira o `sub` do token. */
  async authenticate(input: InteractionLoginInput): Promise<string> {
    const { tenantId, email, password, mfaToken, ip, userAgent } = input;

    const user = await this.prisma.user.findFirst({
      where: { tenantId, email, deletedAt: null },
      select: {
        id: true,
        passwordHash: true,
        status: true,
        mfaEnabled: true,
      },
    });

    // Mensagem genérica: distinguir "não existe" de "senha errada" entregaria
    // ao atacante uma lista de e-mails válidos.
    if (!user || !user.passwordHash || user.status !== 'ACTIVE') {
      await this.audit.log({
        tenantId,
        action: 'oidc.interaction.login.failed',
        level: 'WARNING',
        ip,
        userAgent,
        metadata: { email, reason: 'usuario_inexistente_ou_inativo' },
      });
      throw new InteractionLoginError('invalid_credentials', 'Credenciais inválidas.');
    }

    if (!(await verifyPassword(user.passwordHash, password))) {
      await this.audit.log({
        tenantId,
        userId: user.id,
        action: 'oidc.interaction.login.failed',
        level: 'WARNING',
        ip,
        userAgent,
        metadata: { reason: 'senha_incorreta' },
      });
      throw new InteractionLoginError('invalid_credentials', 'Credenciais inválidas.');
    }

    if (user.mfaEnabled) {
      if (!mfaToken) {
        // Não é falha de auditoria — é o fluxo normal pedindo o segundo fator.
        throw new InteractionLoginError('mfa_required', 'Informe o código do app autenticador.');
      }
      if (!(await this.mfa.verifyTokenOrBackup(user.id, mfaToken))) {
        await this.audit.log({
          tenantId,
          userId: user.id,
          action: 'oidc.interaction.login.failed',
          level: 'WARNING',
          ip,
          userAgent,
          metadata: { reason: 'mfa_invalida' },
        });
        throw new InteractionLoginError('mfa_invalid', 'Código inválido.');
      }
    }

    await this.audit.log({
      tenantId,
      userId: user.id,
      action: 'oidc.interaction.login.ok',
      level: 'INFO',
      ip,
      userAgent,
      metadata: { mfa: user.mfaEnabled },
    });
    this.logger.log(`login OIDC concluído para o usuário ${user.id}`);

    return user.id;
  }
}

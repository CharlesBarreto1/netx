/**
 * Portal do Cliente — autenticação por código.
 *
 * Modelo simples e fechado, adequado pro MVP:
 *
 *   1. Operador clica "Gerar acesso" no detalhe do cliente.
 *   2. Backend gera código de 8 chars (legível, sem caracteres ambíguos),
 *      hasheia com Argon2id, salva o hash + expiração em `customers`.
 *      O código plain é devolvido UMA vez na resposta — operador anota e
 *      passa pro cliente fora de banda (WhatsApp, SMS, na presença).
 *   3. Cliente entra em /portal/login com (taxId, código).
 *   4. Backend confere taxId + Argon2 verify do código + checa expiração.
 *   5. Sessão JWT específica do portal (audience='netx-portal').
 *
 * Sem email + reset por enquanto — exige operador no loop. Phase 2: magic
 * link por email quando tiver SMTP configurado.
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  hashPassword,
  verifyPassword,
  type Argon2Options,
} from '@netx/auth';
import { loadConfig } from '@netx/config';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

// Charset sem 0/O, 1/I/l — códigos ditados por telefone não dão erro.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 8;
const CODE_TTL_DAYS = 30;

export interface PortalIssueResult {
  code: string; // plain — exibido apenas uma vez
  expiresAt: Date;
}

export interface PortalSession {
  token: string;
  expiresIn: number;
  customer: {
    id: string;
    displayName: string;
    primaryEmail: string | null;
    locale: string | null;
  };
  tenant: {
    id: string;
    slug: string;
    name: string;
    locale: string;
    currency: string;
  };
}

@Injectable()
export class PortalAuthService {
  private readonly logger = new Logger(PortalAuthService.name);
  private readonly argon2: Argon2Options;
  private readonly jwtSecret: string;
  private readonly jwtTtlSeconds = 60 * 60 * 8; // 8h por sessão

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    const cfg = loadConfig();
    this.argon2 = cfg.argon2;
    // Secret dedicado pro portal — separado do JWT_ACCESS_SECRET de operador
    // pra que um vazamento de portal-jwt não permita forjar token de operador
    // (defesa contra audience-confusion bugs).
    this.jwtSecret = cfg.jwt.portalSecret;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Operador: gerar/regerar código
  // ───────────────────────────────────────────────────────────────────────────
  async issueAccessCode(
    tenantId: string,
    customerId: string,
    actorUserId: string,
  ): Promise<PortalIssueResult> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');

    const code = this.generateCode();
    const hash = await hashPassword(code, this.argon2);
    const expiresAt = new Date(Date.now() + CODE_TTL_DAYS * 86400_000);

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        portalAccessHash: hash,
        portalAccessExpiresAt: expiresAt,
      },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'portal.access.issued',
      resource: 'customers',
      resourceId: customerId,
      level: 'WARNING',
      metadata: { expiresAt: expiresAt.toISOString() },
    });

    return { code, expiresAt };
  }

  async revokeAccess(
    tenantId: string,
    customerId: string,
    actorUserId: string,
  ): Promise<void> {
    await this.prisma.customer.update({
      where: { id: customerId },
      data: { portalAccessHash: null, portalAccessExpiresAt: null },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'portal.access.revoked',
      resource: 'customers',
      resourceId: customerId,
      level: 'WARNING',
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Cliente: login
  // ───────────────────────────────────────────────────────────────────────────
  async login(
    tenantSlug: string,
    taxId: string,
    code: string,
    ip?: string,
    userAgent?: string,
  ): Promise<PortalSession> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug: tenantSlug, status: 'ACTIVE' },
    });
    if (!tenant) throw new UnauthorizedException('Credenciais inválidas');

    // Normaliza taxId (remove formatação) pra busca tolerante.
    const cleanTaxId = taxId.replace(/[^0-9A-Za-z-]/gu, '');

    const customer = await this.prisma.customer.findFirst({
      where: {
        tenantId: tenant.id,
        deletedAt: null,
        // taxId armazenado pode estar com formatação; comparamos sem ela.
        OR: [
          { taxId: cleanTaxId },
          { taxId: taxId.trim() },
        ],
      },
    });

    // Mensagem genérica pra evitar enumeração de tax IDs.
    const fail = () => {
      this.audit.log({
        tenantId: tenant.id,
        action: 'portal.login.failed',
        level: 'WARNING',
        ip,
        userAgent,
        metadata: { taxId: cleanTaxId, reason: 'invalid_credentials' },
      });
      throw new UnauthorizedException('Credenciais inválidas');
    };

    if (!customer || !customer.portalAccessHash) await fail();
    // Type narrow após o guard (await fail() throws):
    const c = customer!;
    if (!c.portalAccessHash) throw new UnauthorizedException();

    // Expiração
    if (
      c.portalAccessExpiresAt &&
      c.portalAccessExpiresAt.getTime() < Date.now()
    ) {
      await this.audit.log({
        tenantId: tenant.id,
        action: 'portal.login.failed',
        level: 'WARNING',
        ip,
        userAgent,
        resource: 'customers',
        resourceId: c.id,
        metadata: { reason: 'code_expired' },
      });
      throw new UnauthorizedException('Código expirado. Solicite um novo ao seu provedor.');
    }

    const ok = await verifyPassword(c.portalAccessHash, code.trim());
    if (!ok) await fail();

    await this.prisma.customer.update({
      where: { id: c.id },
      data: { portalLastLoginAt: new Date() },
    });
    await this.audit.log({
      tenantId: tenant.id,
      action: 'portal.login.success',
      level: 'WARNING',
      ip,
      userAgent,
      resource: 'customers',
      resourceId: c.id,
    });

    const token = jwt.sign(
      { sub: c.id, tid: tenant.id, scope: 'portal' },
      this.jwtSecret,
      {
        issuer: 'netx',
        audience: 'netx-portal',
        algorithm: 'HS256',
        expiresIn: this.jwtTtlSeconds,
      },
    );

    return {
      token,
      expiresIn: this.jwtTtlSeconds,
      customer: {
        id: c.id,
        displayName: c.displayName,
        primaryEmail: c.primaryEmail,
        locale: c.preferredLanguage,
      },
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        locale: tenant.locale,
        currency: tenant.currency,
      },
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────
  private generateCode(): string {
    // Gera bytes aleatórios e mapeia pro charset. randomBytes garante
    // entropia criptográfica — Math.random NÃO serve aqui.
    const bytes = randomBytes(CODE_LEN);
    let out = '';
    for (let i = 0; i < CODE_LEN; i++) {
      out += CODE_CHARS[bytes[i] % CODE_CHARS.length];
    }
    return out;
  }
}

import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type {
  EfiConfigResponse,
  UpsertEfiConfigRequest,
} from '@netx/shared';
import type { EfiConfig } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';

import { EfiClientService } from './efi-client.service';
import type { EfiResolvedConfig } from './efi.types';

@Injectable()
export class EfiConfigService {
  private readonly logger = new Logger(EfiConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly client: EfiClientService,
  ) {}

  // ---------------------------------------------------------------------------
  // READ
  // ---------------------------------------------------------------------------
  async get(tenantId: string): Promise<EfiConfigResponse> {
    const cfg = await this.prisma.efiConfig.findUnique({ where: { tenantId } });
    return this.toResponse(tenantId, cfg);
  }

  /** Linha bruta (uso interno). */
  private findRaw(tenantId: string): Promise<EfiConfig | null> {
    return this.prisma.efiConfig.findUnique({ where: { tenantId } });
  }

  // ---------------------------------------------------------------------------
  // UPSERT (admin)
  // ---------------------------------------------------------------------------
  async upsert(
    tenantId: string,
    actorUserId: string,
    input: UpsertEfiConfigRequest,
  ): Promise<EfiConfigResponse> {
    const existing = await this.findRaw(tenantId);

    // Segredos: só sobrescreve quando vem valor não-vazio (write-only).
    let credentialsEnc = existing?.credentialsEnc ?? null;
    let credsChanged = false;
    if (input.clientId !== undefined || input.clientSecret !== undefined) {
      const current = this.readCreds(existing);
      const clientId = (input.clientId ?? current?.clientId ?? '').trim();
      const clientSecret = (input.clientSecret ?? current?.clientSecret ?? '').trim();
      if (!clientId || !clientSecret) {
        throw new BadRequestException('clientId e clientSecret são obrigatórios juntos');
      }
      credentialsEnc = this.crypto.encrypt(JSON.stringify({ clientId, clientSecret }));
      credsChanged = true;
    }

    let certificateEnc = existing?.certificateEnc ?? null;
    if (input.certificateBase64 !== undefined && input.certificateBase64 !== '') {
      // Valida que é base64 de um binário não-vazio.
      const buf = Buffer.from(input.certificateBase64, 'base64');
      if (buf.length < 64) {
        throw new BadRequestException('certificateBase64 inválido (esperado .p12 em base64)');
      }
      certificateEnc = this.crypto.encrypt(input.certificateBase64);
    }

    let certificatePassEnc = existing?.certificatePassEnc ?? null;
    if (input.certificatePassword !== undefined) {
      certificatePassEnc = this.crypto.encryptOptional(input.certificatePassword);
    }

    const webhookToken = existing?.webhookToken ?? randomBytes(24).toString('hex');

    const data = {
      environment: input.environment ?? existing?.environment ?? 'PRODUCTION',
      enabled: input.enabled ?? existing?.enabled ?? false,
      credentialsEnc,
      certificateEnc,
      certificatePassEnc,
      pixKey: input.pixKey !== undefined ? input.pixKey : (existing?.pixKey ?? null),
      defaultChargeKind: input.defaultChargeKind ?? existing?.defaultChargeKind ?? 'BOLIX',
      expirationDays: input.expirationDays ?? existing?.expirationDays ?? 3,
      autoGenerate: input.autoGenerate ?? existing?.autoGenerate ?? false,
      finePercent:
        input.finePercent !== undefined ? input.finePercent : (existing?.finePercent ?? null),
      interestPercent:
        input.interestPercent !== undefined
          ? input.interestPercent
          : (existing?.interestPercent ?? null),
      webhookToken,
      // Mudou credencial/ambiente/chave → precisa registrar webhook de novo.
      pixWebhookRegistered:
        credsChanged ||
        (input.environment && input.environment !== existing?.environment) ||
        (input.pixKey !== undefined && input.pixKey !== existing?.pixKey)
          ? false
          : (existing?.pixWebhookRegistered ?? false),
    } as const;

    const saved = await this.prisma.efiConfig.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });

    if (credsChanged) {
      const creds = this.readCreds(saved);
      if (creds) this.client.clearTokenCache(creds.clientId);
    }

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'efi.config.updated',
      resource: 'efi_config',
      resourceId: saved.id,
      metadata: {
        environment: saved.environment,
        enabled: saved.enabled,
        credsChanged,
        certificateChanged: certificateEnc !== (existing?.certificateEnc ?? null),
      },
    });

    return this.toResponse(tenantId, saved);
  }

  // ---------------------------------------------------------------------------
  // RESOLVE (segredos decifrados, pronto pro client)
  // ---------------------------------------------------------------------------
  async resolve(tenantId: string): Promise<EfiResolvedConfig> {
    const cfg = await this.findRaw(tenantId);
    if (!cfg || !cfg.enabled) {
      throw new BadRequestException('Integração EFI não está habilitada para este provedor');
    }
    const creds = this.readCreds(cfg);
    if (!creds) {
      throw new BadRequestException('Credenciais do EFI não configuradas');
    }
    let certificate: EfiResolvedConfig['certificate'] = null;
    if (cfg.certificateEnc) {
      const base64 = this.crypto.decrypt(cfg.certificateEnc);
      certificate = {
        pfx: Buffer.from(base64, 'base64'),
        passphrase: this.crypto.decryptOptional(cfg.certificatePassEnc) ?? '',
      };
    }
    return {
      environment: cfg.environment,
      credentials: creds,
      certificate,
      pixKey: cfg.pixKey,
      expirationDays: cfg.expirationDays,
      finePercent: cfg.finePercent != null ? Number(cfg.finePercent) : null,
      interestPercent: cfg.interestPercent != null ? Number(cfg.interestPercent) : null,
    };
  }

  /** Marca que o webhook Pix foi registrado no EFI. */
  async markPixWebhookRegistered(tenantId: string): Promise<void> {
    await this.prisma.efiConfig.update({
      where: { tenantId },
      data: { pixWebhookRegistered: true },
    });
  }

  /**
   * Registra o webhook Pix no EFI para a chave recebedora do tenant. Exige
   * EFI_PUBLIC_WEBHOOK_BASE (URL pública alcançável pelo EFI) no servidor.
   */
  async registerPixWebhook(tenantId: string, actorUserId: string): Promise<{ url: string }> {
    const cfg = await this.resolve(tenantId);
    if (!cfg.pixKey) throw new BadRequestException('Chave Pix recebedora não configurada');
    if (!cfg.certificate) throw new BadRequestException('Certificado .p12 não configurado');
    const row = await this.findRaw(tenantId);
    const urls = this.buildWebhookUrls(row?.webhookToken ?? null);
    if (!urls.pix || !process.env.EFI_PUBLIC_WEBHOOK_BASE) {
      throw new BadRequestException('EFI_PUBLIC_WEBHOOK_BASE não configurada no servidor');
    }
    await this.client.registerPixWebhook(cfg, cfg.pixKey, urls.pix);
    await this.markPixWebhookRegistered(tenantId);
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'efi.webhook.registered',
      resource: 'efi_config',
      resourceId: tenantId,
      metadata: { url: urls.pix },
    });
    return { url: urls.pix };
  }

  /** Resolve config a partir do token do webhook (rota pública). */
  async findByWebhookToken(token: string): Promise<EfiConfig | null> {
    if (!token) return null;
    return this.prisma.efiConfig.findFirst({ where: { webhookToken: token } });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  private readCreds(cfg: EfiConfig | null): { clientId: string; clientSecret: string } | null {
    if (!cfg?.credentialsEnc) return null;
    try {
      const obj = JSON.parse(this.crypto.decrypt(cfg.credentialsEnc));
      if (obj?.clientId && obj?.clientSecret) return obj;
    } catch (e) {
      this.logger.error(`Falha ao decifrar credenciais EFI do tenant ${cfg.tenantId}: ${String(e)}`);
    }
    return null;
  }

  private buildWebhookUrls(token: string | null): {
    pix: string | null;
    boleto: string | null;
  } {
    if (!token) return { pix: null, boleto: null };
    const base = (process.env.EFI_PUBLIC_WEBHOOK_BASE ?? '').replace(/\/+$/, '');
    const pixPath = `/efi/webhook/pix/${token}`;
    const boletoPath = `/efi/webhook/boleto/${token}`;
    return {
      pix: base ? `${base}${pixPath}` : pixPath,
      boleto: base ? `${base}${boletoPath}` : boletoPath,
    };
  }

  private toResponse(tenantId: string, cfg: EfiConfig | null): EfiConfigResponse {
    const urls = this.buildWebhookUrls(cfg?.webhookToken ?? null);
    return {
      tenantId,
      environment: cfg?.environment ?? 'PRODUCTION',
      enabled: cfg?.enabled ?? false,
      hasCredentials: !!cfg?.credentialsEnc,
      hasCertificate: !!cfg?.certificateEnc,
      pixKey: cfg?.pixKey ?? null,
      defaultChargeKind: cfg?.defaultChargeKind ?? 'BOLIX',
      expirationDays: cfg?.expirationDays ?? 3,
      autoGenerate: cfg?.autoGenerate ?? false,
      finePercent: cfg?.finePercent != null ? Number(cfg.finePercent) : null,
      interestPercent: cfg?.interestPercent != null ? Number(cfg.interestPercent) : null,
      pixWebhookRegistered: cfg?.pixWebhookRegistered ?? false,
      pixWebhookUrl: urls.pix,
      boletoNotificationUrl: urls.boleto,
      createdAt: cfg?.createdAt?.toISOString() ?? null,
      updatedAt: cfg?.updatedAt?.toISOString() ?? null,
    };
  }
}

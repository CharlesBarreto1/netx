import { randomBytes } from 'node:crypto';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { BrPaymentGateway, BtgConfigResponse, UpsertBtgConfigRequest } from '@netx/shared';
import type { BtgConfig } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';

import { BtgClientService } from './btg-client.service';
import { BTG_API_BASE, BTG_DEFAULT_SCOPES, BTG_ID_BASE, type BtgResolvedConfig } from './btg.types';

@Injectable()
export class BtgConfigService {
  private readonly logger = new Logger(BtgConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly client: BtgClientService,
  ) {}

  // ---------------------------------------------------------------------------
  // READ
  // ---------------------------------------------------------------------------
  async get(tenantId: string): Promise<BtgConfigResponse> {
    const cfg = await this.prisma.btgConfig.findUnique({ where: { tenantId } });
    return this.toResponse(tenantId, cfg);
  }

  /** Linha bruta (uso interno). */
  private findRaw(tenantId: string): Promise<BtgConfig | null> {
    return this.prisma.btgConfig.findUnique({ where: { tenantId } });
  }

  // ---------------------------------------------------------------------------
  // UPSERT (admin)
  // ---------------------------------------------------------------------------
  async upsert(
    tenantId: string,
    actorUserId: string,
    input: UpsertBtgConfigRequest,
  ): Promise<BtgConfigResponse> {
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

    const webhookToken = existing?.webhookToken ?? randomBytes(24).toString('hex');

    // Mudou credencial/ambiente/redirect → o consentimento anterior não vale
    // mais; zera o refresh_token p/ forçar reautorização.
    const envChanged = !!input.environment && input.environment !== existing?.environment;
    const redirectChanged =
      input.redirectUri !== undefined && input.redirectUri !== existing?.redirectUri;
    const invalidateConsent = credsChanged || envChanged || redirectChanged;

    const data = {
      environment: input.environment ?? existing?.environment ?? 'SANDBOX',
      enabled: input.enabled ?? existing?.enabled ?? false,
      credentialsEnc,
      redirectUri:
        input.redirectUri !== undefined ? input.redirectUri : (existing?.redirectUri ?? null),
      scopes: input.scopes !== undefined ? input.scopes : (existing?.scopes ?? null),
      companyId: input.companyId !== undefined ? input.companyId : (existing?.companyId ?? null),
      accountNumber:
        input.accountNumber !== undefined
          ? input.accountNumber
          : (existing?.accountNumber ?? null),
      accountBranch:
        input.accountBranch !== undefined
          ? input.accountBranch
          : (existing?.accountBranch ?? null),
      pixKey: input.pixKey !== undefined ? input.pixKey : (existing?.pixKey ?? null),
      defaultChargeKind: input.defaultChargeKind ?? existing?.defaultChargeKind ?? 'BOLETO',
      expirationDays: input.expirationDays ?? existing?.expirationDays ?? 3,
      autoGenerate: input.autoGenerate ?? existing?.autoGenerate ?? false,
      finePercent:
        input.finePercent !== undefined ? input.finePercent : (existing?.finePercent ?? null),
      interestPercent:
        input.interestPercent !== undefined
          ? input.interestPercent
          : (existing?.interestPercent ?? null),
      webhookToken,
      ...(invalidateConsent
        ? { refreshTokenEnc: null, authorizedAt: null, authorizedBy: null, oauthState: null }
        : {}),
    } as const;

    const saved = await this.prisma.btgConfig.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });

    if (credsChanged || envChanged) {
      const creds = this.readCreds(saved);
      if (creds) this.client.clearTokenCache(creds.clientId);
    }

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'btg.config.updated',
      resource: 'btg_config',
      resourceId: saved.id,
      metadata: {
        environment: saved.environment,
        enabled: saved.enabled,
        credsChanged,
        invalidateConsent,
      },
    });

    return this.toResponse(tenantId, saved);
  }

  // ---------------------------------------------------------------------------
  // OAuth — consentimento (Authorization Code)
  // ---------------------------------------------------------------------------
  /** Gera o state anti-CSRF, persiste e devolve a URL de consentimento. */
  async startAuthorization(tenantId: string): Promise<{ authorizeUrl: string }> {
    const resolved = await this.resolve(tenantId);
    if (!resolved.redirectUri) {
      throw new BadRequestException('Configure a redirectUri antes de autorizar');
    }
    const state = `${tenantId}.${randomBytes(16).toString('hex')}`;
    await this.prisma.btgConfig.update({ where: { tenantId }, data: { oauthState: state } });
    const authorizeUrl = this.client.buildAuthorizeUrl(resolved, state);
    this.logger.log(
      `[btg-authorize] tenant=${tenantId} env=${resolved.environment} ` +
        `clientId=${resolved.credentials.clientId} url=${authorizeUrl}`,
    );
    return { authorizeUrl };
  }

  // ---------------------------------------------------------------------------
  // DIAGNÓSTICO — descobre por que o consentimento/token falha.
  //  - Mostra a authorizeUrl exata (compare o client_id com o console BTG).
  //  - Faz client_credentials contra AMBOS os hosts BTG Id (sandbox+produção):
  //    valida o client_id/secret no MESMO registro que o /authorize usa, então
  //    um app-not-found aqui = client_id não existe naquele ambiente.
  // ---------------------------------------------------------------------------
  async diagnose(tenantId: string): Promise<{
    environment: string;
    idBase: string;
    apiBase: string;
    clientId: string;
    redirectUri: string | null;
    scopes: string;
    companyId: string | null;
    authorizeUrl: string | null;
    probes: Array<{
      env: string;
      idBase: string;
      ok: boolean;
      status: number;
      hint: string;
      body: unknown;
    }>;
  }> {
    const cfg = await this.findRaw(tenantId);
    if (!cfg) throw new BadRequestException('Configure o BTG antes de diagnosticar');
    const resolved = this.resolveFrom(cfg);

    let authorizeUrl: string | null = null;
    try {
      authorizeUrl = this.client.buildAuthorizeUrl(resolved, `${tenantId}.diagnose`);
    } catch {
      authorizeUrl = null;
    }

    const envs: Array<{ env: 'SANDBOX' | 'PRODUCTION'; idBase: string }> = [
      { env: 'SANDBOX', idBase: BTG_ID_BASE.SANDBOX },
      { env: 'PRODUCTION', idBase: BTG_ID_BASE.PRODUCTION },
    ];
    const probes = await Promise.all(
      envs.map(async ({ env, idBase }) => {
        const r = await this.client.tokenProbe(
          idBase,
          resolved.credentials.clientId,
          resolved.credentials.clientSecret,
          { grant_type: 'client_credentials', scope: 'apps' },
        );
        const brn =
          r.body && typeof r.body === 'object' ? (r.body as Record<string, unknown>).brn : undefined;
        let hint: string;
        if (r.ok) hint = 'client_id/secret VÁLIDOS neste ambiente ✅';
        else if (typeof brn === 'string' && brn.includes('app-not-found'))
          hint = 'app NÃO existe neste BTG Id ❌';
        else if (r.status === 401) hint = 'client_id existe mas secret inválido (401)';
        else hint = `falhou (${r.status})`;
        return { env, idBase, ok: r.ok, status: r.status, hint, body: r.body };
      }),
    );

    this.logger.log(
      `[btg-diagnose] tenant=${tenantId} env=${resolved.environment} clientId=${resolved.credentials.clientId} ` +
        probes.map((p) => `${p.env}:${p.status}`).join(' '),
    );

    return {
      environment: resolved.environment,
      idBase: BTG_ID_BASE[resolved.environment],
      apiBase: BTG_API_BASE[resolved.environment],
      clientId: resolved.credentials.clientId,
      redirectUri: resolved.redirectUri,
      scopes: resolved.scopes,
      companyId: resolved.companyId,
      authorizeUrl,
      probes,
    };
  }

  /**
   * Callback do BTG Id: valida o state, troca o code por tokens e guarda o
   * refresh_token cifrado. Retorna o tenantId pra rota redirecionar de volta.
   */
  async handleCallback(state: string, code: string): Promise<{ tenantId: string }> {
    const tenantId = state.split('.')[0] ?? '';
    const cfg = await this.findRaw(tenantId);
    if (!cfg || !cfg.oauthState || cfg.oauthState !== state) {
      throw new BadRequestException('state inválido ou expirado no callback BTG');
    }
    const resolved = await this.resolveFrom(cfg);
    const tokens = await this.client.exchangeAuthorizationCode(resolved, code);
    if (!tokens.refresh_token) {
      throw new BadRequestException(
        'BTG não retornou refresh_token — verifique o escopo offline_access',
      );
    }
    await this.prisma.btgConfig.update({
      where: { tenantId },
      data: {
        refreshTokenEnc: this.crypto.encrypt(tokens.refresh_token),
        authorizedAt: new Date(),
        oauthState: null,
        scopes: tokens.scope ?? cfg.scopes,
      },
    });
    this.client.clearTokenCache(resolved.credentials.clientId);
    await this.audit.log({
      tenantId,
      action: 'btg.consent.granted',
      actor: 'oauth:btg-callback',
      resource: 'btg_config',
      resourceId: cfg.id,
      metadata: { scope: tokens.scope ?? null },
    });
    return { tenantId };
  }

  /** Persiste um refresh_token rotacionado pelo BTG (callback do client). */
  async persistRotatedRefreshToken(tenantId: string, newRefreshToken: string): Promise<void> {
    await this.prisma.btgConfig.update({
      where: { tenantId },
      data: { refreshTokenEnc: this.crypto.encrypt(newRefreshToken) },
    });
  }

  // ---------------------------------------------------------------------------
  // Gateway BR ativo (coexistência EFI×BTG) — TenantSetting finance.br.gateway
  // ---------------------------------------------------------------------------
  async getBrGateway(tenantId: string): Promise<BrPaymentGateway> {
    const row = await this.prisma.tenantSetting.findUnique({
      where: { tenantId_key: { tenantId, key: 'finance.br.gateway' } },
    });
    const v = typeof row?.value === 'string' ? row.value : undefined;
    // Padrão pré-preenchido do tenant pra contratos novos. MANUAL se ausente.
    return v === 'EFI' || v === 'BTG' || v === 'MANUAL' ? v : 'MANUAL';
  }

  async setBrGateway(
    tenantId: string,
    actorUserId: string,
    gateway: BrPaymentGateway,
  ): Promise<{ gateway: BrPaymentGateway }> {
    await this.prisma.tenantSetting.upsert({
      where: { tenantId_key: { tenantId, key: 'finance.br.gateway' } },
      create: { tenantId, key: 'finance.br.gateway', value: gateway },
      update: { value: gateway },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'btg.gateway.updated',
      resource: 'tenant_settings',
      resourceId: tenantId,
      metadata: { gateway },
    });
    return { gateway };
  }

  /** Fábrica do callback de rotação de refresh_token amarrado a um tenant. */
  makePersistRefresh(tenantId: string) {
    return (newRefreshToken: string) =>
      this.persistRotatedRefreshToken(tenantId, newRefreshToken);
  }

  /** Secret do webhook BTG (decifrado) — usado p/ validar o Bearer recebido. */
  webhookSecret(cfg: BtgConfig): string | null {
    return this.crypto.decryptOptional(cfg.webhookSecretEnc);
  }

  // ---------------------------------------------------------------------------
  // WEBHOOK — registro no BTG
  // ---------------------------------------------------------------------------
  /**
   * Registra (ou re-registra) o webhook no BTG p/ esta conta. Gera um secret
   * aleatório se ainda não houver, e guarda o webhookId retornado. Exige
   * BTG_PUBLIC_WEBHOOK_BASE no servidor (URL alcançável pelo BTG).
   */
  async registerWebhook(tenantId: string, actorUserId: string): Promise<{ url: string }> {
    const row = await this.findRaw(tenantId);
    if (!row) throw new BadRequestException('Configure o BTG antes de registrar o webhook');
    const url = this.webhookUrl(row.webhookToken);
    if (!url || !process.env.BTG_PUBLIC_WEBHOOK_BASE) {
      throw new BadRequestException('BTG_PUBLIC_WEBHOOK_BASE não configurada no servidor');
    }
    const resolved = this.resolveFrom(row);

    let secret = this.crypto.decryptOptional(row.webhookSecretEnc);
    if (!secret) secret = randomBytes(24).toString('hex');

    const res = await this.client.registerWebhook(resolved, this.makePersistRefresh(tenantId), {
      appId: resolved.credentials.clientId,
      endpoint: url,
      secret,
      events: ['bank-slips.*', 'collections.*', 'pix-cash-in.*', 'automatic-pix.*'],
      description: 'NetX — baixa automática de cobranças',
    });

    await this.prisma.btgConfig.update({
      where: { tenantId },
      data: {
        webhookSecretEnc: this.crypto.encrypt(secret),
        webhookId: res.webhookId ?? row.webhookId ?? null,
      },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'btg.webhook.registered',
      resource: 'btg_config',
      resourceId: row.id,
      metadata: { url, webhookId: res.webhookId ?? null },
    });
    return { url };
  }

  // ---------------------------------------------------------------------------
  // RESOLVE (segredos decifrados, pronto pro client)
  // ---------------------------------------------------------------------------
  async resolve(tenantId: string): Promise<BtgResolvedConfig> {
    const cfg = await this.findRaw(tenantId);
    if (!cfg || !cfg.enabled) {
      throw new BadRequestException('Integração BTG não está habilitada para este provedor');
    }
    return this.resolveFrom(cfg);
  }

  private resolveFrom(cfg: BtgConfig): BtgResolvedConfig {
    const creds = this.readCreds(cfg);
    if (!creds) throw new BadRequestException('Credenciais do BTG não configuradas');
    return {
      tenantId: cfg.tenantId,
      environment: cfg.environment,
      credentials: creds,
      refreshToken: this.crypto.decryptOptional(cfg.refreshTokenEnc),
      redirectUri: cfg.redirectUri,
      scopes: cfg.scopes ?? BTG_DEFAULT_SCOPES,
      companyId: cfg.companyId,
      accountNumber: cfg.accountNumber,
      accountBranch: cfg.accountBranch,
      pixKey: cfg.pixKey,
      expirationDays: cfg.expirationDays,
      finePercent: cfg.finePercent != null ? Number(cfg.finePercent) : null,
      interestPercent: cfg.interestPercent != null ? Number(cfg.interestPercent) : null,
    };
  }

  /** Resolve config a partir do token do webhook (rota pública). */
  async findByWebhookToken(token: string): Promise<BtgConfig | null> {
    if (!token) return null;
    return this.prisma.btgConfig.findFirst({ where: { webhookToken: token } });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  private readCreds(cfg: BtgConfig | null): { clientId: string; clientSecret: string } | null {
    if (!cfg?.credentialsEnc) return null;
    try {
      const obj = JSON.parse(this.crypto.decrypt(cfg.credentialsEnc));
      if (obj?.clientId && obj?.clientSecret) return obj;
    } catch (e) {
      this.logger.error(`Falha ao decifrar credenciais BTG do tenant ${cfg.tenantId}: ${String(e)}`);
    }
    return null;
  }

  private webhookUrl(token: string | null): string | null {
    if (!token) return null;
    const base = (process.env.BTG_PUBLIC_WEBHOOK_BASE ?? '').replace(/\/+$/, '');
    const path = `/btg/webhook/${token}`;
    return base ? `${base}${path}` : path;
  }

  private toResponse(tenantId: string, cfg: BtgConfig | null): BtgConfigResponse {
    return {
      tenantId,
      environment: cfg?.environment ?? 'SANDBOX',
      enabled: cfg?.enabled ?? false,
      hasCredentials: !!cfg?.credentialsEnc,
      authorized: !!cfg?.refreshTokenEnc,
      authorizedAt: cfg?.authorizedAt?.toISOString() ?? null,
      redirectUri: cfg?.redirectUri ?? null,
      scopes: cfg?.scopes ?? null,
      companyId: cfg?.companyId ?? null,
      accountNumber: cfg?.accountNumber ?? null,
      accountBranch: cfg?.accountBranch ?? null,
      pixKey: cfg?.pixKey ?? null,
      defaultChargeKind: cfg?.defaultChargeKind ?? 'BOLETO',
      expirationDays: cfg?.expirationDays ?? 3,
      autoGenerate: cfg?.autoGenerate ?? false,
      finePercent: cfg?.finePercent != null ? Number(cfg.finePercent) : null,
      interestPercent: cfg?.interestPercent != null ? Number(cfg.interestPercent) : null,
      webhookUrl: this.webhookUrl(cfg?.webhookToken ?? null),
      webhookRegistered: !!cfg?.webhookId && !!cfg?.webhookSecretEnc,
      createdAt: cfg?.createdAt?.toISOString() ?? null,
      updatedAt: cfg?.updatedAt?.toISOString() ?? null,
    };
  }
}

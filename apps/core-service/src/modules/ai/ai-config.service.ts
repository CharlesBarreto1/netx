/**
 * AiConfigService — config do motor de IA por tenant (CRUD + view + montagem
 * do AiEngineConfig efetivo). Espelha EfiConfigService: segredos write-only,
 * cifrados com CryptoService (v1:iv:tag:ct).
 *
 * Sem linha (ou desabilitada) ⇒ cai nos defaults de ambiente (aiConfigFromEnv),
 * que apontam pro Ollama local. Assim o motor funciona "out of the box" sem
 * config por tenant, e a config por tenant só especializa.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { AiConfig, AiProviderKind } from '@prisma/client';

import { aiConfigFromEnv, type AiEngineConfig, type AiLogger, type ProviderKind } from '@netx/ai';
import type { AiConfigResponse, UpsertAiConfigRequest } from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';

const KIND_TO_DOMAIN: Record<AiProviderKind, ProviderKind> = {
  OLLAMA: 'ollama',
  OPENAI_COMPAT: 'openai-compat',
  ANTHROPIC: 'anthropic',
};

@Injectable()
export class AiConfigService {
  private readonly logger = new Logger(AiConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  findRaw(tenantId: string): Promise<AiConfig | null> {
    return this.prisma.aiConfig.findUnique({ where: { tenantId } });
  }

  async get(tenantId: string): Promise<AiConfigResponse> {
    const cfg = await this.findRaw(tenantId);
    return this.toResponse(tenantId, cfg);
  }

  /** UPSERT — segredos write-only: ausentes/'' mantêm o valor atual. */
  async upsert(
    tenantId: string,
    actorUserId: string,
    input: UpsertAiConfigRequest,
  ): Promise<AiConfigResponse> {
    const existing = await this.findRaw(tenantId);

    const apiKeyEnc = this.nextSecret(existing?.apiKeyEnc ?? null, input.apiKey);
    const fallbackApiKeyEnc = this.nextSecret(
      existing?.fallbackApiKeyEnc ?? null,
      input.fallbackApiKey,
    );

    const data = {
      enabled: input.enabled ?? existing?.enabled ?? false,
      provider: (input.provider ?? existing?.provider ?? 'OLLAMA') as AiProviderKind,
      baseUrl: input.baseUrl === undefined ? (existing?.baseUrl ?? null) : input.baseUrl,
      model: input.model ?? existing?.model ?? 'qwen2.5:3b-instruct',
      apiKeyEnc,
      fallbackEnabled: input.fallbackEnabled ?? existing?.fallbackEnabled ?? false,
      fallbackProvider: (input.fallbackProvider ??
        existing?.fallbackProvider ??
        'ANTHROPIC') as AiProviderKind,
      fallbackModel: input.fallbackModel ?? existing?.fallbackModel ?? 'claude-haiku-4-5',
      fallbackBaseUrl:
        input.fallbackBaseUrl === undefined
          ? (existing?.fallbackBaseUrl ?? null)
          : input.fallbackBaseUrl,
      fallbackApiKeyEnc,
      maxTokens: input.maxTokens ?? existing?.maxTokens ?? 1024,
      timeoutMs: input.timeoutMs ?? existing?.timeoutMs ?? 180_000,
      redactPii: input.redactPii ?? existing?.redactPii ?? true,
    };

    const saved = await this.prisma.aiConfig.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'ai.config.upsert',
      resource: 'ai_config',
      resourceId: saved.id,
      metadata: {
        enabled: saved.enabled,
        provider: saved.provider,
        model: saved.model,
        fallbackEnabled: saved.fallbackEnabled,
      },
    });

    return this.toResponse(tenantId, saved);
  }

  /**
   * Monta o AiEngineConfig efetivo. `raw` null/desabilitado ⇒ defaults de env
   * (Ollama local). `logger` pluga a observabilidade (AiUsageLog).
   */
  buildEngineConfig(raw: AiConfig | null, logger: AiLogger): AiEngineConfig {
    if (!raw || !raw.enabled) {
      const base = aiConfigFromEnv();
      base.logger = logger;
      return base;
    }
    return {
      primary: {
        kind: KIND_TO_DOMAIN[raw.provider],
        baseUrl: raw.baseUrl ?? undefined,
        apiKey: this.readSecret(raw.apiKeyEnc),
        model: raw.model,
      },
      fallback: raw.fallbackEnabled
        ? {
            kind: KIND_TO_DOMAIN[raw.fallbackProvider],
            baseUrl: raw.fallbackBaseUrl ?? undefined,
            // Anthropic reaproveita ANTHROPIC_API_KEY se não houver chave salva.
            apiKey:
              this.readSecret(raw.fallbackApiKeyEnc) ??
              (raw.fallbackProvider === 'ANTHROPIC'
                ? process.env.ANTHROPIC_API_KEY?.trim() || undefined
                : undefined),
            model: raw.fallbackModel,
          }
        : undefined,
      fallbackEnabled: raw.fallbackEnabled,
      defaultMaxTokens: raw.maxTokens,
      defaultTimeoutMs: raw.timeoutMs,
      redactPii: raw.redactPii,
      logger,
    };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Cifra um novo segredo só quando veio valor não-vazio; senão mantém. */
  private nextSecret(current: string | null, incoming?: string): string | null {
    const v = incoming?.trim();
    if (!v) return current;
    return this.crypto.encrypt(v);
  }

  private readSecret(enc: string | null): string | undefined {
    if (!enc) return undefined;
    try {
      return this.crypto.decrypt(enc);
    } catch (e) {
      this.logger.error(`falha ao decifrar segredo de IA: ${String(e)}`);
      return undefined;
    }
  }

  private toResponse(tenantId: string, cfg: AiConfig | null): AiConfigResponse {
    if (!cfg) {
      // Espelha os defaults de ambiente pra UI mostrar o estado real.
      const env = aiConfigFromEnv();
      return {
        tenantId,
        enabled: false,
        provider: env.primary.kind.toUpperCase().replace('-', '_') as AiConfigResponse['provider'],
        baseUrl: env.primary.baseUrl ?? null,
        model: env.primary.model,
        hasApiKey: Boolean(env.primary.apiKey),
        fallbackEnabled: env.fallbackEnabled,
        fallbackProvider: (env.fallback?.kind ?? 'anthropic')
          .toUpperCase()
          .replace('-', '_') as AiConfigResponse['fallbackProvider'],
        fallbackModel: env.fallback?.model ?? 'claude-haiku-4-5',
        fallbackBaseUrl: env.fallback?.baseUrl ?? null,
        hasFallbackApiKey: Boolean(env.fallback?.apiKey),
        maxTokens: env.defaultMaxTokens,
        timeoutMs: env.defaultTimeoutMs,
        redactPii: env.redactPii,
        updatedAt: null,
      };
    }
    return {
      tenantId,
      enabled: cfg.enabled,
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      hasApiKey: Boolean(cfg.apiKeyEnc),
      fallbackEnabled: cfg.fallbackEnabled,
      fallbackProvider: cfg.fallbackProvider,
      fallbackModel: cfg.fallbackModel,
      fallbackBaseUrl: cfg.fallbackBaseUrl,
      hasFallbackApiKey: Boolean(cfg.fallbackApiKeyEnc),
      maxTokens: cfg.maxTokens,
      timeoutMs: cfg.timeoutMs,
      redactPii: cfg.redactPii,
      updatedAt: cfg.updatedAt.toISOString(),
    };
  }
}

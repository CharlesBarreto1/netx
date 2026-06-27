/**
 * AiService — fachada do motor de IA para o resto do core-service.
 *
 * Resolve um AiEngine POR TENANT (config da linha AiConfig ou defaults de env),
 * com cache invalidado pelo updatedAt. Pluga observabilidade (AiUsageLog) e
 * expõe métodos de alto nível: chat / json / status / test.
 *
 * Regra de ouro: CONSELHEIRA. Só gera texto/estrutura — nunca executa ação.
 * Quem chama deve validar e jamais aplicar config automaticamente.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { AiProviderKind } from '@prisma/client';

import { createAiEngine, type AiEngine, type AiLogger, type ChatMessage, type ChatOptions, type ChatResult } from '@netx/ai';
import type { AiStatusResponse, AiTestResponse } from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AiConfigService } from './ai-config.service';

const DOMAIN_TO_KIND: Record<string, AiProviderKind> = {
  ollama: 'OLLAMA',
  'openai-compat': 'OPENAI_COMPAT',
  anthropic: 'ANTHROPIC',
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  /** Cache de engine por tenant. key = versão da config (updatedAt | 'env'). */
  private readonly engines = new Map<string, { key: string; engine: AiEngine }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AiConfigService,
  ) {}

  /** Resolve (e cacheia) o engine efetivo do tenant. */
  async getEngine(tenantId: string): Promise<AiEngine> {
    const raw = await this.config.findRaw(tenantId);
    const key = raw?.enabled ? `db:${raw.updatedAt.getTime()}` : 'env';
    const hit = this.engines.get(tenantId);
    if (hit && hit.key === key) return hit.engine;

    const engineCfg = this.config.buildEngineConfig(raw, this.makeLogger(tenantId));
    const engine = createAiEngine(engineCfg);
    this.engines.set(tenantId, { key, engine });
    return engine;
  }

  /** Chat livre (grounded). `feature` rotula o uso. */
  async chat(
    tenantId: string,
    messages: ChatMessage[],
    opts: ChatOptions = {},
    feature?: string,
  ): Promise<ChatResult> {
    const engine = await this.getEngine(tenantId);
    return engine.chat(messages, opts, feature);
  }

  /** Chat com saída estruturada (JSON Schema) já parseada. */
  async json<T>(
    tenantId: string,
    messages: ChatMessage[],
    schema: ChatOptions['schema'],
    opts: ChatOptions = {},
    feature?: string,
  ): Promise<T> {
    const engine = await this.getEngine(tenantId);
    return engine.json<T>(messages, schema, opts, feature);
  }

  /** Status do motor do tenant (para /ai/status e UI). */
  async status(tenantId: string): Promise<AiStatusResponse> {
    const engine = await this.getEngine(tenantId);
    return engine.describe();
  }

  async available(tenantId: string): Promise<boolean> {
    const engine = await this.getEngine(tenantId);
    return engine.available();
  }

  /** "Testar conexão" — manda um prompt mínimo e devolve prova de vida. */
  async test(tenantId: string): Promise<AiTestResponse> {
    try {
      const r = await this.chat(
        tenantId,
        [{ role: 'user', content: 'Responda apenas: OK' }],
        { maxTokens: 16, temperature: 0 },
        'config.test',
      );
      return {
        ok: true,
        provider: r.provider,
        model: r.model,
        usedFallback: r.usedFallback,
        latencyMs: r.latencyMs,
        sample: r.text.slice(0, 120),
      };
    } catch (e) {
      return {
        ok: false,
        provider: '',
        model: '',
        usedFallback: false,
        latencyMs: 0,
        sample: '',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /** Invalida o cache de engine do tenant (após upsert de config). */
  invalidate(tenantId: string): void {
    this.engines.delete(tenantId);
  }

  // ── observabilidade ──────────────────────────────────────────────────────

  private makeLogger(tenantId: string): AiLogger {
    return {
      warn: (msg) => this.logger.warn(`[${tenantId}] ${msg}`),
      onUsage: (e) => {
        // fire-and-forget: log de uso nunca bloqueia nem derruba a chamada.
        void this.prisma.aiUsageLog
          .create({
            data: {
              tenantId,
              feature: (e.feature ?? 'unknown').slice(0, 80),
              provider: DOMAIN_TO_KIND[e.provider] ?? 'OLLAMA',
              model: e.model.slice(0, 120),
              usedFallback: e.usedFallback,
              ok: e.ok,
              latencyMs: Math.round(e.latencyMs),
              inputTokens: e.inputTokens ?? null,
              outputTokens: e.outputTokens ?? null,
              error: e.error?.slice(0, 500) ?? null,
            },
          })
          .catch((err) => this.logger.warn(`falha ao gravar AiUsageLog: ${String(err)}`));
      },
    };
  }
}

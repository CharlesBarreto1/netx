import { AnthropicProvider } from './providers/anthropic.provider';
import { OllamaProvider } from './providers/ollama.provider';
import { OpenAiCompatProvider } from './providers/openai-compat.provider';
import type { AiProvider, ResolvedAgentOptions, ResolvedChatOptions } from './providers/provider';
import { redactMessages } from './redact';
import type {
  AgentOptions,
  AgentResult,
  AiEngineConfig,
  ChatMessage,
  ChatOptions,
  ChatResult,
  ProviderSettings,
  ToolDef,
  ToolExecutor,
} from './types';

function buildProvider(settings: ProviderSettings): AiProvider {
  switch (settings.kind) {
    case 'ollama':
      return new OllamaProvider(settings);
    case 'openai-compat':
      return new OpenAiCompatProvider(settings);
    case 'anthropic':
      return new AnthropicProvider(settings);
    default: {
      const exhaustive: never = settings.kind;
      throw new Error(`provider desconhecido: ${String(exhaustive)}`);
    }
  }
}

/**
 * O motor de IA do NetX. Resolve provider primário (aberto/self-hosted) com
 * fallback opcional pra nuvem, aplica defaults, mascara PII antes de sair pra
 * nuvem e emite eventos de uso. É a única porta de entrada — providers são
 * detalhe interno.
 *
 * Conselheiro: o engine só gera texto/estrutura. NUNCA executa ação. Quem chama
 * é responsável por validar e nunca aplicar config automaticamente.
 */
export class AiEngine {
  private readonly primary: AiProvider;
  private readonly fallback: AiProvider | null;

  constructor(private readonly config: AiEngineConfig) {
    this.primary = buildProvider(config.primary);
    this.fallback =
      config.fallbackEnabled && config.fallback ? buildProvider(config.fallback) : null;
  }

  /** true se ao menos um backend está disponível. */
  available(): boolean {
    return this.primary.available() || (this.fallback?.available() ?? false);
  }

  /** Descreve a topologia atual (útil para /ai/status). */
  describe(): {
    available: boolean;
    primary: { kind: string; model: string; available: boolean };
    fallback: { kind: string; model: string; available: boolean } | null;
  } {
    return {
      available: this.available(),
      primary: {
        kind: this.primary.kind,
        model: this.primary.model,
        available: this.primary.available(),
      },
      fallback: this.fallback
        ? {
            kind: this.fallback.kind,
            model: this.fallback.model,
            available: this.fallback.available(),
          }
        : null,
    };
  }

  /**
   * Executa um chat. Tenta o primário; em erro/indisponibilidade cai pro
   * fallback (se habilitado e disponível). `feature` rotula o uso no log.
   */
  async chat(
    messages: ChatMessage[],
    opts: ChatOptions = {},
    feature?: string,
  ): Promise<ChatResult> {
    const full = opts.system
      ? [{ role: 'system' as const, content: opts.system }, ...messages]
      : messages;

    const order: Array<{ provider: AiProvider; isFallback: boolean }> = [];
    if (this.primary.available()) order.push({ provider: this.primary, isFallback: false });
    if (this.fallback?.available()) order.push({ provider: this.fallback, isFallback: true });

    if (order.length === 0) {
      throw new Error('IA indisponível: nenhum backend configurado/disponível');
    }

    let lastErr: unknown;
    for (const { provider, isFallback } of order) {
      const resolved: ResolvedChatOptions = {
        ...opts,
        model: opts.model ?? provider.model,
        maxTokens: opts.maxTokens ?? this.config.defaultMaxTokens,
        temperature: opts.temperature ?? 0.2,
        timeoutMs: opts.timeoutMs ?? this.config.defaultTimeoutMs,
      };
      const payload =
        provider.cloud && this.config.redactPii ? redactMessages(full) : full;
      try {
        const result = await provider.chat(payload, resolved);
        result.usedFallback = isFallback;
        this.config.logger?.onUsage?.({
          provider: result.provider,
          model: result.model,
          latencyMs: result.latencyMs,
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
          usedFallback: isFallback,
          feature,
          ok: true,
        });
        return result;
      } catch (err) {
        lastErr = err;
        this.config.logger?.warn?.(
          `[ai] ${provider.kind} falhou${isFallback ? ' (fallback)' : ''}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        this.config.logger?.onUsage?.({
          provider: provider.kind,
          model: resolved.model,
          latencyMs: 0,
          usedFallback: isFallback,
          feature,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    throw new Error(
      `IA falhou em todos os backends: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
  }

  /**
   * Chat com saída estruturada: força o schema e devolve o objeto já parseado.
   * Lança se a resposta não for JSON válido.
   */
  async json<T>(
    messages: ChatMessage[],
    schema: ChatOptions['schema'],
    opts: ChatOptions = {},
    feature?: string,
  ): Promise<T> {
    const result = await this.chat(messages, { ...opts, schema }, feature);
    try {
      return JSON.parse(result.text) as T;
    } catch {
      throw new Error(
        `IA devolveu JSON inválido (${result.provider}): ${result.text.slice(0, 200)}`,
      );
    }
  }

  /** true se algum backend suporta tool-calling (copiloto agêntico). */
  supportsTools(): boolean {
    return (
      (this.primary.supportsTools && this.primary.available()) ||
      Boolean(this.fallback?.supportsTools && this.fallback.available())
    );
  }

  /**
   * Copiloto agêntico: o modelo chama ferramentas read-only (via `execute`) até
   * compor a resposta com dados reais. Só usa backends com supportsTools. Cai
   * pro fallback se o primário não suportar/falhar.
   */
  async agent(
    messages: ChatMessage[],
    tools: ToolDef[],
    execute: ToolExecutor,
    opts: AgentOptions = {},
    feature?: string,
  ): Promise<AgentResult> {
    const order: Array<{ provider: AiProvider; isFallback: boolean }> = [];
    if (this.primary.supportsTools && this.primary.available() && this.primary.runAgent)
      order.push({ provider: this.primary, isFallback: false });
    if (this.fallback?.supportsTools && this.fallback.available() && this.fallback.runAgent)
      order.push({ provider: this.fallback, isFallback: true });

    if (order.length === 0) {
      throw new Error(
        'Copiloto indisponível: nenhum backend com suporte a ferramentas. Ligue um provider de nuvem (Anthropic / OpenAI-compat).',
      );
    }

    let lastErr: unknown;
    for (const { provider, isFallback } of order) {
      const resolved: ResolvedAgentOptions = {
        model: opts.model ?? provider.model,
        maxTokens: opts.maxTokens ?? this.config.defaultMaxTokens,
        temperature: opts.temperature ?? 0.2,
        timeoutMs: opts.timeoutMs ?? this.config.defaultTimeoutMs,
        maxSteps: opts.maxSteps ?? 6,
        system: opts.system,
        signal: opts.signal,
      };
      // Tools podem trafegar dado sensível; em provider de nuvem, mascara PII.
      const payload =
        provider.cloud && this.config.redactPii ? redactMessages(messages) : messages;
      try {
        const result = await provider.runAgent!(payload, tools, execute, resolved);
        result.usedFallback = isFallback;
        this.config.logger?.onUsage?.({
          provider: result.provider,
          model: result.model,
          latencyMs: result.latencyMs,
          usedFallback: isFallback,
          feature,
          ok: true,
        });
        return result;
      } catch (err) {
        lastErr = err;
        this.config.logger?.warn?.(
          `[ai] agent ${provider.kind} falhou${isFallback ? ' (fallback)' : ''}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        this.config.logger?.onUsage?.({
          provider: provider.kind,
          model: resolved.model,
          latencyMs: 0,
          usedFallback: isFallback,
          feature,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    throw new Error(
      `Copiloto falhou em todos os backends: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
  }
}

/** Constrói um {@link AiEngine} a partir de uma config já montada. */
export function createAiEngine(config: AiEngineConfig): AiEngine {
  return new AiEngine(config);
}

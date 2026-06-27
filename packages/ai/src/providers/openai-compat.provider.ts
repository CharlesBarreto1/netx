import type { ChatMessage, ChatResult, ProviderSettings } from '../types';
import { type AiProvider, type ResolvedChatOptions, withTimeout } from './provider';

/** Hosts privados → o motor é considerado local (não-nuvem) por padrão. */
function isPrivateHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return false;
  }
}

/**
 * Backend genérico que fala o protocolo OpenAI chat-completions
 * (POST {baseUrl}/chat/completions). Serve vLLM, OpenRouter, Groq, Together e
 * qualquer gateway OpenAI-compat servindo modelos abertos.
 *
 * `baseUrl` deve já incluir o sufixo /v1 (ex.: https://api.groq.com/openai/v1).
 */
export class OpenAiCompatProvider implements AiProvider {
  readonly kind = 'openai-compat' as const;
  readonly model: string;
  readonly cloud: boolean;
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(settings: ProviderSettings) {
    this.model = settings.model;
    this.baseUrl = (settings.baseUrl ?? '').replace(/\/+$/, '');
    this.apiKey = settings.apiKey;
    this.cloud = settings.cloud ?? !isPrivateHost(this.baseUrl);
  }

  available(): boolean {
    return Boolean(this.baseUrl);
  }

  async chat(messages: ChatMessage[], opts: ResolvedChatOptions): Promise<ChatResult> {
    const started = Date.now();
    const body: Record<string, unknown> = {
      model: opts.model,
      messages,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
    };
    if (opts.schema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: opts.schemaName ?? 'result', schema: opts.schema, strict: true },
      };
    }

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: withTimeout(opts.timeoutMs, opts.signal),
    });
    if (!resp.ok) {
      throw new Error(`openai-compat ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    }
    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: data.choices?.[0]?.message?.content?.trim() ?? '',
      provider: this.kind,
      model: opts.model,
      usage: {
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
      },
      latencyMs: Date.now() - started,
      usedFallback: false,
    };
  }
}

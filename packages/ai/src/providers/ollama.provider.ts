import type { ChatMessage, ChatResult, ProviderSettings } from '../types';
import { type AiProvider, type ResolvedChatOptions, withTimeout } from './provider';

/**
 * Motor ABERTO default do NetX. Fala a API nativa do Ollama (/api/chat), que dá
 * saída estruturada confiável via `format: <jsonschema>` — mais robusto com
 * modelos locais do que o envelope OpenAI-compat.
 *
 * Self-hosted: roda na própria VPS (http://127.0.0.1:11434). Sem apiKey.
 * Instalar: `curl -fsSL https://ollama.com/install.sh | sh` + `ollama pull <model>`.
 */
export class OllamaProvider implements AiProvider {
  readonly kind = 'ollama' as const;
  readonly model: string;
  readonly cloud: boolean;
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(settings: ProviderSettings) {
    this.model = settings.model;
    this.baseUrl = (settings.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
    this.apiKey = settings.apiKey;
    this.cloud = settings.cloud ?? false; // local por padrão
  }

  available(): boolean {
    return Boolean(this.baseUrl);
  }

  async chat(messages: ChatMessage[], opts: ResolvedChatOptions): Promise<ChatResult> {
    const started = Date.now();
    const body: Record<string, unknown> = {
      model: opts.model,
      messages,
      stream: false,
      options: { temperature: opts.temperature, num_predict: opts.maxTokens },
    };
    if (opts.schema) body.format = opts.schema; // Ollama: structured output nativo

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const resp = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: withTimeout(opts.timeoutMs, opts.signal),
    });
    if (!resp.ok) {
      throw new Error(`Ollama ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    }
    const data = (await resp.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    return {
      text: data.message?.content?.trim() ?? '',
      provider: this.kind,
      model: opts.model,
      usage: { inputTokens: data.prompt_eval_count, outputTokens: data.eval_count },
      latencyMs: Date.now() - started,
      usedFallback: false,
    };
  }
}

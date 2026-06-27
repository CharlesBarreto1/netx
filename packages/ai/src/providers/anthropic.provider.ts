import type { ChatMessage, ChatResult, ProviderSettings } from '../types';
import { type AiProvider, type ResolvedChatOptions, withTimeout } from './provider';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Backend de NUVEM (Anthropic Messages API). No NetX entra como FALLBACK do
 * motor aberto — robustez/tarefas pesadas. Como é nuvem, o engine mascara PII
 * antes de chamar (quando redactPii ligado).
 *
 * A API separa `system` das mensagens user/assistant; consolidamos as system
 * messages do diálogo num único campo system.
 */
export class AnthropicProvider implements AiProvider {
  readonly kind = 'anthropic' as const;
  readonly model: string;
  readonly cloud: boolean;
  private readonly apiKey?: string;

  constructor(settings: ProviderSettings) {
    this.model = settings.model;
    this.apiKey = settings.apiKey;
    this.cloud = settings.cloud ?? true; // sempre nuvem
  }

  available(): boolean {
    return Boolean(this.apiKey?.trim());
  }

  async chat(messages: ChatMessage[], opts: ResolvedChatOptions): Promise<ChatResult> {
    const started = Date.now();
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const turns = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const body: Record<string, unknown> = {
      model: opts.model,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      messages: turns,
    };
    if (system) body.system = system;
    if (opts.schema) {
      body.output_config = { format: { type: 'json_schema', schema: opts.schema } };
    }

    const resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey ?? '',
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: withTimeout(opts.timeoutMs, opts.signal),
    });
    if (!resp.ok) {
      throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    }
    const data = (await resp.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text =
      data.content
        ?.filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('\n')
        .trim() ?? '';
    return {
      text,
      provider: this.kind,
      model: opts.model,
      usage: {
        inputTokens: data.usage?.input_tokens,
        outputTokens: data.usage?.output_tokens,
      },
      latencyMs: Date.now() - started,
      usedFallback: false,
    };
  }
}

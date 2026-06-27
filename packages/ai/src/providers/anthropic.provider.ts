import type {
  AgentResult,
  ChatMessage,
  ChatResult,
  ProviderSettings,
  ToolDef,
  ToolExecutor,
} from '../types';
import {
  type AiProvider,
  type ResolvedAgentOptions,
  type ResolvedChatOptions,
  withTimeout,
} from './provider';

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
type AnthropicBlock =
  | { type: 'text'; text?: string }
  | { type: 'tool_use'; id: string; name: string; input?: Record<string, unknown> }
  | { type: string; [k: string]: unknown };

interface AnthropicConvoMsg {
  role: 'user' | 'assistant';
  content: string | unknown[];
}

export class AnthropicProvider implements AiProvider {
  readonly kind = 'anthropic' as const;
  readonly model: string;
  readonly cloud: boolean;
  readonly supportsTools = true;
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

  /** Loop agêntico nativo (tool_use ↔ tool_result) até a resposta final. */
  async runAgent(
    messages: ChatMessage[],
    tools: ToolDef[],
    execute: ToolExecutor,
    opts: ResolvedAgentOptions,
  ): Promise<AgentResult> {
    const started = Date.now();
    const sys = [
      opts.system,
      messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n'),
    ]
      .filter(Boolean)
      .join('\n\n');

    const convo: AnthropicConvoMsg[] = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));

    const toolsUsed: string[] = [];
    let steps = 0;

    for (let i = 0; i <= opts.maxSteps; i++) {
      const withTools = i < opts.maxSteps; // última volta: força resposta sem tools
      const body: Record<string, unknown> = {
        model: opts.model,
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
        messages: convo,
      };
      if (sys) body.system = sys;
      if (withTools) body.tools = anthropicTools;

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
      const data = (await resp.json()) as { content?: AnthropicBlock[]; stop_reason?: string };
      const content = data.content ?? [];
      convo.push({ role: 'assistant', content });

      if (withTools && data.stop_reason === 'tool_use') {
        steps += 1;
        const toolUses = content.filter(
          (b): b is { type: 'tool_use'; id: string; name: string; input?: Record<string, unknown> } =>
            b.type === 'tool_use',
        );
        const results: unknown[] = [];
        for (const tu of toolUses) {
          toolsUsed.push(tu.name);
          let out: string;
          try {
            const r = await execute({ id: tu.id, name: tu.name, args: tu.input ?? {} });
            out = typeof r === 'string' ? r : JSON.stringify(r);
          } catch (e) {
            out = `ERRO: ${e instanceof Error ? e.message : String(e)}`;
          }
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: out.slice(0, 12000) });
        }
        convo.push({ role: 'user', content: results });
        continue;
      }

      const text = content
        .filter((b): b is { type: 'text'; text?: string } => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('\n')
        .trim();
      return {
        text,
        provider: this.kind,
        model: opts.model,
        usedFallback: false,
        steps,
        toolsUsed,
        latencyMs: Date.now() - started,
      };
    }

    return {
      text: '(não consegui concluir em tempo hábil)',
      provider: this.kind,
      model: opts.model,
      usedFallback: false,
      steps,
      toolsUsed,
      latencyMs: Date.now() - started,
    };
  }
}

import type { ChatMessage, ChatOptions, ChatResult, ProviderKind } from '../types';

/**
 * Contrato de um backend de IA. Cada provider sabe falar com UM tipo de motor
 * (Ollama, OpenAI-compat, Anthropic) e devolve sempre um {@link ChatResult}.
 *
 * Providers são puros transportes: não conhecem fallback, redaction nem audit —
 * isso é responsabilidade do {@link AiEngine}.
 */
export interface AiProvider {
  readonly kind: ProviderKind;
  /** true quando o provider tem o mínimo para operar (ex.: apiKey presente). */
  available(): boolean;
  /** true quando os dados saem da infra do tenant (motor de nuvem). */
  readonly cloud: boolean;
  /** Modelo default deste provider. */
  readonly model: string;
  /** Executa uma chamada de chat. Deve lançar em erro de transporte/timeout. */
  chat(messages: ChatMessage[], opts: ResolvedChatOptions): Promise<ChatResult>;
}

/** Opções já normalizadas pelo engine (sem campos opcionais ambíguos). */
export interface ResolvedChatOptions extends ChatOptions {
  model: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
}

/**
 * Combina o signal externo (se houver) com um timeout interno. Node 20+:
 * AbortSignal.timeout + AbortSignal.any.
 */
export function withTimeout(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([external, timeout]) : timeout;
}

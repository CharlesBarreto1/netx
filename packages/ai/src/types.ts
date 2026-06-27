/**
 * Contratos do motor de IA do NetX (@netx/ai).
 *
 * O motor fala um protocolo único de chat (mensagens role/content) e abstrai
 * QUAL backend responde. O default é aberto/self-hosted (Ollama); a nuvem
 * (Anthropic) entra como fallback opcional. Nenhuma regra de negócio aqui —
 * só transporte + saída estruturada + medição de uso.
 */

/** Papel de uma mensagem na conversa. */
export type ChatRole = 'system' | 'user' | 'assistant';

/** Uma mensagem do diálogo. `content` é sempre texto plano. */
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** Backends suportados. `ollama` é o motor aberto default. */
export type ProviderKind = 'ollama' | 'openai-compat' | 'anthropic';

/**
 * JSON Schema (subset) usado para forçar saída estruturada. Mantemos como um
 * objeto livre porque cada backend aceita o mesmo dialeto JSON-Schema, só muda
 * o envelope. Use `additionalProperties: false` e `required` para robustez.
 */
export type JsonSchema = Record<string, unknown>;

/** Opções de uma chamada de chat. Tudo opcional — o engine preenche defaults. */
export interface ChatOptions {
  /** Sobrescreve o modelo do provider (ex.: 'qwen2.5:7b-instruct'). */
  model?: string;
  /** Teto de tokens de saída. */
  maxTokens?: number;
  /** 0..2 — baixa = determinística (default 0.2 p/ diagnóstico). */
  temperature?: number;
  /** Atalho: prepende uma mensagem system (além das que já estão em messages). */
  system?: string;
  /** Se presente, força a resposta a casar este JSON Schema. */
  schema?: JsonSchema;
  /** Nome do schema (alguns backends exigem). Default 'result'. */
  schemaName?: string;
  /** Timeout em ms desta chamada (sobrescreve o default do engine). */
  timeoutMs?: number;
  /** Cancelamento externo. Combinado com o timeout interno. */
  signal?: AbortSignal;
}

/** Resultado bruto de uma chamada. `text` é o conteúdo; parse fica a cargo de quem chamou. */
export interface ChatResult {
  text: string;
  provider: ProviderKind;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  latencyMs: number;
  /** true quando o provider primário falhou e a resposta veio do fallback. */
  usedFallback: boolean;
}

/** Configuração de um único backend. */
export interface ProviderSettings {
  kind: ProviderKind;
  /** Base da API. Ollama: http://127.0.0.1:11434 · openai-compat: .../v1 */
  baseUrl?: string;
  /** Credencial (Bearer/x-api-key). Vazio para Ollama local. */
  apiKey?: string;
  /** Modelo default deste backend. */
  model: string;
  /**
   * Marca o backend como nuvem (dados saem da infra do tenant). Quando true e
   * `redactPii` ligado, o engine mascara PII antes de enviar. Default inferido:
   * anthropic = true; ollama = false; openai-compat = inferido pela baseUrl.
   */
  cloud?: boolean;
}

/** Configuração completa do motor. */
export interface AiEngineConfig {
  /** Backend primário (o motor aberto, por padrão). */
  primary: ProviderSettings;
  /** Backend de fallback (nuvem), usado só se `fallbackEnabled`. */
  fallback?: ProviderSettings;
  /** Liga o fallback quando o primário falha/indisponível. */
  fallbackEnabled: boolean;
  /** Teto default de tokens de saída. */
  defaultMaxTokens: number;
  /** Timeout default por chamada (ms). */
  defaultTimeoutMs: number;
  /** Mascara PII antes de enviar a um backend `cloud`. Default true. */
  redactPii: boolean;
  /** Hook de observabilidade (uso/latência/erro). Opcional. */
  logger?: AiLogger;
}

/** Eventos de uso emitidos pelo engine (para AiUsageLog na F1). */
export interface AiUsageEvent {
  provider: ProviderKind;
  model: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  usedFallback: boolean;
  /** Rótulo livre da feature que chamou (ex.: 'alarm.summary'). */
  feature?: string;
  ok: boolean;
  error?: string;
}

export interface AiLogger {
  onUsage?(event: AiUsageEvent): void;
  warn?(message: string): void;
}

// -----------------------------------------------------------------------------
// Tool-calling (copiloto agêntico) — o modelo escolhe ferramentas read-only que
// o backend executa e devolve; o modelo compõe a resposta com o dado real.
// A IA continua conselheira: as ferramentas SÓ LEEM, nunca mutam estado.
// -----------------------------------------------------------------------------

/** Definição de uma ferramenta exposta ao modelo. */
export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema dos argumentos de entrada. */
  parameters: JsonSchema;
}

/** Chamada de ferramenta pedida pelo modelo. */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** Executa uma chamada e devolve um resultado serializável (será JSON.stringify). */
export type ToolExecutor = (call: ToolCall) => Promise<unknown>;

export interface AgentOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Máximo de rodadas de ferramenta antes de forçar resposta. Default 6. */
  maxSteps?: number;
  /** System prompt. */
  system?: string;
}

export interface AgentResult {
  text: string;
  provider: ProviderKind;
  model: string;
  usedFallback: boolean;
  /** Rodadas de ferramenta executadas. */
  steps: number;
  /** Nomes das ferramentas efetivamente chamadas (em ordem). */
  toolsUsed: string[];
  latencyMs: number;
}

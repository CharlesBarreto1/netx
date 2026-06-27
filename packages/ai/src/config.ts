import type { AiEngineConfig, ProviderKind, ProviderSettings } from './types';

/** Defaults do motor aberto. Trocáveis por env sem mexer em código. */
export const AI_DEFAULTS = {
  provider: 'ollama' as ProviderKind,
  baseUrl: 'http://127.0.0.1:11434',
  // 3B é o default: ~2x mais rápido que o 7B em CPU e cabe folgado em VPS de
  // 8GB. Use 7B quando houver GPU ou a qualidade importar mais que a latência.
  model: 'qwen2.5:3b-instruct',
  fallbackProvider: 'anthropic' as ProviderKind,
  fallbackModel: 'claude-haiku-4-5',
  // Inferência local em CPU é lenta (minutos). Timeout generoso p/ tarefas
  // async; interativo deve usar o fallback de nuvem.
  timeoutMs: 180_000,
  maxTokens: 1024,
} as const;

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v == null || v === '') return dflt;
  return v === 'true' || v === '1';
}

function asProviderKind(v: string | undefined, dflt: ProviderKind): ProviderKind {
  return v === 'ollama' || v === 'openai-compat' || v === 'anthropic' ? v : dflt;
}

/**
 * Monta a config do engine a partir do ambiente. Reaproveita ANTHROPIC_API_KEY
 * (já usada no resto do NetX) como credencial do fallback Anthropic.
 *
 * Vars (todas opcionais — defaults = Ollama local sem fallback):
 *   AI_PROVIDER, AI_BASE_URL, AI_MODEL, AI_API_KEY
 *   AI_FALLBACK_ENABLED, AI_FALLBACK_PROVIDER, AI_FALLBACK_MODEL, AI_FALLBACK_BASE_URL
 *   AI_TIMEOUT_MS, AI_MAX_TOKENS, AI_REDACT_PII
 *   ANTHROPIC_API_KEY (credencial do fallback Anthropic)
 */
export function aiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AiEngineConfig {
  const primary: ProviderSettings = {
    kind: asProviderKind(env.AI_PROVIDER, AI_DEFAULTS.provider),
    baseUrl: env.AI_BASE_URL || AI_DEFAULTS.baseUrl,
    apiKey: env.AI_API_KEY || undefined,
    model: env.AI_MODEL || AI_DEFAULTS.model,
  };

  const fallbackEnabled = bool(env.AI_FALLBACK_ENABLED, false);
  const fallbackKind = asProviderKind(env.AI_FALLBACK_PROVIDER, AI_DEFAULTS.fallbackProvider);
  const fallback: ProviderSettings | undefined = fallbackEnabled
    ? {
        kind: fallbackKind,
        baseUrl: env.AI_FALLBACK_BASE_URL || undefined,
        apiKey:
          (fallbackKind === 'anthropic' ? env.ANTHROPIC_API_KEY : env.AI_API_KEY) || undefined,
        model:
          env.AI_FALLBACK_MODEL ||
          (fallbackKind === 'anthropic' ? AI_DEFAULTS.fallbackModel : AI_DEFAULTS.model),
      }
    : undefined;

  return {
    primary,
    fallback,
    fallbackEnabled,
    defaultMaxTokens: Number(env.AI_MAX_TOKENS) || AI_DEFAULTS.maxTokens,
    defaultTimeoutMs: Number(env.AI_TIMEOUT_MS) || AI_DEFAULTS.timeoutMs,
    redactPii: bool(env.AI_REDACT_PII, true),
  };
}

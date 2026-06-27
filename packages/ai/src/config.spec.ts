import { AI_DEFAULTS, aiConfigFromEnv } from './config';

describe('aiConfigFromEnv', () => {
  it('defaults = Ollama local, sem fallback', () => {
    const cfg = aiConfigFromEnv({});
    expect(cfg.primary).toMatchObject({
      kind: 'ollama',
      baseUrl: AI_DEFAULTS.baseUrl,
      model: AI_DEFAULTS.model,
    });
    expect(cfg.fallbackEnabled).toBe(false);
    expect(cfg.fallback).toBeUndefined();
    expect(cfg.redactPii).toBe(true);
  });

  it('híbrido: liga fallback Anthropic reusando ANTHROPIC_API_KEY', () => {
    const cfg = aiConfigFromEnv({
      AI_FALLBACK_ENABLED: 'true',
      AI_FALLBACK_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'sk-xyz',
    });
    expect(cfg.fallbackEnabled).toBe(true);
    expect(cfg.fallback).toMatchObject({ kind: 'anthropic', apiKey: 'sk-xyz' });
  });

  it('respeita override de provider/modelo/timeout', () => {
    const cfg = aiConfigFromEnv({
      AI_PROVIDER: 'openai-compat',
      AI_BASE_URL: 'https://api.groq.com/openai/v1',
      AI_MODEL: 'llama-3.1-70b',
      AI_TIMEOUT_MS: '12000',
      AI_MAX_TOKENS: '2048',
      AI_REDACT_PII: 'false',
    });
    expect(cfg.primary.kind).toBe('openai-compat');
    expect(cfg.primary.model).toBe('llama-3.1-70b');
    expect(cfg.defaultTimeoutMs).toBe(12000);
    expect(cfg.defaultMaxTokens).toBe(2048);
    expect(cfg.redactPii).toBe(false);
  });
});

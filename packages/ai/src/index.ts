/**
 * @netx/ai — Motor de IA do NetX.
 *
 * Provider-agnostic: o default é um motor ABERTO/self-hosted (Ollama), com
 * fallback opcional pra nuvem (Anthropic). Regra de ouro do ecossistema: a IA é
 * CONSELHEIRA — propõe, resume e explica; nunca executa ação nem aplica config.
 *
 * Uso típico:
 *   import { createAiEngine, aiConfigFromEnv } from '@netx/ai';
 *   const ai = createAiEngine(aiConfigFromEnv());
 *   const r = await ai.chat([{ role: 'user', content: 'Resuma...' }], {}, 'feature.x');
 */
export * from './types';
export { AiEngine, createAiEngine } from './engine';
export { aiConfigFromEnv, AI_DEFAULTS } from './config';
export { redact, redactMessages } from './redact';
export type { AiProvider, ResolvedChatOptions } from './providers/provider';
export { OllamaProvider } from './providers/ollama.provider';
export { OpenAiCompatProvider } from './providers/openai-compat.provider';
export { AnthropicProvider } from './providers/anthropic.provider';

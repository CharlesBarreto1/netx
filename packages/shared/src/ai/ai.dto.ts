import { z } from 'zod';

// =============================================================================
// IA (@netx/ai) — config do motor por tenant + status/teste + copiloto.
// Motor aberto (Ollama) self-hosted por padrão; fallback de nuvem opcional.
// Segredos (apiKey/fallbackApiKey) são WRITE-ONLY: enviados, nunca retornados.
// =============================================================================

export const AiProviderKindSchema = z.enum(['OLLAMA', 'OPENAI_COMPAT', 'ANTHROPIC']);
export type AiProviderKind = z.infer<typeof AiProviderKindSchema>;

// -----------------------------------------------------------------------------
// CONFIG (por tenant) — escrita
// -----------------------------------------------------------------------------
export const UpsertAiConfigRequestSchema = z
  .object({
    enabled: z.boolean().optional(),

    // Provider primário (motor aberto por padrão).
    provider: AiProviderKindSchema.optional(),
    baseUrl: z.string().url().max(500).nullish(),
    model: z.string().min(1).max(120).optional(),
    apiKey: z.string().min(1).max(400).optional(), // write-only

    // Fallback de nuvem (híbrido).
    fallbackEnabled: z.boolean().optional(),
    fallbackProvider: AiProviderKindSchema.optional(),
    fallbackModel: z.string().min(1).max(120).optional(),
    fallbackBaseUrl: z.string().url().max(500).nullish(),
    fallbackApiKey: z.string().min(1).max(400).optional(), // write-only

    // Limites/comportamento
    maxTokens: z.coerce.number().int().min(64).max(8192).optional(),
    timeoutMs: z.coerce.number().int().min(1000).max(600000).optional(),
    redactPii: z.boolean().optional(),
  })
  .strict();
export type UpsertAiConfigRequest = z.infer<typeof UpsertAiConfigRequestSchema>;

// -----------------------------------------------------------------------------
// CONFIG — resposta (sem segredos)
// -----------------------------------------------------------------------------
export interface AiConfigResponse {
  tenantId: string;
  enabled: boolean;

  provider: AiProviderKind;
  baseUrl: string | null;
  model: string;
  hasApiKey: boolean;

  fallbackEnabled: boolean;
  fallbackProvider: AiProviderKind;
  fallbackModel: string;
  fallbackBaseUrl: string | null;
  hasFallbackApiKey: boolean;

  maxTokens: number;
  timeoutMs: number;
  redactPii: boolean;

  updatedAt: string | null;
}

// -----------------------------------------------------------------------------
// STATUS / TESTE
// -----------------------------------------------------------------------------
export interface AiBackendStatus {
  kind: string;
  model: string;
  available: boolean;
}

export interface AiStatusResponse {
  available: boolean;
  primary: AiBackendStatus;
  fallback: AiBackendStatus | null;
}

export interface AiTestResponse {
  ok: boolean;
  provider: string;
  model: string;
  usedFallback: boolean;
  latencyMs: number;
  sample: string; // primeiros chars da resposta (prova de vida)
  error?: string;
}

// -----------------------------------------------------------------------------
// COPILOTO (F3) — pergunta grounded read-only
// -----------------------------------------------------------------------------
export const AiAskRequestSchema = z
  .object({
    question: z.string().min(3).max(2000),
  })
  .strict();
export type AiAskRequest = z.infer<typeof AiAskRequestSchema>;

/** Teste de rede disparado pelo copiloto, cujo resultado chega por polling. */
export interface AiPendingTest {
  jobId: string;
  testType: string;
  target: string;
  source: string;
}

export interface AiAskResponse {
  question: string;
  answer: string;
  provider: string;
  usedFallback: boolean;
  /** Presente quando a IA disparou um teste ativo; o Nexus faz polling do jobId. */
  pendingTest?: AiPendingTest;
}

/** Status/resultado de um teste de rede (polling do Nexus). Compacto. */
export interface AiTestStatusResponse {
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'not_found';
  result?: {
    testType: string;
    target: string;
    source: string;
    reachable: boolean;
    summary: string;
    hops?: number;
    rttMs?: number;
    lossPct?: number;
    raw?: string;
  };
  error?: string;
}

// -----------------------------------------------------------------------------
// IA de atendimento (WhatsApp) — conselheira read-only. NUNCA envia mensagem;
// só sugere/resume/classifica. O envio continua sendo ação humana.
// -----------------------------------------------------------------------------

/** Resposta sugerida para o operador revisar e enviar (ou descartar). */
export interface WaAiSuggestResponse {
  suggestion: string;
  provider: string;
  usedFallback: boolean;
}

/** Insights da conversa: resumo + intenção + sentimento + urgência. */
export interface WaAiInsightsResponse {
  summary: string;
  intent: string;
  sentiment: 'positivo' | 'neutro' | 'insatisfeito';
  urgency: 'baixa' | 'media' | 'alta';
  provider: string;
  usedFallback: boolean;
}

import type {
  AiAskResponse,
  AiConfigResponse,
  AiInsightDto,
  AiStatusResponse,
  AiTestResponse,
  AiTestStatusResponse,
  UpsertAiConfigRequest,
} from '@netx/shared';

import { api } from './api';

export type { AiInsightDto };

/**
 * Client do motor de IA (@netx/ai) — config por tenant, status e teste.
 * Segredos (apiKey/fallbackApiKey) são write-only: enviados, nunca retornados.
 */
export const aiApi = {
  statusPath: () => `/v1/ai/status`,
  configPath: () => `/v1/ai/config`,

  getStatus() {
    return api.get<AiStatusResponse>(this.statusPath());
  },
  getConfig() {
    return api.get<AiConfigResponse>(this.configPath());
  },
  saveConfig(input: UpsertAiConfigRequest) {
    return api.put<AiConfigResponse>(this.configPath(), input);
  },
  test() {
    return api.post<AiTestResponse>('/v1/ai/config/test');
  },
  // Copiloto agêntico (Nexus) — prefixo /copilot (CopilotController), separado
  // do /ai do motor/config acima (AiController).
  ask(question: string) {
    return api.post<AiAskResponse>('/v1/copilot/ask', { question });
  },
  testStatus(jobId: string) {
    return api.get<AiTestStatusResponse>(`/v1/copilot/test/${jobId}`);
  },
  insightsPath: () => `/v1/copilot/insights`,
  getInsights() {
    return api.get<AiInsightDto[]>(this.insightsPath());
  },
  scanInsights() {
    return api.post<AiInsightDto[]>(`/v1/copilot/insights/scan`);
  },
  dismissInsight(id: string) {
    return api.post<{ ok: boolean }>(`/v1/copilot/insights/${id}/dismiss`);
  },
};

export type {
  AiAskResponse,
  AiConfigResponse,
  AiStatusResponse,
  AiTestResponse,
  UpsertAiConfigRequest,
};

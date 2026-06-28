import type {
  AiAskResponse,
  AiConfigResponse,
  AiStatusResponse,
  AiTestResponse,
  AiTestStatusResponse,
  UpsertAiConfigRequest,
} from '@netx/shared';

import { api } from './api';

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
  ask(question: string) {
    return api.post<AiAskResponse>('/v1/ai/ask', { question });
  },
  testStatus(jobId: string) {
    return api.get<AiTestStatusResponse>(`/v1/ai/test/${jobId}`);
  },
};

export type {
  AiAskResponse,
  AiConfigResponse,
  AiStatusResponse,
  AiTestResponse,
  UpsertAiConfigRequest,
};

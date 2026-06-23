/**
 * Cliente tipado pro catálogo de Planos de internet.
 * Rotas: /api/v1/plans/*.
 */
import { api } from './api';

export interface Plan {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  downloadMbps: number;
  uploadMbps: number;
  /** String pra preservar precisão decimal. */
  monthlyPrice: string;
  /**
   * Dias após o vencimento até suspender o contrato por inadimplência.
   * Contract.blockAfterDays sobrescreve por contrato.
   */
  blockAfterDays: number;
  isActive: boolean;
  order: number;
  /** Override de template de provisionamento de OLT (Fase 2 — Zyxel). */
  provisioningProfileId: string | null;
  provisioningProfileName?: string | null;
  contractCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlanInput {
  name: string;
  description?: string | null;
  downloadMbps: number;
  uploadMbps: number;
  monthlyPrice: number;
  /** Dias até bloqueio por inadimplência. Default 5. */
  blockAfterDays?: number;
  isActive?: boolean;
  order?: number;
  provisioningProfileId?: string | null;
}

export type UpdatePlanInput = Partial<CreatePlanInput>;

export const plansApi = {
  listPath: (includeInactive = false) =>
    `/v1/plans${includeInactive ? '?includeInactive=true' : ''}`,
  list(includeInactive = false) {
    return api.get<Plan[]>(this.listPath(includeInactive));
  },
  get(id: string) {
    return api.get<Plan>(`/v1/plans/${id}`);
  },
  create(input: CreatePlanInput) {
    return api.post<Plan>('/v1/plans', input);
  },
  update(id: string, input: UpdatePlanInput) {
    return api.patch<Plan>(`/v1/plans/${id}`, input);
  },
  remove(id: string) {
    return api.delete<void>(`/v1/plans/${id}`);
  },
};

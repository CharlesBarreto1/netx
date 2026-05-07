/**
 * Cliente pra endpoints de RADIUS accounting (status técnico + uso).
 */
import { api } from './api';

export interface ContractSession {
  online: boolean;
  framedIp: string | null;
  sessionStart: string | null;
  sessionStop: string | null;
  uptimeSeconds: number;
  inputBytes: number;
  outputBytes: number;
  terminateCause: string | null;
  nasIp: string | null;
}

export interface DailyUsage {
  date: string;
  inputBytes: number;
  outputBytes: number;
}

export interface UsageResponse {
  days: number;
  data: DailyUsage[];
  totals: { input: number; output: number };
}

export const radacctApi = {
  sessionPath: (contractId: string) => `/v1/contracts/${contractId}/session`,
  session(contractId: string) {
    return api.get<ContractSession>(`/v1/contracts/${contractId}/session`);
  },
  usagePath: (contractId: string, days = 30) =>
    `/v1/contracts/${contractId}/usage?days=${days}`,
  usage(contractId: string, days = 30) {
    return api.get<UsageResponse>(`/v1/contracts/${contractId}/usage?days=${days}`);
  },
};

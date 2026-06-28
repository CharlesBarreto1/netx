/**
 * NmsClient — client HTTP read-only do core-service para a API do NMS.
 *
 * O NMS é um serviço separado (TimescaleDB próprio); métricas só via API. Auth:
 * encaminhamos o Bearer do operador (ponte SSO — o NMS precisa de CORE_JWT_SECRET
 * configurado pra aceitar tokens do Core). Tudo best-effort: erro vira mensagem,
 * nunca derruba o copiloto.
 */
import { Injectable, Logger } from '@nestjs/common';

import { loadConfig } from '@netx/config';

export interface NmsDevice {
  id: string;
  hostname: string;
  vendor: string | null;
  model: string | null;
  status: string | null;
}

export interface NmsInterfaceRate {
  ifName: string;
  inBps: number | null;
  outBps: number | null;
  inErrors: number | null;
  outErrors: number | null;
  operStatus: number | null;
}

export interface NmsOpticalReading {
  ifName: string;
  rxDbm: number | null;
  txDbm: number | null;
  moduleTempC: number | null;
}

@Injectable()
export class NmsClient {
  private readonly logger = new Logger(NmsClient.name);
  private readonly baseUrl: string;

  constructor() {
    const { nmsService } = loadConfig();
    this.baseUrl = `http://${nmsService.host}:${nmsService.port}`;
  }

  private async req<T>(
    method: 'GET' | 'POST',
    path: string,
    authToken: string | null,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (authToken) headers.authorization = `Bearer ${authToken}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const resp = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      const text = (await resp.text()).slice(0, 160);
      throw new Error(
        resp.status === 401
          ? 'NMS recusou o token (ponte SSO CORE_JWT_SECRET não configurada no NMS)'
          : `NMS ${resp.status}: ${text}`,
      );
    }
    return (await resp.json()) as T;
  }

  private get<T>(path: string, authToken: string | null): Promise<T> {
    return this.req<T>('GET', path, authToken);
  }

  listDevices(authToken: string | null): Promise<NmsDevice[]> {
    return this.get<NmsDevice[]>('/devices', authToken);
  }

  interfaceRates(deviceId: string, authToken: string | null): Promise<NmsInterfaceRate[]> {
    return this.get<NmsInterfaceRate[]>(`/devices/${deviceId}/metrics/interfaces`, authToken);
  }

  optical(deviceId: string, authToken: string | null): Promise<NmsOpticalReading[]> {
    return this.get<NmsOpticalReading[]>(`/devices/${deviceId}/metrics/optical`, authToken);
  }

  /** Enfileira um teste de rede ativo (async). Devolve o jobId p/ polling. */
  enqueueNetworkTest(
    input: { testType: string; target: string; source: string; device?: string },
    authToken: string | null,
  ): Promise<{ jobId: string }> {
    return this.req<{ jobId: string }>('POST', '/diagnostics/network-test', authToken, input);
  }

  /** Status/resultado do teste (polling). Devolve o JobStatus do NMS. */
  networkTestStatus(jobId: string, authToken: string | null): Promise<NmsJobStatus> {
    return this.get<NmsJobStatus>(`/diagnostics/network-test/${jobId}`, authToken);
  }
}

/** Espelha o JobStatus do NMS (device-jobs.service). */
export interface NmsJobStatus {
  state: 'waiting' | 'active' | 'delayed' | 'completed' | 'failed' | 'not_found';
  result?: {
    ok: boolean;
    error?: string;
    data?: {
      kind: string;
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
  };
  error?: string;
}

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

  private async get<T>(path: string, authToken: string | null): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (authToken) headers.authorization = `Bearer ${authToken}`;
    const resp = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      const body = (await resp.text()).slice(0, 160);
      throw new Error(
        resp.status === 401
          ? 'NMS recusou o token (ponte SSO CORE_JWT_SECRET não configurada no NMS)'
          : `NMS ${resp.status}: ${body}`,
      );
    }
    return (await resp.json()) as T;
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
}

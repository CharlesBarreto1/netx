/**
 * NmsClientService — leitura da telemetria da frota no NMS a partir do Core.
 *
 * Espelha o caminho de escrita do `NmsSyncService` (mesma base HTTP, mesmo
 * token de serviço HS256), mas só lê: o painel precisa do `/summary` — tráfego
 * agregado, devices online e saúde por device — que mora no TimescaleDB do NMS
 * e não tem como ser consultado por SQL daqui, porque os bancos são separados.
 *
 * NUNCA LANÇA: o painel do NOC é tela de plantão. Se o NMS está fora, ou o
 * módulo não está licenciado, os blocos que dependem dele degradam pra
 * "indisponível" — mas os que vêm do Core (PPPoE, óptica, OLTs) continuam
 * renderizando. Um throw aqui derrubaria a tela inteira por causa do bloco que
 * menos importa quando o NMS caiu.
 */
import { Injectable, Logger } from '@nestjs/common';
import { loadConfig } from '@netx/config';
import jwt from 'jsonwebtoken';

/** Device da frota, como o NMS devolve em `/summary`. */
export interface NmsFleetDevice {
  id: string;
  hostname: string;
  mgmtIp: string;
  vendor: string;
  model: string | null;
  site: string | null;
  inBps: number;
  outBps: number;
  cpuPct: number | null;
  tempC: number | null;
  ifCount: number;
  online: boolean;
  lastSeen: string | null;
}

export interface NmsTrafficPoint {
  t: string;
  inBps: number;
  outBps: number;
}

export interface NmsFleetSummary {
  deviceCount: number;
  online: number;
  offline: number;
  totalInBps: number;
  totalOutBps: number;
  series: NmsTrafficPoint[];
  devices: NmsFleetDevice[];
}

@Injectable()
export class NmsClientService {
  private readonly logger = new Logger(NmsClientService.name);
  private readonly baseUrl: string;

  constructor() {
    const { nmsService } = loadConfig();
    this.baseUrl = `http://${nmsService.host}:${nmsService.port}`;
  }

  /**
   * Token de SERVIÇO — idêntico em forma ao do NmsSyncService, mas pedindo só
   * leitura (`nms.read`). O NMS mapeia `perms` pro RBAC dele.
   */
  private serviceToken(): string {
    const cfg = loadConfig();
    return jwt.sign({ sub: 'netx-core-dashboard', perms: ['nms.read'], roles: [] }, cfg.jwt.accessSecret, {
      issuer: 'netx',
      audience: 'netx-api',
      algorithm: 'HS256',
      expiresIn: '2m',
    });
  }

  /**
   * Telemetria agregada da frota, ou `null` se o NMS não respondeu.
   *
   * O null é significativo e propaga até o painel: "não sei" não é "zero". Um
   * tráfego lido como 0 por indisponibilidade do NMS dispararia o alarme de
   * queda brusca — alarme falso na madrugada, que é exatamente o que destrói a
   * confiança no painel.
   */
  async fleetSummary(): Promise<NmsFleetSummary | null> {
    try {
      const resp = await fetch(`${this.baseUrl}/summary`, {
        headers: { accept: 'application/json', authorization: `Bearer ${this.serviceToken()}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) {
        this.logger.debug(`NMS /summary respondeu ${resp.status}`);
        return null;
      }
      return (await resp.json()) as NmsFleetSummary;
    } catch (err) {
      this.logger.debug(`NMS /summary indisponível: ${String(err)}`);
      return null;
    }
  }
}

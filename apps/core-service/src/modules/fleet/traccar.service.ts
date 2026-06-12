import { Injectable, Logger } from '@nestjs/common';

/**
 * Cliente HTTP do Traccar (rastreamento GPS self-hosted).
 *
 * Config por env (nível de plataforma — instância única do deploy; o NetX é a
 * autoridade de multi-tenancy via Vehicle.trackerUniqueId):
 *   TRACCAR_URL       ex. http://localhost:8082
 *   TRACCAR_USER      e-mail do usuário Traccar (auth Basic)
 *   TRACCAR_PASSWORD  senha
 *   TRACCAR_TOKEN     alternativa ao user/senha (Bearer) — se presente, prevalece
 *
 * Não persistimos credenciais; lemos do ambiente. Usa o fetch global do Node.
 */

const KNOTS_TO_KMH = 1.852;
const REQUEST_TIMEOUT_MS = 5000;

export interface NormalizedPosition {
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  course: number | null;
  altitude: number | null;
  address: string | null;
  deviceTime: Date;
  serverTime: Date;
  attributes: Record<string, unknown> | null;
}

interface TraccarDevice {
  id: number;
  uniqueId: string;
  name: string;
  status: string;
  lastUpdate: string | null;
  positionId: number; // 0 = nunca reportou posição
}

interface TraccarPosition {
  id: number;
  deviceId: number;
  latitude: number;
  longitude: number;
  altitude: number | null;
  speed: number | null; // KNOTS no Traccar
  course: number | null;
  address: string | null;
  deviceTime: string;
  serverTime: string;
  attributes: Record<string, unknown> | null;
}

@Injectable()
export class TraccarService {
  private readonly logger = new Logger(TraccarService.name);

  private readonly baseUrl = (process.env.TRACCAR_URL ?? '').replace(/\/+$/, '');
  private readonly user = process.env.TRACCAR_USER ?? '';
  private readonly password = process.env.TRACCAR_PASSWORD ?? '';
  private readonly token = process.env.TRACCAR_TOKEN ?? '';

  isConfigured(): boolean {
    return Boolean(this.baseUrl) && Boolean(this.token || (this.user && this.password));
  }

  private authHeader(): string {
    if (this.token) return `Bearer ${this.token}`;
    const basic = Buffer.from(`${this.user}:${this.password}`).toString('base64');
    return `Basic ${basic}`;
  }

  private async request<T>(
    path: string,
    opts: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const method = opts.method ?? 'GET';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: this.authHeader(),
          Accept: 'application/json',
          ...(opts.body !== undefined
            ? { 'Content-Type': 'application/json' }
            : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Traccar ${method} ${path} respondeu ${res.status}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  /**
   * `all=true` é obrigatório: autenticamos com o service-account token (usuário
   * VIRTUAL do Traccar) — devices não ficam vinculados a ele, e `/api/devices`
   * sem o parâmetro lista só os vinculados (= sempre vazio pro token).
   */
  async getDevices(): Promise<TraccarDevice[]> {
    return this.get<TraccarDevice[]>('/api/devices?all=true');
  }

  /**
   * Garante que o device (IMEI) existe no Traccar com o nome dado (placa).
   * Idempotente: cria se falta, renomeia se a placa mudou. Chamado pelo
   * VehiclesService ao salvar veículo com trackerUniqueId — quem chama decide
   * o fallback (Traccar fora do ar não pode derrubar a mutação do veículo).
   */
  async ensureDevice(uniqueId: string, name: string): Promise<void> {
    const devices = await this.getDevices();
    const existing = devices.find((d) => d.uniqueId === uniqueId);
    if (!existing) {
      await this.request('/api/devices', {
        method: 'POST',
        body: { name, uniqueId },
      });
      this.logger.log(`Device ${uniqueId} (${name}) criado no Traccar`);
      return;
    }
    if (existing.name !== name) {
      // PUT exige o objeto completo — manda o device como veio, só com o nome novo.
      await this.request(`/api/devices/${existing.id}`, {
        method: 'PUT',
        body: { ...existing, name },
      });
      this.logger.log(`Device ${uniqueId} renomeado no Traccar para ${name}`);
    }
  }

  /**
   * Resolve a última posição por uniqueId (IMEI): /api/devices (all=true) dá
   * o `positionId` da última posição de cada device, e /api/positions?id=...
   * busca esse lote. NÃO usar /api/positions sem parâmetro — ele lista por
   * vínculo de usuário e volta vazio pro service-account token (vide
   * getDevices). Lança se o Traccar estiver inacessível — quem chama decide
   * o fallback.
   */
  async getPositionsByUniqueIds(
    uniqueIds: string[],
  ): Promise<Map<string, NormalizedPosition>> {
    const wanted = new Set(uniqueIds);
    const out = new Map<string, NormalizedPosition>();
    if (wanted.size === 0) return out;

    const devices = await this.getDevices();

    // deviceId → uniqueId, só dos que nos interessam e já reportaram.
    const deviceIdToUnique = new Map<number, string>();
    const positionIds: number[] = [];
    for (const d of devices) {
      if (!wanted.has(d.uniqueId) || !d.positionId) continue;
      deviceIdToUnique.set(d.id, d.uniqueId);
      positionIds.push(d.positionId);
    }
    if (positionIds.length === 0) return out;

    const query = positionIds.map((id) => `id=${id}`).join('&');
    const positions = await this.get<TraccarPosition[]>(`/api/positions?${query}`);

    for (const p of positions) {
      const uniqueId = deviceIdToUnique.get(p.deviceId);
      if (!uniqueId) continue;
      const deviceTime = new Date(p.deviceTime);
      const prev = out.get(uniqueId);
      // Mantém a posição mais recente por device.
      if (prev && prev.deviceTime >= deviceTime) continue;
      out.set(uniqueId, {
        latitude: p.latitude,
        longitude: p.longitude,
        speedKmh: p.speed != null ? Math.round(p.speed * KNOTS_TO_KMH * 10) / 10 : null,
        course: p.course,
        altitude: p.altitude,
        address: p.address,
        deviceTime,
        serverTime: new Date(p.serverTime),
        attributes: p.attributes ?? null,
      });
    }

    return out;
  }
}

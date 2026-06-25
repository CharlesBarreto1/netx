/**
 * Cliente HTTP de baixo nível da API oficial do Hubsoft (read-only).
 *
 * Auth = OAuth2 *password grant* em POST {host}/oauth/token com
 * { grant_type:'password', client_id, client_secret, username, password }.
 * O token (Bearer) é cacheado em memória por (host|clientId|username) e
 * renovado 60s antes de expirar. Sem mTLS → usamos o `fetch` global.
 *
 * Não decide política de erro: lança HubsoftApiError (status + corpo) e quem
 * chama (config/import) trata. TODAS as rotas usadas aqui são GET — esta
 * integração NUNCA escreve no Hubsoft.
 */
import { Injectable, Logger } from '@nestjs/common';

import type {
  HubsoftCliente,
  HubsoftFatura,
  HubsoftResolvedConfig,
  HubsoftTokenResponse,
} from './hubsoft.types';

const TOKEN_TIMEOUT_MS = 15_000;
const API_TIMEOUT_MS = 30_000;
const BULK_TIMEOUT_MS = 120_000; // /cliente/all pode ser pesado
const TOKEN_SKEW_MS = 60_000;

export class HubsoftApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'HubsoftApiError';
  }
}

@Injectable()
export class HubsoftClientService {
  private readonly logger = new Logger(HubsoftClientService.name);
  private readonly tokenCache = new Map<string, { token: string; expiresAt: number }>();

  // ---------------------------------------------------------------------------
  // fetch com timeout
  // ---------------------------------------------------------------------------
  private async fetchJson(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
    timeoutMs: number,
  ): Promise<{ status: number; json: unknown; text: string }> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }
      return { status: res.status, json, text };
    } finally {
      clearTimeout(t);
    }
  }

  // ---------------------------------------------------------------------------
  // OAuth
  // ---------------------------------------------------------------------------
  private cacheKey(cfg: HubsoftResolvedConfig): string {
    return `${cfg.host}|${cfg.credentials.clientId}|${cfg.credentials.username}`;
  }

  private async getToken(cfg: HubsoftResolvedConfig): Promise<string> {
    const key = this.cacheKey(cfg);
    const cached = this.tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const body = JSON.stringify({
      grant_type: 'password',
      client_id: cfg.credentials.clientId,
      client_secret: cfg.credentials.clientSecret,
      username: cfg.credentials.username,
      password: cfg.credentials.password,
    });
    const res = await this.fetchJson(
      `${cfg.host}/oauth/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body,
      },
      TOKEN_TIMEOUT_MS,
    );

    const json = (res.json ?? {}) as HubsoftTokenResponse;
    if (res.status < 200 || res.status >= 300 || !json.access_token) {
      const detail = json.error_description ?? json.message ?? json.error ?? 'sem access_token';
      this.logger.warn(`Hubsoft OAuth → ${res.status}: ${detail}`);
      throw new HubsoftApiError(`Hubsoft OAuth falhou (${res.status})`, res.status, res.json);
    }
    const expiresInMs = (json.expires_in ?? 3600) * 1000;
    this.tokenCache.set(key, {
      token: json.access_token,
      expiresAt: Date.now() + expiresInMs - TOKEN_SKEW_MS,
    });
    return json.access_token;
  }

  /**
   * "Testar conexão" — tenta o password grant sem lançar nem cachear.
   * Usado pelo diagnóstico da config.
   */
  async probeAuth(cfg: HubsoftResolvedConfig): Promise<{ ok: boolean; status: number; body: unknown }> {
    const body = JSON.stringify({
      grant_type: 'password',
      client_id: cfg.credentials.clientId,
      client_secret: cfg.credentials.clientSecret,
      username: cfg.credentials.username,
      password: cfg.credentials.password,
    });
    try {
      const res = await this.fetchJson(
        `${cfg.host}/oauth/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body,
        },
        TOKEN_TIMEOUT_MS,
      );
      const json = (res.json ?? {}) as HubsoftTokenResponse;
      const ok = res.status >= 200 && res.status < 300 && !!json.access_token;
      return { ok, status: res.status, body: res.json };
    } catch (e) {
      return { ok: false, status: 0, body: { message: e instanceof Error ? e.message : String(e) } };
    }
  }

  clearTokenCache(): void {
    this.tokenCache.clear();
  }

  // ---------------------------------------------------------------------------
  // GET genérico autenticado
  // ---------------------------------------------------------------------------
  private async get<T = unknown>(
    cfg: HubsoftResolvedConfig,
    path: string,
    timeoutMs = API_TIMEOUT_MS,
  ): Promise<T> {
    const token = await this.getToken(cfg);
    const res = await this.fetchJson(
      `${cfg.host}${path}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      },
      timeoutMs,
    );
    if (res.status < 200 || res.status >= 300) {
      throw new HubsoftApiError(`Hubsoft GET ${path} → ${res.status}`, res.status, res.json);
    }
    return res.json as T;
  }

  private qs(params: Record<string, string | number | undefined>): string {
    const parts = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    return parts.length ? `?${parts.join('&')}` : '';
  }

  /** Extrai o array de dados do envelope do Hubsoft (chaves variam por rota). */
  private pickArray(json: unknown, keys: string[]): unknown[] {
    if (Array.isArray(json)) return json;
    if (json && typeof json === 'object') {
      const obj = json as Record<string, unknown>;
      for (const k of keys) {
        if (Array.isArray(obj[k])) return obj[k] as unknown[];
      }
      // Algumas rotas embrulham em { msg, status, <chave>: [...] }.
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) return v as unknown[];
      }
    }
    return [];
  }

  // ---------------------------------------------------------------------------
  // Rotas de leitura
  // ---------------------------------------------------------------------------
  /** GET /api/v1/integracao/cliente — consulta paginável de clientes (+ servicos[]). */
  async getClientes(
    cfg: HubsoftResolvedConfig,
    params: { busca?: string; termo_busca?: string; limit?: number; cancelado?: 'sim' | 'nao' } = {},
  ): Promise<HubsoftCliente[]> {
    const json = await this.get(cfg, `/api/v1/integracao/cliente${this.qs(params)}`);
    return this.pickArray(json, ['clientes']) as HubsoftCliente[];
  }

  /**
   * GET /api/v1/integracao/cliente/all — TODOS os clientes (cacheado no Hubsoft).
   * O próprio Hubsoft recomenda usar poucas vezes ao dia.
   */
  async getClientesAll(
    cfg: HubsoftResolvedConfig,
    params: {
      cancelado?: 'sim' | 'nao';
      codigo_pacote?: string | number;
      limit?: number;
      offset?: number;
      // CSV de objetos aninhados a embutir (default da API = "Nenhum"). Sem isto
      // os endereços NÃO vêm — e o filtro/coluna de cidade fica vazio.
      incluir?: string;
    } = {},
  ): Promise<HubsoftCliente[]> {
    // /cliente/all pode trazer MUITO dado — timeout generoso (2 min).
    const json = await this.get(
      cfg,
      `/api/v1/integracao/cliente/all${this.qs(params)}`,
      BULK_TIMEOUT_MS,
    );
    return this.pickArray(json, ['clientes']) as HubsoftCliente[];
  }

  /**
   * GET /api/v1/integracao/cliente/financeiro — faturas de um cliente.
   * `apenas_pendente=nao` traz TAMBÉM as já pagas/liquidadas (histórico).
   */
  async getFinanceiroCliente(
    cfg: HubsoftResolvedConfig,
    codigoCliente: number | string,
    params: { limit?: number; apenasPendente?: boolean } = {},
  ): Promise<HubsoftFatura[]> {
    const { apenasPendente, ...rest } = params;
    const json = await this.get(
      cfg,
      `/api/v1/integracao/cliente/financeiro${this.qs({
        busca: 'codigo_cliente',
        termo_busca: codigoCliente,
        apenas_pendente: apenasPendente ? 'sim' : 'nao',
        ...rest,
      })}`,
    );
    return this.pickArray(json, ['financeiro', 'faturas']) as HubsoftFatura[];
  }
}

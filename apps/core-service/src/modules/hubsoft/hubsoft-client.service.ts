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
  HubsoftCpe,
  HubsoftFatura,
  HubsoftProdutoItem,
  HubsoftProdutoVinculo,
  HubsoftResolvedConfig,
  HubsoftTokenResponse,
} from './hubsoft.types';

const TOKEN_TIMEOUT_MS = 15_000;
const API_TIMEOUT_MS = 30_000;
const BULK_TIMEOUT_MS = 120_000; // /cliente/todos com relações pode ser pesado
const TOKEN_SKEW_MS = 60_000;

// Relações embutidas por padrão no /cliente/todos (param `relacoes`). Traz o
// endereço de instalação (+ coordenadas/ibge_cidade) e o equipamento de conexão
// (o BNG) dentro de cada serviço — é o que o import completo usa.
const HS_DEFAULT_RELACOES =
  'endereco_instalacao,endereco_cadastral,equipamento_conexao,equipamento_roteamento';

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
  /**
   * GET /api/v1/integracao/cliente — consulta paginável de clientes (+ servicos[]).
   * Aceita `relacoes` para embutir endereço de instalação + coordenadas e
   * equipamento por serviço (mesmo param do /cliente/todos). Default: as relações
   * do import completo — assim a busca por código já traz tudo.
   */
  async getClientes(
    cfg: HubsoftResolvedConfig,
    params: {
      busca?: string;
      termo_busca?: string | number;
      limit?: number;
      cancelado?: 'sim' | 'nao';
      relacoes?: string;
    } = {},
  ): Promise<HubsoftCliente[]> {
    const q = { relacoes: HS_DEFAULT_RELACOES, ...params };
    const json = await this.get(cfg, `/api/v1/integracao/cliente${this.qs(q)}`);
    return this.pickArray(json, ['clientes']) as HubsoftCliente[];
  }

  /**
   * GET /api/v1/integracao/cliente/todos — TODOS os clientes (paginado).
   *
   * ⚠️ A rota antiga `/cliente/all` foi DESATIVADA pelo Hubsoft em 01/01/2023
   * (responde 403 com instrução de migrar). A substituta é `/cliente/todos`, com
   * um contrato de PAGINAÇÃO DIFERENTE:
   *   - parâmetros obrigatórios `pagina` (1-based) + `itens_por_pagina`
   *     (NÃO `limit`/`offset` como a antiga);
   *   - resposta traz `{ status, msg, paginacao:{ total_registros, ultima_pagina,
   *     pagina_atual, ... }, clientes:[...] }`.
   * Mantemos a assinatura em `limit`/`offset` (o resto do código raciocina assim)
   * e traduzimos para `pagina`/`itens_por_pagina` aqui dentro. `offset` precisa
   * ser múltiplo de `limit` para casar numa página exata — os callers já varrem
   * em passos de `limit`, então isso vale.
   *
   * O `servicos[]` já vem aninhado e rico (login/senha PPPoE, velocidade_*,
   * ipv4/ipv6, mac_addr, vlan, status_prefixo). O ENDEREÇO + COORDENADAS de
   * instalação vêm dentro de cada serviço (`servicos[].endereco_instalacao`,
   * com `coordenadas:{latitude,longitude}` e `ibge_cidade`) quando pedimos o
   * parâmetro `relacoes` — que é o nome correto (NÃO `incluir`). Passamos por
   * padrão as relações que o import usa (endereço + equipamento de conexão).
   */
  async getClientesAll(
    cfg: HubsoftResolvedConfig,
    params: {
      cancelado?: 'sim' | 'nao';
      codigo_pacote?: string | number;
      limit?: number;
      offset?: number;
      // Aceito por compat com callers antigos; hoje o que traz endereço é `relacoes`.
      incluir?: string;
      // CSV de relações a embutir na resposta (endereço, equipamento, etc.).
      // Default: endereço de instalação + equipamento de conexão (o BNG).
      relacoes?: string;
    } = {},
  ): Promise<HubsoftCliente[]> {
    const itensPorPagina = params.limit && params.limit > 0 ? params.limit : 200;
    const offset = params.offset ?? 0;
    // offset → pagina (1-based). Floor: se o caller passar um offset que não é
    // múltiplo exato de limit, cai na página que contém aquele offset.
    const pagina = Math.floor(offset / itensPorPagina) + 1;

    const query: Record<string, string | number | undefined> = {
      pagina,
      itens_por_pagina: itensPorPagina,
      cancelado: params.cancelado,
      codigo_pacote: params.codigo_pacote,
      relacoes: params.relacoes ?? HS_DEFAULT_RELACOES,
    };

    // /cliente/todos pode trazer MUITO dado — timeout generoso (2 min).
    const json = await this.get(
      cfg,
      `/api/v1/integracao/cliente/todos${this.qs(query)}`,
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

  /**
   * GET /api/v1/integracao/estoque/produto_vinculo/cliente_servico/:id — produtos
   * vinculados ao serviço. O equipamento em COMODATO é o vínculo cujo
   * `patrimonios[].produto_item_status.prefixo === 'comodato'` (traz numero_serie
   * e mac_address). Consumíveis (conector, cabo) vêm juntos mas sem patrimônio de
   * comodato — o chamador filtra.
   */
  async getComodatoServico(
    cfg: HubsoftResolvedConfig,
    idClienteServico: number | string,
  ): Promise<HubsoftProdutoVinculo[]> {
    const json = await this.get(
      cfg,
      `/api/v1/integracao/estoque/produto_vinculo/cliente_servico/${encodeURIComponent(
        String(idClienteServico),
      )}?pagina=0&itens_por_pagina=100`,
    );
    return this.pickArray(json, ['produto_vinculo', 'vinculos', 'produtos']) as HubsoftProdutoVinculo[];
  }

  /**
   * GET /api/v1/integracao/rede/cpe/todos — CPEs (ONTs) gerenciadas pelo ACS do
   * Hubsoft, paginado. FONTE IMPORTANTE: cada CPE traz `phy_addr` (serial) e
   * `servicos[]` com {id_cliente, cliente, login, id_cliente_servico, status}.
   * Cobre clientes que o /cliente/todos OMITE (bug confirmado — /todos retorna
   * menos clientes do que total_registros). `itens_por_pagina` mínimo 20.
   */
  async getCpesTodos(
    cfg: HubsoftResolvedConfig,
    params: { pagina: number; itensPorPagina?: number } = { pagina: 1 },
  ): Promise<HubsoftCpe[]> {
    const itens = Math.max(20, params.itensPorPagina ?? 500);
    const json = await this.get(
      cfg,
      `/api/v1/integracao/rede/cpe/todos${this.qs({ pagina: params.pagina, itens_por_pagina: itens })}`,
      BULK_TIMEOUT_MS,
    );
    return this.pickArray(json, ['cpes']) as HubsoftCpe[];
  }

  /**
   * GET /api/v1/integracao/estoque/produto_item/consultar?busca=numero_serie —
   * consulta de PATRIMÔNIO pelo SERIAL. Resolve os casos em que o Hubsoft guardou
   * o MAC no phy_addr do serviço (não a serial GPON): o estoque indexa pela serial
   * física e diz em qual `cliente_servico` o item está alocado. 1 chamada por
   * serial — usar como fallback para ONTs que nenhuma outra fonte resolveu.
   */
  async getPatrimonioBySerial(
    cfg: HubsoftResolvedConfig,
    serial: string,
  ): Promise<HubsoftProdutoItem[]> {
    const json = await this.get(
      cfg,
      `/api/v1/integracao/estoque/produto_item/consultar${this.qs({
        busca: 'numero_serie',
        termo_busca: serial,
      })}`,
    );
    return this.pickArray(json, ['produto_item', 'itens', 'patrimonios']) as HubsoftProdutoItem[];
  }
}

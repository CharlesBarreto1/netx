/**
 * Cliente HTTP de baixo nível do BTG Pactual Empresas.
 *
 * Auth via BTG Id (/oauth2/token, /oauth2/authorize). Sem mTLS — usamos o
 * `fetch` global (diferente do EfiClientService, que precisa de cert .p12).
 *
 *  - buildAuthorizeUrl()        → URL de consentimento (Authorization Code).
 *  - exchangeAuthorizationCode()→ troca o `code` por access + refresh token.
 *  - getAccessToken()           → token bancário (boleto/pix), renovado via
 *                                 refresh_token e cacheado em memória.
 *
 * BTG pode ROTACIONAR o refresh_token a cada refresh: quando isso acontece,
 * chamamos o callback `persistRefresh` p/ o config service salvar o novo.
 *
 * Não decide política de erro: lança BtgApiError (status + corpo).
 */
import { Injectable, Logger } from '@nestjs/common';

import {
  BTG_API_BASE,
  BTG_ID_BASE,
  btgCollectionsPath,
  btgPixInstantPath,
  btgRecurrencePath,
  btgWebhookPath,
  type BtgCollectionResponse,
  type BtgPixInstantResponse,
  type BtgRecurrenceApiResponse,
  type BtgResolvedConfig,
  type BtgTokenResponse,
  type BtgWebhookRegisterResponse,
} from './btg.types';

/** Callback p/ persistir um refresh_token rotacionado pelo BTG. */
export type PersistRefresh = (newRefreshToken: string) => Promise<void>;

const TOKEN_TIMEOUT_MS = 15_000;
const API_TIMEOUT_MS = 30_000;
const TOKEN_SKEW_MS = 60_000;

export class BtgApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'BtgApiError';
  }
}

@Injectable()
export class BtgClientService {
  private readonly logger = new Logger(BtgClientService.name);
  /** access_token bancário cacheado por (env|clientId). */
  private readonly tokenCache = new Map<string, { token: string; expiresAt: number }>();

  // ---------------------------------------------------------------------------
  // Helpers OAuth
  // ---------------------------------------------------------------------------
  private basicAuth(cfg: BtgResolvedConfig): string {
    const raw = `${cfg.credentials.clientId}:${cfg.credentials.clientSecret}`;
    return `Basic ${Buffer.from(raw).toString('base64')}`;
  }

  private cacheKey(cfg: BtgResolvedConfig): string {
    return `${cfg.environment}|${cfg.credentials.clientId}`;
  }

  /**
   * Probe de baixo nível do /oauth2/token contra um host BTG Id ARBITRÁRIO.
   * Não lança — devolve {status, ok, body} cru. Usado pelo diagnóstico p/
   * descobrir em qual ambiente (sandbox/produção) o client_id está registrado.
   */
  async tokenProbe(
    idBase: string,
    clientId: string,
    clientSecret: string,
    params: Record<string, string>,
  ): Promise<{ url: string; status: number; ok: boolean; body: unknown }> {
    const url = `${idBase}/oauth2/token`;
    const basic = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    const body = new URLSearchParams(params).toString();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TOKEN_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: basic,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body,
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }
      return { url, status: res.status, ok: res.ok, body: json };
    } catch (e) {
      return { url, status: 0, ok: false, body: { error: String(e) } };
    } finally {
      clearTimeout(timer);
    }
  }

  /** POST application/x-www-form-urlencoded no BTG Id, devolve o token JSON. */
  private async tokenRequest(
    cfg: BtgResolvedConfig,
    params: Record<string, string>,
  ): Promise<BtgTokenResponse> {
    const url = `${BTG_ID_BASE[cfg.environment]}/oauth2/token`;
    const body = new URLSearchParams(params).toString();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TOKEN_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: this.basicAuth(cfg),
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: BtgTokenResponse;
    try {
      json = text ? (JSON.parse(text) as BtgTokenResponse) : {};
    } catch {
      json = {};
    }
    if (!res.ok || !json.access_token) {
      this.logger.warn(
        `BTG Id token (${params.grant_type}) → ${res.status}: ${json.error_description ?? json.error ?? 'sem access_token'}`,
      );
      throw new BtgApiError(`BTG Id token falhou (${res.status})`, res.status, json);
    }
    return json;
  }

  // ---------------------------------------------------------------------------
  // Authorization Code (consentimento)
  // ---------------------------------------------------------------------------
  /** Monta a URL de consentimento do BTG Id. */
  buildAuthorizeUrl(cfg: BtgResolvedConfig, state: string): string {
    if (!cfg.redirectUri) {
      throw new BtgApiError('redirectUri não configurada para o consentimento BTG', 0, null);
    }
    const q = new URLSearchParams({
      client_id: cfg.credentials.clientId,
      response_type: 'code',
      redirect_uri: cfg.redirectUri,
      scope: cfg.scopes,
      state,
      prompt: 'login',
    });
    return `${BTG_ID_BASE[cfg.environment]}/oauth2/authorize?${q.toString()}`;
  }

  /** Troca o `code` recebido no callback por access + refresh token. */
  exchangeAuthorizationCode(cfg: BtgResolvedConfig, code: string): Promise<BtgTokenResponse> {
    if (!cfg.redirectUri) {
      throw new BtgApiError('redirectUri ausente — necessária na troca do code', 0, null);
    }
    return this.tokenRequest(cfg, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: cfg.redirectUri,
    });
  }

  // ---------------------------------------------------------------------------
  // Token bancário (refresh_token) — usado nas APIs de boleto/pix
  // ---------------------------------------------------------------------------
  /**
   * Devolve um access_token válido p/ operar a conta PJ. Renova via
   * refresh_token quando o cache expira. Se o BTG rotacionar o refresh_token,
   * `persistRefresh` é chamado p/ o config service salvar o novo valor.
   */
  async getAccessToken(
    cfg: BtgResolvedConfig,
    persistRefresh: (newRefreshToken: string) => Promise<void>,
  ): Promise<string> {
    const key = this.cacheKey(cfg);
    const cached = this.tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    if (!cfg.refreshToken) {
      throw new BtgApiError(
        'Consentimento BTG não concluído — refresh_token ausente. Autorize a conta PJ.',
        0,
        null,
      );
    }
    const json = await this.tokenRequest(cfg, {
      grant_type: 'refresh_token',
      refresh_token: cfg.refreshToken,
    });
    if (json.refresh_token && json.refresh_token !== cfg.refreshToken) {
      await persistRefresh(json.refresh_token);
    }
    const expiresInMs = (json.expires_in ?? 3600) * 1000;
    this.tokenCache.set(key, {
      token: json.access_token!,
      expiresAt: Date.now() + expiresInMs - TOKEN_SKEW_MS,
    });
    return json.access_token!;
  }

  /** Invalida o cache de token (credenciais/consentimento mudaram). */
  clearTokenCache(clientId?: string): void {
    if (!clientId) {
      this.tokenCache.clear();
      return;
    }
    for (const k of this.tokenCache.keys()) {
      if (k.endsWith(`|${clientId}`)) this.tokenCache.delete(k);
    }
  }

  // ---------------------------------------------------------------------------
  // Request genérico às APIs de produto (boleto/pix) — base p/ os próximos
  // serviços (BtgChargesService). Usa o token bancário com refresh transparente.
  // ---------------------------------------------------------------------------
  async apiRequest<T>(
    cfg: BtgResolvedConfig,
    persistRefresh: (newRefreshToken: string) => Promise<void>,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = await this.getAccessToken(cfg, persistRefresh);
    const url = `${BTG_API_BASE[cfg.environment]}${path}`;
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
        },
        body: payload,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    if (!res.ok) {
      throw new BtgApiError(`BTG ${method} ${path} → ${res.status}`, res.status, json);
    }
    return json as T;
  }

  /** GET binário (PDF do boleto) — Accept: application/pdf. */
  async apiRequestBinary(
    cfg: BtgResolvedConfig,
    persistRefresh: PersistRefresh,
    path: string,
    accept = 'application/pdf',
  ): Promise<Buffer> {
    const token = await this.getAccessToken(cfg, persistRefresh);
    const url = `${BTG_API_BASE[cfg.environment]}${path}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: accept },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new BtgApiError(`BTG GET ${path} → ${res.status}`, res.status, await res.text());
    }
    return Buffer.from(await res.arrayBuffer());
  }

  // ---------------------------------------------------------------------------
  // APIs de produto (boleto / Pix cobrança / Pix Automático / webhook)
  // ---------------------------------------------------------------------------
  private companyId(cfg: BtgResolvedConfig): string {
    if (!cfg.companyId) {
      throw new BtgApiError('companyId (CNPJ da conta BTG) não configurado', 0, null);
    }
    return cfg.companyId;
  }

  /** POST /{companyId}/banking/collections — emite boleto (BANKSLIP_QRCODE). */
  createCollection(
    cfg: BtgResolvedConfig,
    persist: PersistRefresh,
    payload: unknown,
  ): Promise<BtgCollectionResponse> {
    return this.apiRequest(cfg, persist, 'POST', btgCollectionsPath(this.companyId(cfg)), payload);
  }

  /** GET /{companyId}/banking/collections/{id} — consulta status. */
  getCollection(
    cfg: BtgResolvedConfig,
    persist: PersistRefresh,
    collectionId: string,
  ): Promise<BtgCollectionResponse> {
    return this.apiRequest(
      cfg,
      persist,
      'GET',
      btgCollectionsPath(this.companyId(cfg), collectionId),
    );
  }

  /** GET do PDF do boleto. */
  getCollectionPdf(
    cfg: BtgResolvedConfig,
    persist: PersistRefresh,
    collectionId: string,
  ): Promise<Buffer> {
    return this.apiRequestBinary(cfg, persist, btgCollectionsPath(this.companyId(cfg), collectionId));
  }

  /** DELETE /{companyId}/banking/collections/{id} — cancela boleto. */
  cancelCollection(
    cfg: BtgResolvedConfig,
    persist: PersistRefresh,
    collectionId: string,
  ): Promise<unknown> {
    return this.apiRequest(
      cfg,
      persist,
      'DELETE',
      btgCollectionsPath(this.companyId(cfg), collectionId),
    );
  }

  /** POST pix-cash-in/instant-collections — cobrança Pix imediata. */
  createPixInstant(
    cfg: BtgResolvedConfig,
    persist: PersistRefresh,
    payload: unknown,
  ): Promise<BtgPixInstantResponse> {
    return this.apiRequest(cfg, persist, 'POST', btgPixInstantPath(this.companyId(cfg)), payload);
  }

  /** GET pix-cash-in/instant-collections/{id} — status da cobrança Pix. */
  getPixInstant(
    cfg: BtgResolvedConfig,
    persist: PersistRefresh,
    id: string,
  ): Promise<BtgPixInstantResponse> {
    return this.apiRequest(cfg, persist, 'GET', btgPixInstantPath(this.companyId(cfg), id));
  }

  /** POST automatic-pix/authorization/flow — cria recorrência (Pix Automático). */
  createRecurrence(
    cfg: BtgResolvedConfig,
    persist: PersistRefresh,
    payload: unknown,
  ): Promise<BtgRecurrenceApiResponse> {
    return this.apiRequest(cfg, persist, 'POST', btgRecurrencePath(this.companyId(cfg)), payload);
  }

  /** GET automatic-pix/authorization/{id} — status da recorrência. */
  getRecurrence(
    cfg: BtgResolvedConfig,
    persist: PersistRefresh,
    authorizationId: string,
  ): Promise<BtgRecurrenceApiResponse> {
    return this.apiRequest(
      cfg,
      persist,
      'GET',
      btgRecurrencePath(this.companyId(cfg), authorizationId),
    );
  }

  /** DELETE automatic-pix/authorization/{id} — cancela a recorrência. */
  cancelRecurrence(
    cfg: BtgResolvedConfig,
    persist: PersistRefresh,
    authorizationId: string,
  ): Promise<unknown> {
    return this.apiRequest(
      cfg,
      persist,
      'DELETE',
      btgRecurrencePath(this.companyId(cfg), authorizationId),
    );
  }

  /** POST /{companyId}/apps/{appId}/webhooks — registra o webhook. */
  registerWebhook(
    cfg: BtgResolvedConfig,
    persist: PersistRefresh,
    payload: unknown,
  ): Promise<BtgWebhookRegisterResponse> {
    return this.apiRequest(
      cfg,
      persist,
      'POST',
      btgWebhookPath(this.companyId(cfg), cfg.credentials.clientId),
      payload,
    );
  }
}

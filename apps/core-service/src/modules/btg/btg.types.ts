/**
 * Tipos internos da integração BTG Pactual Empresas (BR).
 *
 * Auth via BTG Id (OpenID Connect / OAuth2):
 *  - client_credentials  → token "apps" (NÃO acessa APIs bancárias).
 *  - authorization_code  → token que opera a conta PJ (boleto/pix). OBRIGATÓRIO.
 *    Geramos um refresh_token (long-lived) no consentimento e o renovamos.
 *
 * Sem mTLS (diferente do EFI). Datas no formato AAAA-MM-DD.
 *
 * Os PATHS e SCOPES estão centralizados aqui porque a composição com o
 * companyId e o formato exato dos scopes precisam ser confirmados contra o
 * sandbox do BTG — manter num só lugar facilita o ajuste fino no teste.
 */

export type BtgEnv = 'PRODUCTION' | 'SANDBOX';

/** Host do BTG Id (Authorization Server) por ambiente. */
export const BTG_ID_BASE: Record<BtgEnv, string> = {
  PRODUCTION: 'https://id.btgpactual.com',
  SANDBOX: 'https://id.sandbox.btgpactual.com',
};

/** Host das APIs de produto (boleto/pix) por ambiente. */
export const BTG_API_BASE: Record<BtgEnv, string> = {
  PRODUCTION: 'https://api.empresas.btgpactual.com',
  SANDBOX: 'https://api.sandbox.empresas.btgpactual.com',
};

/**
 * Escopos default solicitados no consentimento. Inclui offline_access (p/ vir
 * refresh_token) e os escopos de produto (collections=boleto, pix-cash-in,
 * webhooks). Formato confirmar no sandbox — ajustável por tenant via config.
 */
export const BTG_DEFAULT_SCOPES =
  'openid offline_access ' +
  'brn:btg:empresas:banking:collections ' +
  'empresas.btgpactual.com/pix-cash-in ' +
  'webhooks';

// ── Builders de path (companyId entra na URL) ───────────────────────────────
/** Boleto/cobrança registrada vive sob /{companyId}/banking. */
export const btgCollectionsPath = (companyId: string, collectionId?: string): string =>
  `/${companyId}/banking/collections${collectionId ? `/${collectionId}` : ''}`;

/** Pix cash-in (cobrança instantânea) sob /companies/{companyId}/pix-cash-in. */
export const btgPixInstantPath = (companyId: string, id?: string): string =>
  `/companies/${companyId}/pix-cash-in/instant-collections${id ? `/${id}` : ''}`;

/** Pix Automático — autorização de recorrência. */
export const btgRecurrencePath = (companyId: string, authorizationId?: string): string =>
  `/${companyId}/banking/automatic-pix/authorization${authorizationId ? `/${authorizationId}` : '/flow'}`;

/** Webhooks: /{companyId}/apps/{appId}/webhooks (appId = clientId). */
export const btgWebhookPath = (companyId: string, appId: string, webhookId?: string): string =>
  `/${companyId}/apps/${appId}/webhooks${webhookId ? `/${webhookId}` : ''}`;

export interface BtgCredentials {
  clientId: string;
  clientSecret: string;
}

/** Config resolvida (segredos já decifrados) pronta pro client. */
export interface BtgResolvedConfig {
  tenantId: string;
  environment: BtgEnv;
  credentials: BtgCredentials;
  /** null até o admin concluir o consentimento (Authorization Code). */
  refreshToken: string | null;
  redirectUri: string | null;
  scopes: string;
  companyId: string | null;
  accountNumber: string | null;
  accountBranch: string | null;
  pixKey: string | null;
  expirationDays: number;
  finePercent: number | null;
  interestPercent: number | null;
}

/** Resposta do endpoint de token do BTG Id (/oauth2/token). */
export interface BtgTokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

// ── Respostas das APIs de produto (campos que consumimos) ───────────────────
/** Status de uma collection (boleto/pix cobrança). */
export type BtgCollectionStatus =
  | 'CREATED'
  | 'PROCESSING'
  | 'PAID'
  | 'CANCELED'
  | 'FAILED'
  | 'OVERDUE';

export interface BtgCollectionResponse {
  collectionId?: string;
  status?: BtgCollectionStatus;
  type?: string;
  amount?: number;
  dueDate?: string;
  overDueDate?: string;
  paidAmount?: number;
  settledAt?: string;
  detail?: {
    barCode?: string;
    digitableLine?: string;
    ourNumber?: string;
    emv?: string; // Pix copia-e-cola
    pixKey?: string;
    txId?: string;
    automaticPix?: { authorizationId?: string };
  };
}

/** Resposta da cobrança Pix instantânea (pix-cash-in). */
export interface BtgPixInstantResponse {
  id?: string;
  txId?: string;
  status?: string; // ACTIVE, CONCLUIDA, ...
  emv?: string;
  pixKey?: string;
  amount?: { value?: number; allowCustomerChangeValue?: boolean };
  location?: { id?: string; url?: string; path?: string };
}

/** Resposta da autorização de recorrência (Pix Automático). */
export interface BtgRecurrenceApiResponse {
  authorizationId?: string;
  status?: string; // PROCESSING|CREATED|APPROVED|REJECTED|EXPIRED|CANCELED|FINISHED
  initialDate?: string;
  finalDate?: string;
  period?: string;
  retryPolicy?: string;
  amount?: number;
  totalInstallments?: number;
  qrCodeInfo?: { emv?: string; journeyType?: string };
  activation?: { journeyType?: string; txId?: string };
  location?: { url?: string };
}

/** Resposta do registro de webhook. */
export interface BtgWebhookRegisterResponse {
  webhookId?: string;
  key?: string;
  endpoint?: string;
  events?: string[];
  secret?: string;
}

/** Envelope do webhook que o BTG POSTa em nós. */
export interface BtgWebhookEvent {
  webhookId?: string;
  event?: string;
  data?: Record<string, unknown>;
}

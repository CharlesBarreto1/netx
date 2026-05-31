/**
 * Tipos internos da integração EFI/EfiPay (BR).
 *
 * Duas APIs do EFI, mesma conta/credenciais:
 *  - API Pix       (mTLS obrigatório / certificado .p12) — Pix imediato (cob).
 *  - API Cobranças (sem certificado)                     — boleto + Pix (Bolix).
 */

export type EfiEnv = 'PRODUCTION' | 'SANDBOX';

/** URLs base por ambiente. */
export const EFI_PIX_BASE: Record<EfiEnv, string> = {
  PRODUCTION: 'https://pix.api.efipay.com.br',
  SANDBOX: 'https://pix-h.api.efipay.com.br',
};

export const EFI_COBRANCAS_BASE: Record<EfiEnv, string> = {
  PRODUCTION: 'https://cobrancas.api.efipay.com.br',
  SANDBOX: 'https://cobrancas-h.api.efipay.com.br',
};

export interface EfiCredentials {
  clientId: string;
  clientSecret: string;
}

/** Certificado mTLS já decifrado (PKCS#12). passphrase normalmente vazia. */
export interface EfiCertificate {
  pfx: Buffer;
  passphrase: string;
}

/** Config resolvida (segredos já decifrados) pronta pra usar no client. */
export interface EfiResolvedConfig {
  environment: EfiEnv;
  credentials: EfiCredentials;
  /** null quando o tenant ainda não subiu o .p12 → chamadas Pix falham. */
  certificate: EfiCertificate | null;
  pixKey: string | null;
  expirationDays: number;
  /** Multa (%) e juros a.m. (%) do boleto. null = sem. */
  finePercent: number | null;
  interestPercent: number | null;
}

// ── Respostas da API Pix (v2) — campos que consumimos ──────────────────────
export interface EfiPixCobResponse {
  txid: string;
  status: string; // ATIVA, CONCLUIDA, REMOVIDA_PELO_USUARIO_RECEBEDOR, ...
  loc?: { id?: number; location?: string };
  location?: string;
  pixCopiaECola?: string;
  calendario?: { criacao?: string; expiracao?: number };
  valor?: { original?: string };
}

export interface EfiPixQrCodeResponse {
  qrcode?: string; // copia-e-cola (EMV)
  imagemQrcode?: string; // data:image/png;base64,...
  linkVisualizacao?: string;
}

/** Item do array `pix` no webhook de Pix recebido. */
export interface EfiPixWebhookItem {
  endToEndId?: string;
  txid?: string;
  valor?: string;
  horario?: string;
  chave?: string;
}

// ── Respostas da API Cobranças (boleto/Bolix) ──────────────────────────────
export interface EfiBoletoOneStepResponse {
  code?: number;
  data?: {
    charge_id?: number;
    status?: string; // new, waiting, paid, unpaid, ...
    total?: number; // centavos
    barcode?: string; // linha digitável
    link?: string;
    pdf?: { charge?: string };
    expire_at?: string;
    // Bolix — presente quando a conta tem boleto-com-Pix habilitado.
    pix?: { qrcode?: string; qrcode_image?: string };
  };
}

/** Detalhe de notificação (GET /v1/notification/{token}). */
export interface EfiNotificationResponse {
  code?: number;
  data?: Array<{
    type?: string;
    custom_id?: string | null;
    status?: { current?: string; previous?: string };
    identifiers?: { charge_id?: number };
    received_by_efi?: boolean;
    created_at?: string;
    value?: number;
  }>;
}

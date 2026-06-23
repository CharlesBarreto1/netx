/**
 * Configuração EFI lida do ambiente (Hub é single-tenant — sem cifra por
 * tenant como no NetX). Pix exige mTLS com certificado .p12.
 */
export interface EfiConfig {
  enabled: boolean;
  environment: 'PRODUCTION' | 'SANDBOX';
  clientId: string;
  clientSecret: string;
  pfx: Buffer | null;
  passphrase: string;
  pixKey: string;
  expirationDays: number;
  webhookToken: string;
  publicUrl: string;
}

export function loadEfiConfig(): EfiConfig {
  const env = (process.env.EFI_ENVIRONMENT ?? 'PRODUCTION') === 'SANDBOX' ? 'SANDBOX' : 'PRODUCTION';
  const certB64 = process.env.EFI_CERTIFICATE_BASE64 ?? '';
  return {
    enabled: (process.env.EFI_ENABLED ?? 'false') === 'true',
    environment: env,
    clientId: process.env.EFI_CLIENT_ID ?? '',
    clientSecret: process.env.EFI_CLIENT_SECRET ?? '',
    pfx: certB64 ? Buffer.from(certB64, 'base64') : null,
    passphrase: process.env.EFI_CERTIFICATE_PASSWORD ?? '',
    pixKey: process.env.EFI_PIX_KEY ?? '',
    expirationDays: Number(process.env.EFI_PIX_EXPIRATION_DAYS ?? 3),
    webhookToken: process.env.EFI_WEBHOOK_TOKEN ?? '',
    publicUrl: (process.env.HUB_PUBLIC_URL ?? '').replace(/\/$/, ''),
  };
}

/** Pix exige todos os segredos + certificado. */
export function isEfiReady(cfg: EfiConfig): boolean {
  return cfg.enabled && !!cfg.clientId && !!cfg.clientSecret && !!cfg.pfx && !!cfg.pixKey;
}

export function efiPixBaseUrl(cfg: EfiConfig): string {
  return cfg.environment === 'SANDBOX'
    ? 'https://pix-h.api.efipay.com.br'
    : 'https://pix.api.efipay.com.br';
}

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Agent, request as httpsRequest } from 'node:https';

import {
  efiPixBaseUrl,
  isEfiReady,
  loadEfiConfig,
  type EfiConfig,
} from './efi-config';

interface PixCobResponse {
  txid?: string;
  status?: string;
  loc?: { id?: number };
  pixCopiaECola?: string;
  calendario?: { expiracao?: number };
}
interface QrCodeResponse {
  qrcode?: string;
  imagemQrcode?: string; // data URL
}

/**
 * Cliente da API Pix da EFI (v2). Usa node:https com Agent(pfx) porque o Pix
 * exige mTLS (certificado .p12) — o fetch/undici não faz mTLS de forma simples.
 * Token OAuth2 (Basic auth) cacheado em memória. Single-tenant (config via env).
 */
@Injectable()
export class EfiClientService {
  private readonly logger = new Logger(EfiClientService.name);
  private token: { value: string; exp: number } | null = null;

  config(): EfiConfig {
    return loadEfiConfig();
  }

  private agent(cfg: EfiConfig): Agent {
    if (!cfg.pfx) throw new ServiceUnavailableException('Certificado EFI ausente');
    return new Agent({ pfx: cfg.pfx, passphrase: cfg.passphrase });
  }

  /** Requisição HTTPS JSON com mTLS. Resolve com o corpo parseado. */
  private call<T>(
    cfg: EfiConfig,
    method: string,
    path: string,
    opts: { bearer?: string; basic?: boolean; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(efiPixBaseUrl(cfg) + path);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.basic) {
      headers.authorization =
        'Basic ' + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
    } else if (opts.bearer) {
      headers.authorization = `Bearer ${opts.bearer}`;
    }
    const payload = opts.body == null ? undefined : JSON.stringify(opts.body);
    if (payload) headers['content-length'] = String(Buffer.byteLength(payload));

    return new Promise<T>((resolve, reject) => {
      const req = httpsRequest(
        {
          method,
          hostname: url.hostname,
          path: url.pathname + url.search,
          headers,
          agent: this.agent(cfg),
          timeout: 20_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c as Buffer));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            const status = res.statusCode ?? 0;
            if (status < 200 || status >= 300) {
              reject(new ServiceUnavailableException(`EFI ${method} ${path} → ${status}: ${text.slice(0, 300)}`));
              return;
            }
            try {
              resolve((text ? JSON.parse(text) : {}) as T);
            } catch {
              reject(new ServiceUnavailableException('EFI: resposta não-JSON'));
            }
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('EFI timeout')));
      req.on('error', (err) => reject(new ServiceUnavailableException(`EFI: ${err.message}`)));
      if (payload) req.write(payload);
      req.end();
    });
  }

  private async getToken(cfg: EfiConfig): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.token && this.token.exp - 60 > now) return this.token.value;
    const res = await this.call<{ access_token?: string; expires_in?: number }>(
      cfg,
      'POST',
      '/oauth/token',
      { basic: true, body: { grant_type: 'client_credentials' } },
    );
    if (!res.access_token) throw new ServiceUnavailableException('EFI: token não retornado');
    this.token = { value: res.access_token, exp: now + (res.expires_in ?? 3600) };
    return res.access_token;
  }

  /** Cria/atualiza uma cobrança Pix imediata (idempotente por txid). */
  async createPixCob(
    cfg: EfiConfig,
    txid: string,
    amountReais: string,
    description: string,
  ): Promise<{ pixCopiaECola: string | null; qrImage: string | null; txid: string }> {
    if (!isEfiReady(cfg)) throw new ServiceUnavailableException('EFI não configurada');
    const token = await this.getToken(cfg);
    const cob = await this.call<PixCobResponse>(cfg, 'PUT', `/v2/cob/${txid}`, {
      bearer: token,
      body: {
        calendario: { expiracao: cfg.expirationDays * 86_400 },
        valor: { original: amountReais },
        chave: cfg.pixKey,
        solicitacaoPagador: description.slice(0, 140),
      },
    });
    let pixCopiaECola = cob.pixCopiaECola ?? null;
    let qrImage: string | null = null;
    if (cob.loc?.id != null) {
      const qr = await this.call<QrCodeResponse>(cfg, 'GET', `/v2/loc/${cob.loc.id}/qrcode`, {
        bearer: token,
      });
      pixCopiaECola = qr.qrcode ?? pixCopiaECola;
      qrImage = qr.imagemQrcode ?? null;
    }
    return { pixCopiaECola, qrImage, txid: cob.txid ?? txid };
  }
}

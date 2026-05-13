/**
 * SifenEmitterService — ponte com as libs TIPS-SA (open-source Paraguay).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Encapsula o pipeline xmlgen → xmlsign → qrgen → setapi pra que o resto do
 * NetX só consuma uma API simples. STUB por enquanto — quando o operador
 * configurar `SIFEN_ENABLED=true` + certificado, plugamos as libs reais:
 *
 *   npm i facturacionelectronicapy-xmlgen \
 *         facturacionelectronicapy-xmlsign \
 *         facturacionelectronicapy-qrgen \
 *         facturacionelectronicapy-setapi
 *
 * TODO: implementar de verdade depois da fase de homologação no Plan Piloto.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SifenEmitInput {
  type: string;
  cdc: string;
  emisorRuc: string;
  emisorTimbrado: string;
  emisorRazonSocial: string;
  establecimiento: string;
  puntoExpedicion: string;
  numero: number;
  issuedAt: Date;
  totalAmount: number;
  currency: string;
  receptor: {
    taxId: string | null;
    name: string | null;
  };
  items: Array<{
    code: string;
    description: string;
    quantity: number;
    unitPrice: number;
    /** Alíquota IVA (0, 5 ou 10 no Paraguai). */
    ivaRate: 0 | 5 | 10;
  }>;
}

export interface SifenEmitResult {
  ok: boolean;
  xmlGenerated: string;
  xmlSigned?: string;
  xmlSent?: string;
  sifenResponse?: unknown;
  qrUrl?: string;
  approvedAt?: Date;
  rejectionCode?: string;
  rejectionReason?: string;
  error?: string;
}

@Injectable()
export class SifenEmitterService {
  private readonly logger = new Logger(SifenEmitterService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Pipeline completo: gera XML → assina com .p12 → embute QR → envia ao SIFEN.
   * Não persiste — quem chama (SifenService) cuida do DB. Não lança em erros
   * "esperados" (rejeição SIFEN, timeout): retorna `ok: false` com motivo. Só
   * lança em config inválida ou exception fatal.
   */
  async emit(input: SifenEmitInput): Promise<SifenEmitResult> {
    const enabled = this.config.get<string>('SIFEN_ENABLED') === 'true';
    if (!enabled) {
      // Modo desligado: gera só placeholder pra audit não quebrar. Quando
      // SIFEN_ENABLED=true, troca pra implementação real.
      this.logger.warn(
        `[SIFEN] desabilitado (SIFEN_ENABLED!=true) — emit cdc=${input.cdc} simulado`,
      );
      return {
        ok: false,
        xmlGenerated: `<!-- STUB SIFEN: cdc=${input.cdc} type=${input.type} -->`,
        error: 'SIFEN_DISABLED',
      };
    }

    // ───────────────────────────────────────────────────────────────────────
    // TODO Plan Piloto (após homologação):
    //
    //   import { generate } from 'facturacionelectronicapy-xmlgen';
    //   import { sign } from 'facturacionelectronicapy-xmlsign';
    //   import { generateQR } from 'facturacionelectronicapy-qrgen';
    //   import { setapi } from 'facturacionelectronicapy-setapi';
    //
    //   const xmlGen = await generate({ ...input mapped pro shape v150 });
    //   const xmlSig = await sign(xmlGen, certPath, certPassword);
    //   const xmlQr  = await generateQR(xmlSig);
    //   const resp   = await setapi.envio({
    //     environment: this.config.get('SIFEN_ENVIRONMENT'),
    //     xml: xmlQr,
    //     ...soap config
    //   });
    //   return mapResponse(resp, xmlGen, xmlSig, xmlQr);
    // ───────────────────────────────────────────────────────────────────────

    this.logger.error(
      `[SIFEN] SIFEN_ENABLED=true mas SifenEmitterService.emit() ainda é stub. ` +
        `Plugar libs TIPS-SA antes de habilitar em produção.`,
    );
    return {
      ok: false,
      xmlGenerated: '<!-- STUB SIFEN: implementação real pendente -->',
      error: 'EMITTER_NOT_IMPLEMENTED',
    };
  }

  /**
   * Cancelación de DTE via evento. Pré-condição: documento APROBADO e dentro
   * de 48h do approvedAt. Quem chama (SifenService.cancel) deve validar.
   */
  async cancel(cdc: string, reason: string): Promise<SifenEmitResult> {
    const enabled = this.config.get<string>('SIFEN_ENABLED') === 'true';
    if (!enabled) {
      this.logger.warn(`[SIFEN] cancel cdc=${cdc} reason="${reason}" simulado`);
      return { ok: false, xmlGenerated: '', error: 'SIFEN_DISABLED' };
    }
    // TODO: chamar setapi.evento({ tipo: 'CANCELACION', cdc, motivo: reason }).
    return { ok: false, xmlGenerated: '', error: 'EMITTER_NOT_IMPLEMENTED' };
  }
}

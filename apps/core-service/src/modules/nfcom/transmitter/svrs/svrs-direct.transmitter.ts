/**
 * SvrsDirectTransmitter — emissor direto NFCom no SVRS (NetX como emissor).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Camadas:
 *   - status()    ✅ handshake mTLS real (NFComStatusServico) — valida cert,
 *                    conectividade e ambiente. NÃO depende do XSD de negócio.
 *   - authorize() ⏳ depende do gerador de XML conforme XSD oficial (NT
 *                    2026.002) + assinatura XMLDSig — em construção.
 *   - cancel()    ⏳ idem (evento de cancelamento).
 *
 * Registra-se no NfcomTransmitterRegistry no boot (espírito BrBillingService).
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';

import type { NfcomEffectiveConfig } from '../../nfcom-config.service';
import {
  type NfcomAuthorizeInput,
  type NfcomEventResult,
  type NfcomStatusResult,
  type NfcomTransmitResult,
  type NfcomTransmitter,
} from '../nfcom-transmitter.port';
import { NfcomTransmitterRegistry } from '../nfcom-transmitter.registry';
import { UF_CODE } from '../../chave.util';
import { buildStatusServicoXml, callSvrs } from './svrs-soap.client';
import { buildNfcomXml } from './nfcom-xml.builder';
import { signNfcomXml } from './nfcom-signer';

const QR_BASE = 'https://dfe-portal.svrs.rs.gov.br/nfcom/qrCode';

@Injectable()
export class SvrsDirectTransmitter implements NfcomTransmitter, OnModuleInit {
  private readonly logger = new Logger(SvrsDirectTransmitter.name);
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
  });

  constructor(private readonly registry: NfcomTransmitterRegistry) {}

  onModuleInit(): void {
    this.registry.register('SVRS_DIRECT', this);
  }

  async status(config: NfcomEffectiveConfig): Promise<NfcomStatusResult> {
    if (!config.certificate) {
      return { ok: false, error: 'Certificado A1 (.pfx) não configurado.' };
    }
    if (!UF_CODE[config.emitente.uf?.toUpperCase()]) {
      return { ok: false, error: `UF inválida: "${config.emitente.uf}"` };
    }

    try {
      const res = await callSvrs({
        env: config.environment,
        service: 'NFComStatusServico',
        innerXml: buildStatusServicoXml(config.environment),
        pfx: config.certificate.pfx,
        passphrase: config.certificate.passphrase,
      });
      const parsed = this.parser.parse(res.body) as Record<string, unknown>;
      const ret = this.deepFind(parsed, 'retConsStatServNFCom');
      const cStat = ret ? String(this.pick(ret, 'cStat') ?? '') : '';
      const motivo = ret ? String(this.pick(ret, 'xMotivo') ?? '') : '';
      const tMed = ret ? String(this.pick(ret, 'tMed') ?? '') : '';
      // 107 = Serviço em Operação.
      const ok = res.httpStatus === 200 && cStat === '107';
      if (!ok) {
        this.logger.warn(
          `[nfcom-status] http=${res.httpStatus} cStat=${cStat} motivo=${motivo}`,
        );
      }
      return { ok, cStat, motivo, tMed, rawResponse: ret ?? res.body };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`[nfcom-status] falha: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  async authorize(input: NfcomAuthorizeInput): Promise<NfcomTransmitResult> {
    const cfg = input.config;
    if (!cfg.certificate) {
      return { ok: false, status: 'REJECTED', error: 'Certificado A1 não configurado.' };
    }
    let chave: string;
    let xmlGenerated: string;
    let xmlSigned: string;
    try {
      const built = buildNfcomXml(input);
      chave = built.chave;
      xmlGenerated = built.xml;
      xmlSigned = signNfcomXml(built.xml, cfg.certificate.pfx, cfg.certificate.passphrase);
    } catch (e) {
      return {
        ok: false,
        status: 'REJECTED',
        error: `Falha ao gerar/assinar XML: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    try {
      const res = await callSvrs({
        env: cfg.environment,
        service: 'NFComRecepcao',
        innerXml: xmlSigned,
        pfx: cfg.certificate.pfx,
        passphrase: cfg.certificate.passphrase,
      });
      const parsed = this.parser.parse(res.body) as Record<string, unknown>;
      const ret = this.deepFind(parsed, 'retNFCom');
      const prot = ret ? this.deepFind(ret, 'infProt') : null;

      // cStat do protocolo (por documento) prevalece; senão o do lote/retorno.
      const cStat = String(
        (prot && this.pick(prot, 'cStat')) ?? (ret && this.pick(ret, 'cStat')) ?? '',
      );
      const xMotivo = String(
        (prot && this.pick(prot, 'xMotivo')) ?? (ret && this.pick(ret, 'xMotivo')) ?? '',
      );
      const nProt = prot ? String(this.pick(prot, 'nProt') ?? '') : '';
      const qrCodeData = `${QR_BASE}?chNFCom=${chave}&tpAmb=${cfg.environment === 'PRODUCAO' ? '1' : '2'}`;

      // 100 = Autorizado o uso da NFCom.
      if (res.httpStatus === 200 && cStat === '100') {
        return {
          ok: true,
          status: 'AUTHORIZED',
          chaveAcesso: chave,
          protocolo: nProt,
          xmlGenerated,
          xmlSigned,
          xmlAuthorized: xmlSigned,
          qrCodeData,
          rawResponse: ret ?? res.body,
        };
      }
      // Denegação (irregularidade fiscal): faixa 301..302 / 110.
      const denied = ['110', '301', '302'].includes(cStat);
      this.logger.warn(`[nfcom-authorize] http=${res.httpStatus} cStat=${cStat} ${xMotivo}`);
      return {
        ok: false,
        status: denied ? 'DENIED' : 'REJECTED',
        chaveAcesso: chave,
        xmlGenerated,
        xmlSigned,
        rejectionCode: cStat || undefined,
        rejectionReason: xMotivo || undefined,
        rawResponse: ret ?? res.body,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`[nfcom-authorize] falha de transporte: ${msg}`);
      return { ok: false, status: 'SENT', chaveAcesso: chave, xmlGenerated, xmlSigned, error: msg };
    }
  }

  cancel(
    _config: NfcomEffectiveConfig,
    _chaveAcesso: string,
    _protocolo: string,
    _motivo: string,
  ): Promise<NfcomEventResult> {
    return Promise.resolve({
      ok: false,
      error: 'Cancelamento (evento) em construção — próximo incremento.',
    });
  }

  // --- helpers de parse (resposta SOAP aninhada) ---
  private deepFind(obj: unknown, key: string): Record<string, unknown> | null {
    if (!obj || typeof obj !== 'object') return null;
    const rec = obj as Record<string, unknown>;
    if (key in rec && typeof rec[key] === 'object') {
      return rec[key] as Record<string, unknown>;
    }
    for (const v of Object.values(rec)) {
      const found = this.deepFind(v, key);
      if (found) return found;
    }
    return null;
  }

  private pick(obj: Record<string, unknown>, key: string): unknown {
    return obj[key];
  }
}

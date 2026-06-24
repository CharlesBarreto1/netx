/**
 * svrs-soap.client — transporte SOAP/mTLS aos web services do SVRS (NFCom).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * O SVRS exige TLS mútuo: o certificado A1 do emitente é o cliente TLS. Aqui
 * montamos o https.Agent a partir do .pfx (Node aceita pfx+passphrase direto,
 * sem node-forge). O corpo é um envelope SOAP 1.2 com o XML da mensagem dentro
 * do elemento `nfcomDadosMsg`.
 *
 * URLs (NFCom, SVRS):
 *   Prod:    https://nfcom.svrs.rs.gov.br/WS/<svc>/<svc>.asmx
 *   Homolog: https://nfcom-homologacao.svrs.rs.gov.br/WS/<svc>/<svc>.asmx
 *
 * ⚠️ Namespace/SOAPAction da operação devem casar com o WSDL publicado
 *    (…?wsdl). Os valores abaixo seguem o padrão portalfiscal NFCom; confirmar
 *    contra o WSDL antes da homologação.
 */
import { request as httpsRequest, Agent } from 'node:https';

export type SvrsService =
  | 'NFComRecepcao'
  | 'NFComStatusServico'
  | 'NFComConsulta'
  | 'NFComRecepcaoEvento';

export type SvrsEnvironment = 'HOMOLOGACAO' | 'PRODUCAO';

const BASE: Record<SvrsEnvironment, string> = {
  PRODUCAO: 'https://nfcom.svrs.rs.gov.br/WS',
  HOMOLOGACAO: 'https://nfcom-homologacao.svrs.rs.gov.br/WS',
};

const NS = 'http://www.portalfiscal.inf.br/nfcom/wsdl';

export function svrsEndpoint(env: SvrsEnvironment, svc: SvrsService): string {
  return `${BASE[env]}/${svc}/${svc}.asmx`;
}

/** tpAmb do leiaute: 1 = produção, 2 = homologação. */
export function tpAmb(env: SvrsEnvironment): '1' | '2' {
  return env === 'PRODUCAO' ? '1' : '2';
}

export interface SvrsCallInput {
  env: SvrsEnvironment;
  service: SvrsService;
  /** XML da mensagem (ex.: <consStatServNFCom>…</consStatServNFCom>). */
  innerXml: string;
  /** Certificado A1 (mTLS). */
  pfx: Buffer;
  passphrase: string;
  /** Timeout em ms (default 30s). */
  timeoutMs?: number;
}

export interface SvrsCallResult {
  httpStatus: number;
  /** Corpo bruto da resposta (envelope SOAP). */
  body: string;
}

/**
 * Envelope SOAP 1.2 com a mensagem dentro de `nfcomDadosMsg`. O SVRS NFCom
 * usa o mesmo padrão do NF3e/CT-e: a operação é o nome do serviço.
 */
function soapEnvelope(service: SvrsService, innerXml: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    '<soap12:Body>' +
    `<nfcomDadosMsg xmlns="${NS}/${service}">${innerXml}</nfcomDadosMsg>` +
    '</soap12:Body>' +
    '</soap12:Envelope>'
  );
}

/** POST do envelope SOAP com mTLS. Nunca lança HTTP — devolve status + corpo. */
export function callSvrs(input: SvrsCallInput): Promise<SvrsCallResult> {
  const url = new URL(svrsEndpoint(input.env, input.service));
  const envelope = soapEnvelope(input.service, input.innerXml);
  const agent = new Agent({
    pfx: input.pfx,
    passphrase: input.passphrase,
    keepAlive: false,
    // O SVRS é ICP-Brasil; mantemos a verificação padrão da cadeia.
  });

  return new Promise<SvrsCallResult>((resolve, reject) => {
    const req = httpsRequest(
      {
        method: 'POST',
        hostname: url.hostname,
        path: url.pathname,
        port: 443,
        agent,
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(envelope),
        },
        timeout: input.timeoutMs ?? 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () =>
          resolve({
            httpStatus: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('timeout', () => req.destroy(new Error('Timeout na chamada ao SVRS')));
    req.on('error', reject);
    req.write(envelope);
    req.end();
  });
}

/**
 * XML de consulta de status do serviço. Conforme consStatServNFCom_v1.00.xsd:
 * SÓ tpAmb + xServ (fixed "STATUS"); NÃO leva cUF no pedido (cUF é do endpoint).
 * Não exige assinatura.
 */
export function buildStatusServicoXml(env: SvrsEnvironment): string {
  return (
    `<consStatServNFCom xmlns="http://www.portalfiscal.inf.br/nfcom" versao="1.00">` +
    `<tpAmb>${tpAmb(env)}</tpAmb>` +
    `<xServ>STATUS</xServ>` +
    `</consStatServNFCom>`
  );
}

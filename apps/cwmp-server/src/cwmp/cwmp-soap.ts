/**
 * CWMP (TR-069) SOAP envelope helpers — parser + builder.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Protocolo TR-069 transporta CWMP RPCs em envelopes SOAP 1.1 sobre HTTP.
 * Spec: https://cwmp-data-models.broadband-forum.org/tr-069-1-6-0.html
 *
 * Mensagens que IMPORTAM pra ZTP minimal:
 *   CPE → ACS:
 *     - Inform              (boot/periodic/value-change — CPE se anuncia)
 *     - SetParameterValuesResponse
 *     - GetParameterValuesResponse
 *     - RebootResponse
 *     - Fault                (CPE rejeitou RPC)
 *   ACS → CPE:
 *     - InformResponse      (sempre primeiro response do session)
 *     - SetParameterValues  (config Wi-Fi)
 *     - GetParameterValues  (debug)
 *     - Reboot              (reinicia)
 *
 * Namespaces típicos:
 *   xmlns:soap = "http://schemas.xmlsoap.org/soap/envelope/"
 *   xmlns:cwmp = "urn:dslforum-org:cwmp-1-0" (ou 1-1, 1-2)
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { XMLBuilder, XMLParser } from 'fast-xml-parser';

const SOAP_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
const CWMP_NS = 'urn:dslforum-org:cwmp-1-0';

/** Resultado tipado do parsing de um envelope CWMP. */
export interface ParsedCwmpMessage {
  /** ID do header `cwmp:ID` — devolvido no response (correlação obrigatória). */
  cwmpId: string | null;
  /** Nome da RPC no body (`Inform`, `SetParameterValuesResponse`, etc). */
  kind: string;
  /** Conteúdo do body (sem o wrapper SOAP) — shape específico por kind. */
  body: Record<string, unknown>;
  /** XML cru pra debug/log. */
  raw: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Remove prefixos de namespace (soap:Envelope → Envelope) — trabalhamos
  // com nomes locais. Side effect: perdemos qual NS, mas pra TR-069 só
  // existem 2 (SOAP envelope + CWMP), então não há ambiguidade.
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseTagValue: true,
  trimValues: true,
  // Coerção CWMP: arrays podem aparecer com 1 só elemento (ex.: ParameterList
  // com 1 ParameterValueStruct). Forçar array sempre nesses paths.
  isArray: (name, jpath) => {
    // ParameterList/ParameterValueStruct e similares
    return (
      name === 'ParameterValueStruct' ||
      name === 'ParameterInfoStruct' ||
      name === 'EventStruct' ||
      jpath.endsWith('.ParameterList.ParameterValueStruct') ||
      jpath.endsWith('.Event.EventStruct')
    );
  },
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: false,
  suppressEmptyNode: false,
});

/**
 * Parseia envelope SOAP CWMP. Body vazio (CPE confirmando fim de session)
 * retorna `kind = 'EmptyPost'`.
 */
export function parseCwmp(xml: string): ParsedCwmpMessage {
  if (!xml || xml.trim() === '') {
    return { cwmpId: null, kind: 'EmptyPost', body: {}, raw: '' };
  }
  const obj = parser.parse(xml) as Record<string, unknown>;
  const env = (obj.Envelope ?? {}) as Record<string, unknown>;
  const header = (env.Header ?? {}) as Record<string, unknown>;
  const body = (env.Body ?? {}) as Record<string, unknown>;

  const cwmpId = extractCwmpId(header);

  // O primeiro elemento dentro de Body define o tipo da RPC.
  const bodyKeys = Object.keys(body).filter((k) => !k.startsWith('@_'));
  if (bodyKeys.length === 0) {
    return { cwmpId, kind: 'EmptyPost', body: {}, raw: xml };
  }
  const kind = bodyKeys[0];
  const rpcBody = (body[kind] as Record<string, unknown>) ?? {};
  return { cwmpId, kind, body: rpcBody, raw: xml };
}

function extractCwmpId(header: Record<string, unknown>): string | null {
  const id = header['ID'] as Record<string, unknown> | string | undefined;
  if (!id) return null;
  if (typeof id === 'string') return id;
  // Caso seja objeto com `#text` (quando tem atributos como soap:mustUnderstand)
  const text = (id as { '#text'?: unknown })['#text'];
  return text != null ? String(text) : null;
}

// =============================================================================
// Tipagens do Inform (a única mensagem CPE→ACS que dissecamos a fundo)
// =============================================================================
export interface InformPayload {
  deviceId: string;            // OUI-SerialNumber
  manufacturer: string;
  oui: string;
  productClass: string;
  serialNumber: string;
  events: string[];            // ex.: ['0 BOOTSTRAP', '2 PERIODIC']
  parameters: Record<string, string>;
  connectionRequestUrl: string | null;
}

/** Extrai dados úteis de um Inform parseado. */
export function extractInform(parsed: ParsedCwmpMessage): InformPayload | null {
  if (parsed.kind !== 'Inform') return null;
  const body = parsed.body;
  const deviceId = body.DeviceId as Record<string, unknown> | undefined;
  const events = body.Event as Record<string, unknown> | undefined;
  const paramList = body.ParameterList as Record<string, unknown> | undefined;

  const oui = String(deviceId?.OUI ?? '');
  const serial = String(deviceId?.SerialNumber ?? '');
  const eventList = ((events?.EventStruct as Array<Record<string, unknown>>) ?? []).map(
    (e) => String(e.EventCode ?? ''),
  );

  const parameters: Record<string, string> = {};
  const params =
    (paramList?.ParameterValueStruct as Array<Record<string, unknown>>) ?? [];
  for (const p of params) {
    const name = String(p.Name ?? '');
    // Value pode ser scalar ou objeto { '#text', '@_xsi:type' }
    const valRaw = p.Value as unknown;
    const value =
      valRaw != null && typeof valRaw === 'object'
        ? String((valRaw as { '#text'?: unknown })['#text'] ?? '')
        : String(valRaw ?? '');
    if (name) parameters[name] = value;
  }

  const connectionRequestUrl = parameters[
    'Device.ManagementServer.ConnectionRequestURL'
  ] ?? parameters['InternetGatewayDevice.ManagementServer.ConnectionRequestURL'] ?? null;

  return {
    deviceId: `${oui}-${serial}`,
    manufacturer: String(deviceId?.Manufacturer ?? ''),
    oui,
    productClass: String(deviceId?.ProductClass ?? ''),
    serialNumber: serial,
    events: eventList,
    parameters,
    connectionRequestUrl,
  };
}

// =============================================================================
// Builders — ACS → CPE
// =============================================================================

/** Wrap qualquer RPC dentro do envelope SOAP+cwmp. */
export function buildEnvelope(opts: {
  cwmpId: string;
  bodyXml: string; // já serializado, vai dentro de <soap:Body>
}): string {
  // Montamos manualmente porque fast-xml-parser não é amigável com
  // namespaces múltiplos + atributos no element root + mustUnderstand.
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<soap:Envelope xmlns:soap="${SOAP_NS}" xmlns:cwmp="${CWMP_NS}" ` +
    'xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<soap:Header>' +
    `<cwmp:ID soap:mustUnderstand="1">${escapeXml(opts.cwmpId)}</cwmp:ID>` +
    '</soap:Header>' +
    `<soap:Body>${opts.bodyXml}</soap:Body>` +
    '</soap:Envelope>'
  );
}

/** InformResponse — sempre primeiro response do ACS por session. */
export function buildInformResponse(cwmpId: string, maxEnvelopes = 1): string {
  return buildEnvelope({
    cwmpId,
    bodyXml:
      '<cwmp:InformResponse>' +
      `<MaxEnvelopes>${maxEnvelopes}</MaxEnvelopes>` +
      '</cwmp:InformResponse>',
  });
}

export interface SetParam {
  name: string;
  value: string | number | boolean;
  type: 'xsd:string' | 'xsd:int' | 'xsd:unsignedInt' | 'xsd:boolean';
}

/** SetParameterValues — ACS define múltiplos params no CPE. */
export function buildSetParameterValues(
  cwmpId: string,
  params: SetParam[],
  parameterKey = '',
): string {
  const items = params
    .map((p) => {
      const v =
        typeof p.value === 'boolean' ? (p.value ? '1' : '0') : String(p.value);
      return (
        '<ParameterValueStruct>' +
        `<Name>${escapeXml(p.name)}</Name>` +
        `<Value xsi:type="${p.type}">${escapeXml(v)}</Value>` +
        '</ParameterValueStruct>'
      );
    })
    .join('');
  // soap-enc array — Huawei aceita formato curto, mas pra robustez declaramos
  // o tipo explícito (alguns ACS clients exigem).
  const arrayAttr = `soap-enc:arrayType="cwmp:ParameterValueStruct[${params.length}]" xmlns:soap-enc="http://schemas.xmlsoap.org/soap/encoding/"`;
  return buildEnvelope({
    cwmpId,
    bodyXml:
      '<cwmp:SetParameterValues>' +
      `<ParameterList ${arrayAttr}>${items}</ParameterList>` +
      `<ParameterKey>${escapeXml(parameterKey)}</ParameterKey>` +
      '</cwmp:SetParameterValues>',
  });
}

/** GetParameterValues — ACS lê params do CPE. */
export function buildGetParameterValues(cwmpId: string, names: string[]): string {
  const items = names.map((n) => `<string>${escapeXml(n)}</string>`).join('');
  return buildEnvelope({
    cwmpId,
    bodyXml:
      '<cwmp:GetParameterValues>' +
      `<ParameterNames soap-enc:arrayType="xsd:string[${names.length}]" ` +
      'xmlns:soap-enc="http://schemas.xmlsoap.org/soap/encoding/">' +
      items +
      '</ParameterNames>' +
      '</cwmp:GetParameterValues>',
  });
}

export function buildReboot(cwmpId: string, commandKey = ''): string {
  return buildEnvelope({
    cwmpId,
    bodyXml:
      '<cwmp:Reboot>' +
      `<CommandKey>${escapeXml(commandKey)}</CommandKey>` +
      '</cwmp:Reboot>',
  });
}

export function buildFactoryReset(cwmpId: string): string {
  return buildEnvelope({
    cwmpId,
    bodyXml: '<cwmp:FactoryReset/>',
  });
}

// =============================================================================
// Helpers
// =============================================================================

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Re-export pra outros módulos. */
export const cwmpXmlBuilder = builder;

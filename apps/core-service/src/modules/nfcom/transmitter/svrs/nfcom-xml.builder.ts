/**
 * nfcom-xml.builder — gera o XML do <NFCom> conforme nfcom_v1.00.xsd (NT 2026.002).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Produz NFCom → infNFCom (ide/emit/dest/assinante/[gSub]/det+/total) + infNFComSupl
 * (qrCode), SEM a assinatura — o <ds:Signature> é inserido depois pelo signer,
 * como último filho de <NFCom> (ordem do XSD: infNFCom, infNFComSupl, Signature).
 *
 * Ordem dos elementos é RÍGIDA (xs:sequence) — não reordenar.
 * ⚠️ Cobre o happy-path de ISP (CRT normal/Simples, ICMS00/40/90/SN, PIS/COFINS
 *    omitidos por serem opcionais). gFat/gFidelidade/IBSCBS ficam fora do 1o passo.
 */
import { buildChaveNfcom, UF_CODE } from '../../chave.util';
import type { NfcomAuthorizeInput } from '../nfcom-transmitter.port';

const VERSAO = '1.00';
const NS = 'http://www.portalfiscal.inf.br/nfcom';
const QR_BASE = 'https://dfe-portal.svrs.rs.gov.br/nfcom/qrCode';

// --- formatadores ---
const esc = (v: string): string =>
  v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
const money = (n: number): string => (Math.round(n * 100) / 100).toFixed(2);
const qty = (n: number): string => (Math.round(n * 10000) / 10000).toFixed(4);
const aliq = (n: number): string => (Math.round(n * 100) / 100).toFixed(2);
const tag = (name: string, value: string | number): string =>
  `<${name}>${esc(String(value))}</${name}>`;
const onlyDigits = (s: string): string => s.replace(/\D/g, '');

/** dhEmi no formato AAAA-MM-DDTHH:MM:SS-03:00 (horário de Brasília, sem DST). */
function dhEmi(d: Date): string {
  const z = (n: number) => String(n).padStart(2, '0');
  // Componentes no fuso -03:00 a partir do epoch.
  const t = new Date(d.getTime() - 3 * 3600 * 1000);
  return (
    `${t.getUTCFullYear()}-${z(t.getUTCMonth() + 1)}-${z(t.getUTCDate())}` +
    `T${z(t.getUTCHours())}:${z(t.getUTCMinutes())}:${z(t.getUTCSeconds())}-03:00`
  );
}

export interface BuildNfcomResult {
  chave: string;
  /** XML do <NFCom> sem assinatura (pronto p/ assinar). */
  xml: string;
}

export function buildNfcomXml(input: NfcomAuthorizeInput): BuildNfcomResult {
  const c = input.config;
  const em = c.emitente;
  const tpAmb = c.environment === 'PRODUCAO' ? '1' : '2';
  const cUF = UF_CODE[em.uf?.toUpperCase()];
  if (!cUF) throw new Error(`UF do emitente inválida: "${em.uf}"`);
  if (!em.inscricaoEstadual) throw new Error('IE do emitente é obrigatória para NFCom.');
  if (!em.crt) throw new Error('CRT (regime tributário) do emitente é obrigatório.');
  if (!em.codMunicipio) throw new Error('Código do município do emitente (IBGE) é obrigatório.');
  assertEnder('emitente', {
    logradouro: em.endLogradouro,
    numero: em.endNumero,
    bairro: em.endBairro,
    municipioNome: em.endMunicipioNome,
    cep: em.endCep,
  });

  const finNFCom = input.substitui ? '3' : '0';
  const chave = buildChaveNfcom({
    uf: em.uf,
    issuedAt: input.issuedAt,
    cnpj: em.cnpj,
    serie: input.serie,
    numero: input.numero,
    cNF: input.cNF,
  });
  const cDV = chave.slice(-1);

  const ide =
    '<ide>' +
    tag('cUF', cUF) +
    tag('tpAmb', tpAmb) +
    tag('mod', '62') +
    tag('serie', onlyDigits(input.serie)) +
    tag('nNF', input.numero) +
    tag('cNF', input.cNF) +
    tag('cDV', cDV) +
    tag('dhEmi', dhEmi(input.issuedAt)) +
    tag('tpEmis', '1') +
    tag('nSiteAutoriz', '0') +
    tag('cMunFG', em.codMunicipio) +
    tag('finNFCom', finNFCom) +
    tag('tpFat', '0') +
    tag('verProc', 'NetX-NFCom-1.0') +
    '</ide>';

  const emit =
    '<emit>' +
    tag('CNPJ', em.cnpj) +
    tag('IE', em.inscricaoEstadual) +
    tag('CRT', em.crt) +
    tag('xNome', em.razaoSocial) +
    (em.nomeFantasia ? tag('xFant', em.nomeFantasia) : '') +
    '<enderEmit>' +
    tag('xLgr', em.endLogradouro!) +
    tag('nro', em.endNumero!) +
    (em.endComplemento ? tag('xCpl', em.endComplemento) : '') +
    tag('xBairro', em.endBairro!) +
    tag('cMun', em.codMunicipio) +
    tag('xMun', em.endMunicipioNome!) +
    tag('CEP', em.endCep!) +
    tag('UF', em.uf.toUpperCase()) +
    (em.fone ? tag('fone', onlyDigits(em.fone)) : '') +
    (em.email ? tag('email', em.email) : '') +
    '</enderEmit>' +
    '</emit>';

  const dest = buildDest(input);
  const assinante = buildAssinante(input);
  const gSub = input.substitui
    ? '<gSub>' + tag('chNFCom', onlyDigits(input.substitui.chaveAcesso)) + '</gSub>'
    : '';

  const { detXml, totVProd, totVBC, totVICMS } = buildDet(input);
  const total = buildTotal(totVProd, totVBC, totVICMS);

  const infNFCom =
    `<infNFCom versao="${VERSAO}" Id="NFCom${chave}">` +
    ide +
    emit +
    dest +
    assinante +
    gSub +
    detXml +
    total +
    '</infNFCom>';

  const qrCod = `${QR_BASE}?chNFCom=${chave}&amp;tpAmb=${tpAmb}`;
  const infSupl = `<infNFComSupl>${tag('qrCodNFCom', '')}</infNFComSupl>`.replace(
    '<qrCodNFCom></qrCodNFCom>',
    `<qrCodNFCom>${qrCod}</qrCodNFCom>`,
  );

  const xml =
    `<NFCom xmlns="${NS}" versao="${VERSAO}">` + infNFCom + infSupl + '</NFCom>';

  return { chave, xml };
}

// --- dest ---
function buildDest(input: NfcomAuthorizeInput): string {
  const r = input.receptor;
  const e = r.endereco;
  assertEnder('destinatário', e);
  const cUFDest = UF_CODE[e.uf?.toUpperCase()];
  if (!cUFDest) throw new Error(`UF do destinatário inválida: "${e.uf}"`);

  const taxId = r.taxId ? onlyDigits(r.taxId) : null;
  let idTag: string;
  if (taxId && taxId.length === 14) idTag = tag('CNPJ', taxId);
  else if (taxId && taxId.length === 11) idTag = tag('CPF', taxId);
  else idTag = tag('idOutros', taxId ?? (r.name || 'EX').slice(0, 20));

  const indIEDest = r.ie ? '1' : '9';

  return (
    '<dest>' +
    tag('xNome', r.name) +
    idTag +
    tag('indIEDest', indIEDest) +
    (r.ie ? tag('IE', onlyDigits(r.ie)) : '') +
    '<enderDest>' +
    tag('xLgr', e.logradouro) +
    tag('nro', e.numero) +
    (e.complemento ? tag('xCpl', e.complemento) : '') +
    tag('xBairro', e.bairro) +
    tag('cMun', e.codMunicipio) +
    tag('xMun', e.municipioNome) +
    tag('CEP', onlyDigits(e.cep)) +
    tag('UF', e.uf.toUpperCase()) +
    (e.fone ? tag('fone', onlyDigits(e.fone)) : '') +
    (r.email ? tag('email', r.email) : '') +
    '</enderDest>' +
    '</dest>'
  );
}

// --- assinante ---
function buildAssinante(input: NfcomAuthorizeInput): string {
  const a = input.assinante;
  return (
    '<assinante>' +
    tag('iCodAssinante', a.codigo.slice(0, 30)) +
    tag('tpAssinante', a.tipo) +
    tag('tpServUtil', a.tipoServico) +
    (a.contrato ? tag('nContrato', a.contrato.slice(0, 20)) : '') +
    '</assinante>'
  );
}

// --- det + acumuladores ---
function buildDet(input: NfcomAuthorizeInput): {
  detXml: string;
  totVProd: number;
  totVBC: number;
  totVICMS: number;
} {
  const c = input.config;
  const tax = input.tax;
  let totVProd = 0;
  let totVBC = 0;
  let totVICMS = 0;
  let detXml = '';

  input.items.forEach((item, i) => {
    const vProd = item.total;
    totVProd += vProd;

    const cClass = (item.cClass ?? tax.cClass ?? '').replace(/\D/g, '');
    if (cClass.length !== 7) {
      throw new Error(
        `Item "${item.description}": cClass deve ter 7 dígitos (configure em /settings/nfcom).`,
      );
    }
    const cfop = item.cfop ?? tax.cfop ?? '';

    const prod =
      '<prod>' +
      tag('cProd', item.code ?? `ITEM${i + 1}`) +
      tag('xProd', item.description.slice(0, 120)) +
      tag('cClass', cClass) +
      (cfop ? tag('CFOP', cfop) : '') +
      tag('uMed', uMedCode(item.unit)) +
      tag('qFaturada', qty(item.quantity)) +
      tag('vItem', money(item.unitPrice)) +
      tag('vProd', money(vProd)) +
      '</prod>';

    const { icmsXml, vBC, vICMS } = buildIcms(c.emitente.crt, tax, vProd);
    totVBC += vBC;
    totVICMS += vICMS;

    detXml += `<det nItem="${i + 1}">${prod}<imposto>${icmsXml}</imposto></det>`;
  });

  return { detXml, totVProd, totVBC, totVICMS };
}

/** Mapeia CST/CRT → grupo ICMS (ICMS00/40/90/SN). */
function buildIcms(
  crt: string | null,
  tax: NfcomAuthorizeInput['tax'],
  vProd: number,
): { icmsXml: string; vBC: number; vICMS: number } {
  const cst = (tax.cstIcms ?? '00').padStart(2, '0');
  const pICMS = tax.aliquotaIcms ?? 0;

  // Simples Nacional → ICMSSN (CST 90 + indSN=1).
  if (crt === '1' || crt === '2') {
    return {
      icmsXml: `<ICMSSN>${tag('CST', '90')}${tag('indSN', '1')}</ICMSSN>`,
      vBC: 0,
      vICMS: 0,
    };
  }

  // Isenta / não tributada.
  if (cst === '40' || cst === '41') {
    return { icmsXml: `<ICMS40>${tag('CST', cst)}</ICMS40>`, vBC: 0, vICMS: 0 };
  }

  // ICMS90 (outros) — com valores quando há alíquota.
  if (cst === '90') {
    const vBC = vProd;
    const vICMS = (vBC * pICMS) / 100;
    const body =
      tag('CST', '90') +
      tag('vBC', money(vBC)) +
      tag('pICMS', aliq(pICMS)) +
      tag('vICMS', money(vICMS));
    return { icmsXml: `<ICMS90>${body}</ICMS90>`, vBC, vICMS };
  }

  // Default: ICMS00 (tributação normal integral).
  const vBC = vProd;
  const vICMS = (vBC * pICMS) / 100;
  const body =
    tag('CST', '00') +
    tag('vBC', money(vBC)) +
    tag('pICMS', aliq(pICMS)) +
    tag('vICMS', money(vICMS));
  return { icmsXml: `<ICMS00>${body}</ICMS00>`, vBC, vICMS };
}

// --- total (todos os campos obrigatórios, mesmo zerados) ---
function buildTotal(vProd: number, vBC: number, vICMS: number): string {
  return (
    '<total>' +
    tag('vProd', money(vProd)) +
    '<ICMSTot>' +
    tag('vBC', money(vBC)) +
    tag('vICMS', money(vICMS)) +
    tag('vICMSDeson', money(0)) +
    tag('vFCP', money(0)) +
    '</ICMSTot>' +
    tag('vCOFINS', money(0)) +
    tag('vPIS', money(0)) +
    tag('vFUNTTEL', money(0)) +
    tag('vFUST', money(0)) +
    '<vRetTribTot>' +
    tag('vRetPIS', money(0)) +
    tag('vRetCofins', money(0)) +
    tag('vRetCSLL', money(0)) +
    tag('vIRRF', money(0)) +
    '</vRetTribTot>' +
    tag('vDesc', money(0)) +
    tag('vOutro', money(0)) +
    tag('vNF', money(vProd)) +
    '</total>'
  );
}

/** uMed do XSD: 1=Minuto, 2=MB, 3=GB, 4=UN. Default 4 (UN). */
function uMedCode(unit?: string): string {
  switch ((unit ?? '').toUpperCase()) {
    case 'MIN':
    case 'MINUTO':
      return '1';
    case 'MB':
      return '2';
    case 'GB':
      return '3';
    default:
      return '4';
  }
}

function assertEnder(
  who: string,
  e: {
    logradouro?: string | null;
    numero?: string | null;
    bairro?: string | null;
    municipioNome?: string | null;
    cep?: string | null;
  },
): void {
  const missing: string[] = [];
  if (!e.logradouro) missing.push('logradouro');
  if (!e.numero) missing.push('número');
  if (!e.bairro) missing.push('bairro');
  if (!e.municipioNome) missing.push('município');
  if (!e.cep) missing.push('CEP');
  if (missing.length) {
    throw new Error(`Endereço do ${who} incompleto: falta ${missing.join(', ')}.`);
  }
}

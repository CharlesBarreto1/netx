/**
 * SifenEmitterService — pipeline real com libs TIPS-SA (open-source PY).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Pipeline DE:
 *   xmlgen.generateXMLDE(params, data)
 *     → xmlsign.signXML(xml, .p12, password)
 *       → qrgen.generateQR(xmlSigned, idCSC, CSC, env)
 *         → setapi.recibe(id, xmlWithQR, env, certPath, password)
 *
 * Pipeline Cancelación:
 *   xmlgen.generateXMLEventoCancelacion(id, params, { cdc, motivo })
 *     → xmlsign.signXML(xml, .p12, password)
 *       → setapi.evento(id, xmlSigned, env, certPath, password)
 *
 * As 4 libs são `latest` (TIPS-SA libera frequentemente). `sifen-libs.d.ts`
 * mantém os types em sincronia. Se a SET mudar algo, atualizar o .d.ts e
 * mapper local (loadEmisorParams / mapInputToData).
 *
 * Erros esperados (SIFEN_DISABLED, validação Manual SIFEN, rejeição SET,
 * timeout, cert inválido) viram `{ok: false, error}`. Só lança em config
 * faltando (env var obrigatória ausente) — falha fatal do operador.
 */
import { promises as fs } from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import xmlgen, {
  type XmlEventoCancelacionData,
  type XmlGenData,
  type XmlGenParams,
} from 'facturacionelectronicapy-xmlgen';
import xmlsign from 'facturacionelectronicapy-xmlsign';
import qrgen from 'facturacionelectronicapy-qrgen';
import setapi from 'facturacionelectronicapy-setapi';

export interface SifenEmitInput {
  /** Tipo Prisma (FACTURA, NOTA_CREDITO, etc) — mapeado pra número SET internamente. */
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
  /** Pra NOTA_CREDITO / NOTA_DEBITO: CDC do documento original. */
  documentoAsociadoCdc?: string;
  /** Pra NOTA_CREDITO / NOTA_DEBITO: motivo SET (1=devolución, 2=desc., etc). */
  notaCreditoMotivo?: number;
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

/**
 * Config efetiva (per-tenant) que sobrescreve env vars. Quando vier null
 * (operação single-tenant legada), o emitter cai pra env vars do .env.
 * Senhas/CSC chegam aqui JÁ DECIFRADAS — caller (SifenConfigService) é
 * responsável pela decifragem.
 */
export interface SifenEmitterOverride {
  environment: 'test' | 'prod';
  emisor: {
    ruc: string;
    timbrado: string;
    timbradoFecha: string;
    razonSocial: string;
    nombreFantasia?: string;
    tipoContribuyente: 1 | 2;
    tipoRegimen: number;
    actividadCodigo: string;
    actividadDescripcion: string;
    establecimiento: string;
    puntoExpedicion: string;
    direccion: string;
    departamento: number;
    departamentoDesc: string;
    distrito: number;
    distritoDesc: string;
    ciudad: number;
    ciudadDesc: string;
    telefono?: string;
    email?: string;
  };
  certificate: { path: string; password: string };
  csc: { id: string; value: string };
}

// Mapeamento Prisma SifenDocumentType → código numérico do Manual SIFEN v150.
const TYPE_TO_SIFEN_CODE: Record<string, number> = {
  FACTURA: 1,
  AUTOFACTURA: 4,
  NOTA_CREDITO: 5,
  NOTA_DEBITO: 6,
  NOTA_REMISION: 7,
};

@Injectable()
export class SifenEmitterService {
  private readonly logger = new Logger(SifenEmitterService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Emite DTE de ponta a ponta. Não persiste — quem chama (SifenService) cuida
   * do DB. Devolve `{ok: false, error}` em rejeição/timeout, sem lançar.
   *
   * `id` numérico (eventoId/recibeId) é o número sequencial do contrato; usa o
   * próprio `input.numero` pra rastreabilidade no portal eKuatia.
   */
  async emit(
    input: SifenEmitInput,
    override?: SifenEmitterOverride | null,
  ): Promise<SifenEmitResult> {
    // Override (TenantSetting) NÃO precisa de SIFEN_ENABLED env — quem chama
    // já validou que o tenant tem config enabled=true. Sem override, mantém
    // gate por env (compat single-tenant).
    if (!override && !this.isEnabled()) {
      return this.disabledResult('emit', input.cdc);
    }

    const env = override?.environment ?? this.readEnvironment();
    const certPath = override?.certificate.path ?? this.requiredEnv('SIFEN_CERT_PATH');
    const certPassword =
      override?.certificate.password ?? this.requiredEnv('SIFEN_CERT_PASSWORD');
    const idCSC = override?.csc.id ?? this.requiredEnv('SIFEN_CSC_ID');
    const CSC = override?.csc.value ?? this.requiredEnv('SIFEN_CSC');

    // Cert existe e está legível? Falha cedo com mensagem clara — senão o
    // xmlsign joga erro genérico de OpenSSL difícil de debugar.
    try {
      await fs.access(certPath, fs.constants.R_OK);
    } catch {
      this.logger.error(`[SIFEN] cert ilegível: ${certPath}`);
      return {
        ok: false,
        xmlGenerated: '',
        error: `CERT_NOT_READABLE: ${certPath}`,
      };
    }

    const params = this.loadEmisorParams(override?.emisor);
    const data = this.mapInputToData(input);

    // Estágio 1: gerar XML do DE
    let xmlGenerated: string;
    try {
      xmlGenerated = await xmlgen.generateXMLDE(params, data, {
        defaultValues: true,
      });
    } catch (err) {
      const msg = this.errMsg(err);
      this.logger.error(`[SIFEN] xmlgen falhou cdc=${input.cdc}: ${msg}`);
      return {
        ok: false,
        xmlGenerated: '',
        error: `XMLGEN_FAILED: ${msg}`,
      };
    }

    // Estágio 2: assinar com .p12
    let xmlSigned: string;
    try {
      xmlSigned = await xmlsign.signXML(xmlGenerated, certPath, certPassword);
    } catch (err) {
      const msg = this.errMsg(err);
      this.logger.error(`[SIFEN] xmlsign falhou cdc=${input.cdc}: ${msg}`);
      return {
        ok: false,
        xmlGenerated,
        error: `XMLSIGN_FAILED: ${msg}`,
      };
    }

    // Estágio 3: embutir QR (campo AA002 do XML)
    let xmlWithQR: string;
    try {
      xmlWithQR = await qrgen.generateQR(xmlSigned, idCSC, CSC, env);
    } catch (err) {
      const msg = this.errMsg(err);
      this.logger.error(`[SIFEN] qrgen falhou cdc=${input.cdc}: ${msg}`);
      // QR é "soft fail" — sem ele a SET ainda recebe, mas o KuDE não é
      // imprimível. Decisão: tratar como erro pra forçar correção.
      return {
        ok: false,
        xmlGenerated,
        xmlSigned,
        error: `QRGEN_FAILED: ${msg}`,
      };
    }

    // Estágio 4: enviar pra SET (síncrono — recibe)
    let response: unknown;
    try {
      response = await setapi.recibe(
        input.numero,
        xmlWithQR,
        env,
        certPath,
        certPassword,
      );
    } catch (err) {
      const msg = this.errMsg(err);
      this.logger.error(`[SIFEN] setapi.recibe falhou cdc=${input.cdc}: ${msg}`);
      return {
        ok: false,
        xmlGenerated,
        xmlSigned,
        xmlSent: xmlWithQR,
        error: `SET_API_FAILED: ${msg}`,
      };
    }

    // Parsing da resposta SET — formato varia por versão da setapi. Defensivo:
    // procura em múltiplos campos conhecidos (response.codigo, response.estado,
    // response.dRespuesta, etc).
    const parsed = this.parseSetResponse(response);
    if (!parsed.ok) {
      this.logger.warn(
        `[SIFEN] DE rejeitado cdc=${input.cdc} code=${parsed.rejectionCode} reason="${parsed.rejectionReason}"`,
      );
      return {
        ok: false,
        xmlGenerated,
        xmlSigned,
        xmlSent: xmlWithQR,
        sifenResponse: response,
        rejectionCode: parsed.rejectionCode,
        rejectionReason: parsed.rejectionReason,
        error: parsed.rejectionCode ?? 'SET_REJECTED',
      };
    }

    this.logger.log(
      `[SIFEN] DE aprovado cdc=${input.cdc} numero=${input.numero}`,
    );
    return {
      ok: true,
      xmlGenerated,
      xmlSigned,
      xmlSent: xmlWithQR,
      sifenResponse: response,
      qrUrl: parsed.qrUrl,
      approvedAt: new Date(),
    };
  }

  /**
   * Cancela DTE via evento. Pré-condição (validada pelo SifenService): doc
   * APPROVED + dentro de 48h do approvedAt.
   */
  async cancel(
    cdc: string,
    reason: string,
    override?: SifenEmitterOverride | null,
  ): Promise<SifenEmitResult> {
    if (!override && !this.isEnabled()) {
      return this.disabledResult('cancel', cdc);
    }

    const env = override?.environment ?? this.readEnvironment();
    const certPath = override?.certificate.path ?? this.requiredEnv('SIFEN_CERT_PATH');
    const certPassword =
      override?.certificate.password ?? this.requiredEnv('SIFEN_CERT_PASSWORD');

    const params = this.loadEmisorParams(override?.emisor);
    const eventoData: XmlEventoCancelacionData = {
      cdc,
      // SET exige motivo entre 5 e 500 chars. Trimma e garante mínimo.
      motivo: reason.trim().slice(0, 500).padEnd(5, ' '),
    };

    // `id` do evento — usa últimos 9 dígitos do CDC pra ter número estável e
    // único por documento (eventos diferentes pro mesmo CDC vão re-enviar com
    // mesmo id, e SET trata como idempotente).
    const eventoId = Number(cdc.slice(-9)) || Date.now() % 1_000_000_000;

    let xmlGenerated: string;
    try {
      xmlGenerated = await xmlgen.generateXMLEventoCancelacion(
        eventoId,
        params,
        eventoData,
      );
    } catch (err) {
      const msg = this.errMsg(err);
      this.logger.error(`[SIFEN] xmlgen evento falhou cdc=${cdc}: ${msg}`);
      return { ok: false, xmlGenerated: '', error: `XMLGEN_FAILED: ${msg}` };
    }

    let xmlSigned: string;
    try {
      xmlSigned = await xmlsign.signXML(xmlGenerated, certPath, certPassword);
    } catch (err) {
      const msg = this.errMsg(err);
      this.logger.error(`[SIFEN] xmlsign evento falhou cdc=${cdc}: ${msg}`);
      return {
        ok: false,
        xmlGenerated,
        error: `XMLSIGN_FAILED: ${msg}`,
      };
    }

    let response: unknown;
    try {
      response = await setapi.evento(
        eventoId,
        xmlSigned,
        env,
        certPath,
        certPassword,
      );
    } catch (err) {
      const msg = this.errMsg(err);
      this.logger.error(`[SIFEN] setapi.evento falhou cdc=${cdc}: ${msg}`);
      return {
        ok: false,
        xmlGenerated,
        xmlSigned,
        xmlSent: xmlSigned,
        error: `SET_API_FAILED: ${msg}`,
      };
    }

    const parsed = this.parseSetResponse(response);
    if (!parsed.ok) {
      this.logger.warn(
        `[SIFEN] cancelación rejeitada cdc=${cdc} code=${parsed.rejectionCode} reason="${parsed.rejectionReason}"`,
      );
      return {
        ok: false,
        xmlGenerated,
        xmlSigned,
        xmlSent: xmlSigned,
        sifenResponse: response,
        rejectionCode: parsed.rejectionCode,
        rejectionReason: parsed.rejectionReason,
        error: parsed.rejectionCode ?? 'SET_REJECTED',
      };
    }

    this.logger.log(`[SIFEN] cancelación aprobada cdc=${cdc}`);
    return {
      ok: true,
      xmlGenerated,
      xmlSigned,
      xmlSent: xmlSigned,
      sifenResponse: response,
      approvedAt: new Date(),
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers privados
  // ---------------------------------------------------------------------------

  private isEnabled(): boolean {
    return this.config.get<string>('SIFEN_ENABLED') === 'true';
  }

  private readEnvironment(): 'test' | 'prod' {
    const v = this.config.get<string>('SIFEN_ENVIRONMENT') ?? 'test';
    return v === 'prod' ? 'prod' : 'test';
  }

  private disabledResult(op: 'emit' | 'cancel', cdc: string): SifenEmitResult {
    this.logger.warn(
      `[SIFEN] desabilitado (SIFEN_ENABLED!=true) — ${op} cdc=${cdc} simulado`,
    );
    return {
      ok: false,
      xmlGenerated: `<!-- STUB SIFEN: ${op} cdc=${cdc} (SIFEN_DISABLED) -->`,
      error: 'SIFEN_DISABLED',
    };
  }

  private requiredEnv(key: string): string {
    const v = this.config.get<string>(key);
    if (!v) {
      // Diferente do SifenService.requiredEnv (BadRequestException com 400 —
      // mostra pro operador). Aqui é Error puro: vira 500 lançado, debug-friendly,
      // mas só vai ocorrer se o admin esqueceu de configurar no /etc/netx/.env.
      throw new Error(`Configuração SIFEN ausente: ${key} (cheque /etc/netx/.env)`);
    }
    return v;
  }

  private errMsg(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }

  /**
   * Monta XmlGenParams. Se `override` vier preenchido (TenantSetting), usa
   * esses valores; senão lê das env vars (compat single-tenant).
   */
  private loadEmisorParams(
    override?: SifenEmitterOverride['emisor'],
  ): XmlGenParams {
    if (override) {
      return {
        version: 150,
        ruc: override.ruc,
        razonSocial: override.razonSocial,
        nombreFantasia: override.nombreFantasia || override.razonSocial,
        timbradoNumero: override.timbrado,
        timbradoFecha: override.timbradoFecha,
        tipoContribuyente: override.tipoContribuyente,
        tipoRegimen: override.tipoRegimen,
        actividadesEconomicas: [
          {
            codigo: override.actividadCodigo,
            descripcion: override.actividadDescripcion,
          },
        ],
        establecimientos: [
          {
            codigo: override.establecimiento,
            direccion: override.direccion,
            departamento: override.departamento,
            departamentoDescripcion: override.departamentoDesc,
            distrito: override.distrito,
            distritoDescripcion: override.distritoDesc,
            ciudad: override.ciudad,
            ciudadDescripcion: override.ciudadDesc,
            telefono: override.telefono || undefined,
            email: override.email || undefined,
          },
        ],
      };
    }

    // Fallback env (single-tenant legado).
    return {
      version: 150,
      ruc: this.requiredEnv('SIFEN_RUC'),
      razonSocial: this.requiredEnv('SIFEN_RAZON_SOCIAL'),
      nombreFantasia:
        this.config.get<string>('SIFEN_NOMBRE_FANTASIA') ||
        this.requiredEnv('SIFEN_RAZON_SOCIAL'),
      timbradoNumero: this.requiredEnv('SIFEN_TIMBRADO'),
      timbradoFecha: this.requiredEnv('SIFEN_TIMBRADO_FECHA'),
      tipoContribuyente: Number(
        this.config.get<string>('SIFEN_TIPO_CONTRIBUYENTE') ?? '2',
      ) as 1 | 2,
      tipoRegimen: Number(
        this.config.get<string>('SIFEN_TIPO_REGIMEN') ?? '8',
      ),
      actividadesEconomicas: [
        {
          codigo: this.requiredEnv('SIFEN_ACTIVIDAD_CODIGO'),
          descripcion: this.requiredEnv('SIFEN_ACTIVIDAD_DESCRIPCION'),
        },
      ],
      establecimientos: [
        {
          codigo:
            this.config.get<string>('SIFEN_ESTABLECIMIENTO') ?? '001',
          direccion: this.requiredEnv('SIFEN_EMISOR_DIRECCION'),
          departamento: Number(
            this.config.get<string>('SIFEN_EMISOR_DEPARTAMENTO') ?? '11',
          ),
          departamentoDescripcion:
            this.config.get<string>('SIFEN_EMISOR_DEPARTAMENTO_DESC') ?? 'CAPITAL',
          distrito: Number(
            this.config.get<string>('SIFEN_EMISOR_DISTRITO') ?? '143',
          ),
          distritoDescripcion:
            this.config.get<string>('SIFEN_EMISOR_DISTRITO_DESC') ?? 'ASUNCION',
          ciudad: Number(
            this.config.get<string>('SIFEN_EMISOR_CIUDAD') ?? '3344',
          ),
          ciudadDescripcion:
            this.config.get<string>('SIFEN_EMISOR_CIUDAD_DESC') ??
            'ASUNCION (DISTRITO)',
          telefono: this.config.get<string>('SIFEN_EMISOR_TELEFONO') || undefined,
          email: this.config.get<string>('SIFEN_EMISOR_EMAIL') || undefined,
        },
      ],
    };
  }

  /** Mapeia SifenEmitInput → XmlGenData (formato Manual SIFEN v150). */
  private mapInputToData(input: SifenEmitInput): XmlGenData {
    const tipoDocumento = TYPE_TO_SIFEN_CODE[input.type];
    if (!tipoDocumento) {
      throw new Error(`Tipo SIFEN desconhecido: ${input.type}`);
    }

    // RUC do receptor é dividido em "ruc-dv" ou string única conforme xmlgen.
    // xmlgen aceita string completa "12345678-9" e separa internamente.
    const hasRuc = !!input.receptor.taxId && /^\d{1,8}-\d$/.test(input.receptor.taxId);

    // tipoOperacion: 1=B2B (contribuyente), 2=B2C (consumidor final),
    // 3=B2G (gobierno), 4=B2F (extranjero).
    const tipoOperacion = hasRuc ? 1 : 2;

    const data: XmlGenData = {
      tipoDocumento,
      establecimiento: input.establecimiento,
      punto: input.puntoExpedicion,
      numero: String(input.numero).padStart(7, '0'),
      // Formato ISO sem timezone (SIFEN espera local PY-time, mas naive).
      fecha: this.formatLocalDate(input.issuedAt),
      tipoEmision: 1, // 1 = Normal, 2 = Contingencia
      tipoTransaccion: 2, // 2 = Prestación de servicios (telecom)
      tipoImpuesto: 1, // 1 = IVA
      moneda: input.currency,
      cliente: {
        contribuyente: hasRuc,
        ...(hasRuc ? { ruc: input.receptor.taxId! } : {}),
        tipoOperacion,
        razonSocial: input.receptor.name ?? 'SIN NOMBRE',
        // Pra B2C com RUC: tipoContribuyente=1 (física). Pra B2B com RUC:
        // assumimos 2 (jurídica) — o operador pode rever no painel SET se
        // afetar análise.
        ...(hasRuc ? { tipoContribuyente: 2 } : {}),
        // Pra B2C sem RUC: SET espera tipoDocumento + documentoNumero do
        // receptor (CI, passaporte, etc). Como NetX não captura CI hoje,
        // mandamos placeholder "Innominado". A regra exata de a partir de
        // qual valor a SET exige nominação completa muda em Resoluções
        // recentes — confirme com contador antes de produção.
        // Pra anular fatura emitida innominada, primeiro emita evento de
        // Nominación (não implementado na v1), depois a Nota de Crédito.
        ...(!hasRuc
          ? {
              tipoDocumento: 1, // 1 = CI Paraguay
              documentoNumero: '0',
            }
          : {}),
      },
      // Condição de venda — telecom mensal é tipicamente "contado" (1).
      // Crédito (2) só se for fatura emitida em parcelado real.
      condicion: {
        tipo: 1,
        entregas: [
          {
            tipo: 1, // Efectivo
            monto: input.totalAmount,
            moneda: input.currency,
          },
        ],
      },
      items: input.items.map((it) => ({
        codigo: it.code,
        descripcion: it.description,
        unidadMedida: 77, // 77 = Unidad (Manual SIFEN — telecom usa unidad)
        cantidad: it.quantity,
        precioUnitario: it.unitPrice,
        ivaTipo: 1, // 1 = Gravado IVA
        ivaBase: 100, // 100% gravado (telecom não tem isenção parcial padrão)
        iva: it.ivaRate,
      })),
    };

    // NC/ND exigem motivo + documento associado.
    if (
      (tipoDocumento === 5 || tipoDocumento === 6) &&
      input.documentoAsociadoCdc
    ) {
      data.notaCreditoDebito = { motivo: input.notaCreditoMotivo ?? 1 };
      data.documentoAsociado = {
        formato: 1, // 1 = Documento electrónico
        cdc: input.documentoAsociadoCdc,
      };
    }

    return data;
  }

  /** "2026-05-23T14:32:00" (sem timezone, hora local naive — SET espera assim). */
  private formatLocalDate(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    );
  }

  /**
   * Parser defensivo da resposta SET. Formato varia entre versões da setapi
   * (algumas devolvem JSON, outras XML parseado pra objeto). Tentamos as
   * chaves canônicas e devolvemos resumo normalizado.
   *
   * Códigos SET aprovação: 0260 = "Autorización del DE satisfactoria".
   * Códigos rejeição: 4xxx em geral.
   */
  private parseSetResponse(response: unknown): {
    ok: boolean;
    rejectionCode?: string;
    rejectionReason?: string;
    qrUrl?: string;
  } {
    if (!response || typeof response !== 'object') {
      return { ok: false, rejectionReason: 'Resposta SET vazia ou inválida' };
    }
    const r = response as Record<string, any>;

    // Procura código de resposta em múltiplas chaves possíveis
    const code: string | undefined =
      r.codigo ??
      r.codigoRespuesta ??
      r.dCodRes ??
      r.estado ??
      r?.rRetEnviDe?.dCodRes ??
      r?.respuesta?.codigo;

    const message: string | undefined =
      r.mensaje ??
      r.mensajeRespuesta ??
      r.dMsgRes ??
      r?.rRetEnviDe?.dMsgRes ??
      r?.respuesta?.mensaje;

    // Aprovação: códigos 0260 (DE) ou 0290 (evento)
    const APPROVED_CODES = new Set(['0260', '0290', '260', '290']);

    const codeStr = code != null ? String(code) : undefined;
    const isOk = !!codeStr && APPROVED_CODES.has(codeStr);

    if (isOk) {
      return {
        ok: true,
        qrUrl: r.qrUrl ?? r.urlQR ?? undefined,
      };
    }
    return {
      ok: false,
      rejectionCode: codeStr,
      rejectionReason: message ?? 'Rejeição sem mensagem',
    };
  }
}

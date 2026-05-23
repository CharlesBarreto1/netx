/**
 * Declarações TypeScript pras libs TIPS-SA (não publicam @types).
 *
 * As 4 libs usam JS puro com CommonJS exports default. Declaramos só o
 * formato que consumimos no SifenEmitterService — basta pra type-check do
 * pipeline. Se em algum momento precisarmos de mais funções, expandimos aqui.
 *
 * Mantenha estes shapes em sincronia com:
 *   - https://github.com/TIPS-SA/facturacionelectronicapy-xmlgen
 *   - https://github.com/TIPS-SA/facturacionelectronicapy-xmlsign
 *   - https://github.com/TIPS-SA/facturacionelectronicapy-qrgen
 *   - https://github.com/TIPS-SA/facturacionelectronicapy-setapi
 */

declare module 'facturacionelectronicapy-xmlgen' {
  /** Params estáticos do emisor (RUC, razon social, timbrado, atividade…). */
  export interface XmlGenParams {
    version: number;
    ruc: string;
    razonSocial: string;
    nombreFantasia?: string;
    timbradoNumero: string;
    timbradoFecha: string;
    tipoContribuyente: 1 | 2;
    tipoRegimen: number;
    actividadesEconomicas: Array<{ codigo: string; descripcion: string }>;
    establecimientos: Array<{
      codigo: string;
      direccion: string;
      numeroCasa?: string;
      departamento: number;
      departamentoDescripcion: string;
      distrito: number;
      distritoDescripcion: string;
      ciudad: number;
      ciudadDescripcion: string;
      telefono?: string;
      email?: string;
      denominacion?: string;
    }>;
  }

  /** Data variável do documento (tipo, cliente, items…). */
  export interface XmlGenData {
    tipoDocumento: number;
    establecimiento: string;
    punto: string;
    numero: string;
    fecha: string;
    tipoEmision?: number;
    tipoTransaccion?: number;
    tipoImpuesto?: number;
    moneda?: string;
    cambio?: number;
    condicionTipoCambio?: number;
    cliente: {
      contribuyente: boolean;
      ruc?: string;
      tipoOperacion?: number;
      razonSocial: string;
      nombreFantasia?: string;
      tipoContribuyente?: number;
      direccion?: string;
      numeroCasa?: number | string;
      departamento?: number;
      departamentoDescripcion?: string;
      distrito?: number;
      distritoDescripcion?: string;
      ciudad?: number;
      ciudadDescripcion?: string;
      pais?: string;
      paisDescripcion?: string;
      tipoDocumento?: number;
      documentoNumero?: string;
      telefono?: string;
      celular?: string;
      email?: string;
      codigo?: string;
    };
    condicion?: {
      tipo: number;
      entregas?: Array<{
        tipo: number;
        monto: number | string;
        moneda: string;
        cambio?: number;
      }>;
    };
    items: Array<{
      codigo: string;
      descripcion: string;
      observacion?: string;
      unidadMedida?: number;
      cantidad: number;
      precioUnitario: number;
      cambio?: number;
      descuento?: number;
      anticipo?: number;
      pais?: string;
      paisDescripcion?: string;
      tolerancia?: number;
      ivaTipo?: number;
      ivaBase?: number;
      iva: 0 | 5 | 10;
    }>;
    notaCreditoDebito?: {
      motivo: number;
    };
    documentoAsociado?: {
      formato?: number;
      tipo?: number;
      cdc?: string;
      numero?: string;
      timbrado?: string;
      fecha?: string;
    };
  }

  export interface XmlGenOptions {
    /** false = pula validações estritas do Manual SIFEN (útil em test). */
    defaultValues?: boolean;
    redondeoSedeCentral?: boolean;
  }

  /** Data do evento Cancelación. */
  export interface XmlEventoCancelacionData {
    cdc: string;
    motivo: string;
  }

  /** Gera DE (FACTURA tipoDocumento=1, NC=5, ND=6, AUTO=4, REMISION=7). */
  export function generateXMLDE(
    params: XmlGenParams,
    data: XmlGenData,
    options?: XmlGenOptions,
  ): Promise<string>;

  /** Gera XML do evento de cancelación. `id` é número sequencial do evento. */
  export function generateXMLEventoCancelacion(
    id: number,
    params: XmlGenParams,
    data: XmlEventoCancelacionData,
  ): Promise<string>;

  const xmlgen: {
    generateXMLDE: typeof generateXMLDE;
    generateXMLEventoCancelacion: typeof generateXMLEventoCancelacion;
  };
  export default xmlgen;
}

declare module 'facturacionelectronicapy-xmlsign' {
  /** Assina XML com cert .p12 + senha (PKCS#12, XAdES com timestamp). */
  export function signXML(
    xml: string,
    certPath: string,
    certPassword: string,
  ): Promise<string>;

  const xmlsign: {
    signXML: typeof signXML;
  };
  export default xmlsign;
}

declare module 'facturacionelectronicapy-qrgen' {
  /**
   * Insere campo AA002 (URL com QR) no XML assinado. Retorna XML modificado.
   * `env` = "test" | "prod" — controla qual URL do SET vai pro QR.
   */
  export function generateQR(
    xmlSigned: string,
    idCSC: string,
    CSC: string,
    env: 'test' | 'prod',
  ): Promise<string>;

  const qrgen: {
    generateQR: typeof generateQR;
  };
  export default qrgen;
}

declare module 'facturacionelectronicapy-setapi' {
  /** Resposta padrão da SET (XML deserializado). Schema varia conforme método. */
  export type SetApiResponse = Record<string, unknown>;

  /** Envio síncrono de 1 DE. */
  export function recibe(
    id: number,
    xmlSigned: string,
    env: 'test' | 'prod',
    certPath: string,
    certPassword: string,
  ): Promise<SetApiResponse>;

  /** Envio assíncrono em lote (até 50 DEs). */
  export function recibeLote(
    id: number,
    xmlSignedList: string[],
    env: 'test' | 'prod',
    certPath: string,
    certPassword: string,
  ): Promise<SetApiResponse>;

  /** Envio de evento (cancelación, inutilización, etc). */
  export function evento(
    id: number,
    xmlSigned: string,
    env: 'test' | 'prod',
    certPath: string,
    certPassword: string,
  ): Promise<SetApiResponse>;

  const setapi: {
    recibe: typeof recibe;
    recibeLote: typeof recibeLote;
    evento: typeof evento;
  };
  export default setapi;
}

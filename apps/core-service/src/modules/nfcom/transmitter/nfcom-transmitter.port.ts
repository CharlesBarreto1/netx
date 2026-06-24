/**
 * Porta NfcomTransmitter — abstração de "como o documento chega ao Fisco".
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Inversão de dependência no espírito do BrBillingService: o NfcomService
 * orquestra (sequência, persistência, audit) e delega a transmissão a um
 * transmissor registrado por enum. O 1o (e principal) transmissor é o
 * SVRS_DIRECT — NetX gera/assina/transmite o XML direto ao SVRS. Trocar/adicionar
 * caminho (ex.: agregador) = +1 adapter, sem tocar na orquestração.
 *
 * Contrato: o transmissor NUNCA lança — sempre devolve um NfcomTransmitResult
 * (ok=false + error em falha). O NfcomService decide retry/persistência.
 */
import type { NfcomEffectiveConfig } from '../nfcom-config.service';

/** Item de serviço da NFCom (uma linha do det/). */
export interface NfcomItemInput {
  description: string;
  /** Código do produto/serviço interno. */
  code?: string;
  quantity: number;
  unitPrice: number;
  total: number;
  /** Classificação fiscal do item (cClass — tabela MOC). */
  cClass?: string;
  cfop?: string;
  /** Unidade de medida (uMed). */
  unit?: string;
}

/** Payload denormalizado para emissão — tudo que o transmissor precisa. */
export interface NfcomAuthorizeInput {
  tenantId: string;
  config: NfcomEffectiveConfig;

  /** Identificação do documento. */
  serie: string;
  numero: number;
  /** Código numérico aleatório (cNF, 7 dígitos) — gerado pelo NfcomService. */
  cNF: string;
  issuedAt: Date;

  /** Destinatário do serviço (enderDest do XSD). */
  receptor: {
    /** CPF (11) ou CNPJ (14), só dígitos. null → idOutros. */
    taxId: string | null;
    name: string;
    ie?: string | null;
    email?: string | null;
    endereco: {
      logradouro: string;
      numero: string;
      complemento?: string | null;
      bairro: string;
      /** Código IBGE do município (7 díg). */
      codMunicipio: string;
      municipioNome: string;
      cep: string;
      uf: string;
      fone?: string | null;
    };
  };

  /** Dados do assinante (grupo `assinante`). */
  assinante: {
    /** iCodAssinante — código único do assinante (1-30). */
    codigo: string;
    /** tpAssinante (1=Comercial..3=Residencial/PF..99=Outros). */
    tipo: string;
    /** tpServUtil (4=Internet, etc). */
    tipoServico: string;
    /** nContrato (opcional). */
    contrato?: string | null;
  };

  /** Itens + total. */
  items: NfcomItemInput[];
  totalAmount: number;

  /** Tributação efetiva (defaults da config, já resolvidos). */
  tax: {
    cstIcms: string | null;
    aliquotaIcms: number | null;
    cfop: string | null;
    cClass: string | null;
    tpServ: string | null;
  };

  /** Para substituição (gSub): chave da NFCom substituída + motivo. */
  substitui?: { chaveAcesso: string; motivo: string } | null;
}

/** Resultado de uma transmissão (autorização). Nunca lança. */
export interface NfcomTransmitResult {
  ok: boolean;
  /** Status mapeado pra máquina de estados do NfcomDocument. */
  status: 'AUTHORIZED' | 'REJECTED' | 'DENIED' | 'SENT';
  chaveAcesso?: string;
  protocolo?: string;
  xmlGenerated?: string;
  xmlSigned?: string;
  xmlAuthorized?: string;
  qrCodeData?: string;
  /** Referência do documento no transmissor (id externo, quando houver). */
  transmitterRef?: string;
  /** cStat + xMotivo crus do Fisco (pra audit/diagnóstico). */
  rawResponse?: unknown;
  rejectionCode?: string;
  rejectionReason?: string;
  error?: string;
}

/** Resultado de um evento (cancelamento / substituição registrada). */
export interface NfcomEventResult {
  ok: boolean;
  protocolo?: string;
  rawResponse?: unknown;
  rejectionCode?: string;
  rejectionReason?: string;
  error?: string;
}

/** Status do serviço (handshake — valida cert/mTLS/conectividade). */
export interface NfcomStatusResult {
  ok: boolean;
  /** cStat (107 = serviço em operação). */
  cStat?: string;
  motivo?: string;
  /** Tempo médio de resposta informado pelo SVRS (tMed), se houver. */
  tMed?: string;
  rawResponse?: unknown;
  error?: string;
}

/**
 * Transmissor de NFCom. Implementações: SvrsDirectTransmitter (principal),
 * adapters de agregador (futuro).
 */
export interface NfcomTransmitter {
  /** Autoriza (emite) a NFCom no Fisco. Síncrono no SVRS. */
  authorize(input: NfcomAuthorizeInput): Promise<NfcomTransmitResult>;

  /** Cancela uma NFCom autorizada (evento). */
  cancel(
    config: NfcomEffectiveConfig,
    chaveAcesso: string,
    protocolo: string,
    motivo: string,
  ): Promise<NfcomEventResult>;

  /** Consulta status do serviço autorizador (handshake mTLS). */
  status(config: NfcomEffectiveConfig): Promise<NfcomStatusResult>;
}

/** Token de DI pro registry. */
export const NFCOM_TRANSMITTER_REGISTRY = Symbol('NFCOM_TRANSMITTER_REGISTRY');

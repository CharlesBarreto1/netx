/**
 * NfcomService — orquestra emissão/cancelamento/substituição de NFCom.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Fluxo (espelha SifenService): valida config → resolve origem (fatura/cobrança)
 * → sequência atômica → cria DRAFT → transmite (porta) → persiste + audita.
 * NUNCA deixa o transmissor lançar — falha vira lastError + nextRetryAt.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  NfcomDocumentStatus as PStatus,
  NfcomDocumentType as PType,
} from '@prisma/client';
import {
  paginationMeta,
  type CancelNfcomDocumentRequest,
  type EmitNfcomDocumentRequest,
  type ListNfcomDocumentsQuery,
  type NfcomDocumentResponse,
  type Paginated,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { formatCnf } from './chave.util';
import {
  NfcomConfigService,
  type NfcomEffectiveConfig,
} from './nfcom-config.service';
import type {
  NfcomAuthorizeInput,
  NfcomItemInput,
} from './transmitter/nfcom-transmitter.port';
import { NfcomTransmitterRegistry } from './transmitter/nfcom-transmitter.registry';

/** Nomes de UF → sigla (fallback quando CustomerAddress.state vem por extenso). */
const UF_BY_NAME: Record<string, string> = {
  ACRE: 'AC', ALAGOAS: 'AL', AMAPA: 'AP', AMAZONAS: 'AM', BAHIA: 'BA',
  CEARA: 'CE', 'DISTRITO FEDERAL': 'DF', 'ESPIRITO SANTO': 'ES', GOIAS: 'GO',
  MARANHAO: 'MA', 'MATO GROSSO': 'MT', 'MATO GROSSO DO SUL': 'MS',
  'MINAS GERAIS': 'MG', PARA: 'PA', PARAIBA: 'PB', PARANA: 'PR',
  PERNAMBUCO: 'PE', PIAUI: 'PI', 'RIO DE JANEIRO': 'RJ',
  'RIO GRANDE DO NORTE': 'RN', 'RIO GRANDE DO SUL': 'RS', RONDONIA: 'RO',
  RORAIMA: 'RR', 'SANTA CATARINA': 'SC', 'SAO PAULO': 'SP', SERGIPE: 'SE',
  TOCANTINS: 'TO',
};

@Injectable()
export class NfcomService {
  private readonly logger = new Logger(NfcomService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: NfcomConfigService,
    private readonly transmitters: NfcomTransmitterRegistry,
  ) {}

  // ---------------------------------------------------------------------------
  // EMIT
  // ---------------------------------------------------------------------------
  async emit(
    tenantId: string,
    actorUserId: string | null,
    input: EmitNfcomDocumentRequest,
  ): Promise<NfcomDocumentResponse> {
    if (!input.contractInvoiceId && !input.oneTimeChargeId) {
      throw new BadRequestException('Informe contractInvoiceId ou oneTimeChargeId');
    }
    const cfg = await this.config.loadEffectiveConfig(tenantId);
    if (!cfg || !cfg.enabled) {
      throw new BadRequestException(
        'NFCom desabilitada para este tenant. Acesse /settings/nfcom.',
      );
    }
    if (!cfg.certificate) {
      throw new BadRequestException('Certificado A1 (.pfx) não configurado.');
    }
    if (!this.transmitters.has(cfg.transmitter)) {
      throw new BadRequestException(`Transmissor ${cfg.transmitter} indisponível.`);
    }

    const origin = await this.resolveOrigin(tenantId, input, cfg);
    const serie = cfg.emitente.serie || '1';
    const numero = await this.nextSequence(tenantId);
    const cNF = formatCnf(Math.floor((numero * 7919 + 13) % 10_000_000) + 1);
    const issuedAt = new Date();

    // Snapshot tributário (defaults da config).
    const draft = await this.prisma.nfcomDocument.create({
      data: {
        tenantId,
        contractInvoiceId: input.contractInvoiceId ?? null,
        oneTimeChargeId: input.oneTimeChargeId ?? null,
        type: input.type === 'NFCOM_SUBSTITUICAO' ? PType.NFCOM_SUBSTITUICAO : PType.NFCOM,
        status: PStatus.DRAFT,
        serie,
        numero,
        emitenteCnpj: cfg.emitente.cnpj,
        receptorTaxId: origin.receptor.taxId,
        receptorName: origin.receptor.name,
        totalAmount: new Prisma.Decimal(origin.totalAmount),
        currency: 'BRL',
        cstIcms: cfg.taxDefaults.cstIcms,
        aliquotaIcms:
          cfg.taxDefaults.aliquotaIcms != null
            ? new Prisma.Decimal(cfg.taxDefaults.aliquotaIcms)
            : null,
        issuedAt,
      },
    });

    const authInput: NfcomAuthorizeInput = {
      tenantId,
      config: cfg,
      serie,
      numero,
      cNF,
      issuedAt,
      receptor: origin.receptor,
      assinante: origin.assinante,
      items: origin.items,
      totalAmount: origin.totalAmount,
      tax: cfg.taxDefaults,
    };

    const result = await this.transmitters.resolve(cfg.transmitter).authorize(authInput);

    const updated = await this.prisma.nfcomDocument.update({
      where: { id: draft.id },
      data: {
        status: PStatus[result.status],
        chaveAcesso: result.chaveAcesso ?? null,
        protocolo: result.protocolo ?? null,
        xmlGenerated: result.xmlGenerated ?? null,
        xmlSigned: result.xmlSigned ?? null,
        xmlAuthorized: result.xmlAuthorized ?? null,
        qrCodeData: result.qrCodeData ?? null,
        authResponse: result.rawResponse
          ? (result.rawResponse as Prisma.InputJsonValue)
          : undefined,
        rejectionCode: result.rejectionCode ?? null,
        rejectionReason: result.rejectionReason ?? null,
        baseCalculoIcms: this.icmsBase(cfg, origin.totalAmount),
        valorIcms: this.icmsValor(cfg, origin.totalAmount),
        signedAt: result.xmlSigned ? new Date() : null,
        sentAt: new Date(),
        authorizedAt: result.status === 'AUTHORIZED' ? new Date() : null,
        rejectedAt: result.status === 'REJECTED' || result.status === 'DENIED' ? new Date() : null,
        lastError: result.error ?? null,
        nextRetryAt: result.ok ? null : this.computeRetry(result.status),
      },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'nfcom.emit',
      resource: 'nfcom_document',
      resourceId: updated.id,
      metadata: {
        status: updated.status,
        chaveAcesso: updated.chaveAcesso,
        protocolo: updated.protocolo,
        rejectionCode: updated.rejectionCode,
      },
    });

    return this.toResponse(updated);
  }

  // ---------------------------------------------------------------------------
  // CANCEL / SUBSTITUTE
  // ---------------------------------------------------------------------------
  async cancel(
    tenantId: string,
    actorUserId: string | null,
    id: string,
    input: CancelNfcomDocumentRequest,
  ): Promise<NfcomDocumentResponse> {
    const doc = await this.prisma.nfcomDocument.findFirst({ where: { id, tenantId } });
    if (!doc) throw new NotFoundException('NFCom não encontrada');
    if (doc.status !== PStatus.AUTHORIZED) {
      throw new BadRequestException('Só é possível cancelar NFCom AUTORIZADA.');
    }
    const cfg = await this.config.loadEffectiveConfig(tenantId);
    if (!cfg?.certificate) throw new BadRequestException('Certificado não configurado.');

    const result = await this.transmitters
      .resolve(cfg.transmitter)
      .cancel(cfg, doc.chaveAcesso!, doc.protocolo ?? '', input.reason);

    if (!result.ok) {
      throw new BadRequestException(
        result.error ?? result.rejectionReason ?? 'Falha ao cancelar NFCom.',
      );
    }

    const updated = await this.prisma.nfcomDocument.update({
      where: { id: doc.id },
      data: {
        status: PStatus.CANCELLED,
        cancelProtocol: result.protocolo ?? null,
        cancelReason: input.reason,
        cancelledAt: new Date(),
      },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'nfcom.cancel',
      resource: 'nfcom_document',
      resourceId: updated.id,
      metadata: { chaveAcesso: updated.chaveAcesso, protocolo: result.protocolo },
    });
    return this.toResponse(updated);
  }

  /** Emite uma nova NFCom substituindo a original (finNFCom=3, gSub). */
  async substitute(
    tenantId: string,
    actorUserId: string | null,
    id: string,
    reason: string,
  ): Promise<NfcomDocumentResponse> {
    const original = await this.prisma.nfcomDocument.findFirst({ where: { id, tenantId } });
    if (!original) throw new NotFoundException('NFCom original não encontrada');
    if (original.status !== PStatus.AUTHORIZED || !original.chaveAcesso) {
      throw new BadRequestException('Só substitui NFCom AUTORIZADA.');
    }
    // Reaproveita a origem (fatura/cobrança) da original.
    const emitted = await this.emit(tenantId, actorUserId, {
      type: 'NFCOM_SUBSTITUICAO',
      contractInvoiceId: original.contractInvoiceId ?? undefined,
      oneTimeChargeId: original.oneTimeChargeId ?? undefined,
      note: `Substituição de ${original.chaveAcesso}: ${reason}`,
    });
    await this.prisma.nfcomDocument.update({
      where: { id: emitted.id },
      data: { substitutesId: original.id },
    });
    return { ...emitted, substitutesId: original.id };
  }

  // ---------------------------------------------------------------------------
  // LIST / GET
  // ---------------------------------------------------------------------------
  async list(
    tenantId: string,
    q: ListNfcomDocumentsQuery,
  ): Promise<Paginated<NfcomDocumentResponse>> {
    const where: Prisma.NfcomDocumentWhereInput = {
      tenantId,
      ...(q.type ? { type: q.type as PType } : {}),
      ...(q.status ? { status: q.status as PStatus } : {}),
      ...(q.contractInvoiceId ? { contractInvoiceId: q.contractInvoiceId } : {}),
      ...(q.oneTimeChargeId ? { oneTimeChargeId: q.oneTimeChargeId } : {}),
      ...(q.chaveAcesso ? { chaveAcesso: q.chaveAcesso } : {}),
      ...(q.serie ? { serie: q.serie } : {}),
      ...(q.issuedFrom || q.issuedTo
        ? {
            issuedAt: {
              ...(q.issuedFrom ? { gte: new Date(q.issuedFrom) } : {}),
              ...(q.issuedTo ? { lte: new Date(`${q.issuedTo}T23:59:59`) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.nfcomDocument.findMany({
        where,
        orderBy: { [q.sortBy]: q.sortDir },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.nfcomDocument.count({ where }),
    ]);
    return {
      data: rows.map((r) => this.toResponse(r)),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  async findById(tenantId: string, id: string): Promise<NfcomDocumentResponse> {
    const doc = await this.prisma.nfcomDocument.findFirst({ where: { id, tenantId } });
    if (!doc) throw new NotFoundException('NFCom não encontrada');
    return this.toResponse(doc);
  }

  async getXml(tenantId: string, id: string): Promise<string> {
    const doc = await this.prisma.nfcomDocument.findFirst({ where: { id, tenantId } });
    if (!doc) throw new NotFoundException('NFCom não encontrada');
    return doc.xmlAuthorized ?? doc.xmlSigned ?? doc.xmlGenerated ?? '';
  }

  // ---------------------------------------------------------------------------
  // Origem (fatura/cobrança) → receptor + assinante + itens
  // ---------------------------------------------------------------------------
  private async resolveOrigin(
    tenantId: string,
    input: EmitNfcomDocumentRequest,
    cfg: NfcomEffectiveConfig,
  ): Promise<{
    receptor: NfcomAuthorizeInput['receptor'];
    assinante: NfcomAuthorizeInput['assinante'];
    items: NfcomItemInput[];
    totalAmount: number;
  }> {
    if (input.contractInvoiceId) {
      const inv = await this.prisma.contractInvoice.findFirst({
        where: { id: input.contractInvoiceId, tenantId },
        include: {
          contract: {
            include: { customer: { include: { addresses: true } } },
          },
        },
      });
      if (!inv) throw new NotFoundException('ContractInvoice não encontrada');
      const amount = Number(inv.amount);
      const cust = inv.contract.customer;
      return {
        ...this.buildReceptorAssinante(cust, cfg, inv.contract.code),
        totalAmount: amount,
        items: [
          {
            code: inv.contract.code ?? `CTR-${inv.contractId.slice(0, 8)}`,
            description:
              inv.reference ?? `Mensalidade ${inv.dueDate.toISOString().slice(0, 7)}`,
            quantity: 1,
            unitPrice: amount,
            total: amount,
            cClass: cfg.taxDefaults.cClass ?? undefined,
            cfop: cfg.taxDefaults.cfop ?? undefined,
          },
        ],
      };
    }

    const ch = await this.prisma.oneTimeCharge.findFirst({
      where: { id: input.oneTimeChargeId!, tenantId },
      include: { customer: { include: { addresses: true } } },
    });
    if (!ch) throw new NotFoundException('OneTimeCharge não encontrada');
    const amount = Number(ch.amount);
    const code = ch.code ?? `CHG-${input.oneTimeChargeId!.slice(0, 8)}`;
    return {
      ...this.buildReceptorAssinante(ch.customer, cfg, code),
      totalAmount: amount,
      items: [
        {
          code,
          description: ch.description ?? code,
          quantity: 1,
          unitPrice: amount,
          total: amount,
          cClass: cfg.taxDefaults.cClass ?? undefined,
          cfop: cfg.taxDefaults.cfop ?? undefined,
        },
      ],
    };
  }

  private buildReceptorAssinante(
    customer: {
      id: string;
      displayName: string;
      taxId: string | null;
      stateRegistration: string | null;
      primaryEmail: string | null;
      primaryPhone: string | null;
      addresses: Array<{
        isPrimary: boolean;
        street: string;
        number: string | null;
        complement: string | null;
        district: string | null;
        city: string;
        state: string | null;
        postalCode: string | null;
      }>;
    },
    cfg: NfcomEffectiveConfig,
    contractCode: string | null,
  ): {
    receptor: NfcomAuthorizeInput['receptor'];
    assinante: NfcomAuthorizeInput['assinante'];
  } {
    const addr =
      customer.addresses.find((a) => a.isPrimary) ?? customer.addresses[0];
    if (!addr) {
      throw new BadRequestException(
        `Cliente "${customer.displayName}" sem endereço cadastrado — exigido pela NFCom.`,
      );
    }
    const uf = this.normalizeUf(addr.state) ?? cfg.emitente.uf;
    // ⚠️ CustomerAddress não guarda o código IBGE do município (cMun). Sem ele,
    // caímos no cMun do emitente (mesma praça) — homologação smoke-test. O SVRS
    // rejeita cMun inválido; para produção, cadastrar o IBGE do cliente.
    const cMun = cfg.emitente.codMunicipio ?? '';
    const taxId = customer.taxId ? customer.taxId.replace(/\D/g, '') : null;

    return {
      receptor: {
        taxId,
        name: customer.displayName,
        ie: customer.stateRegistration,
        email: customer.primaryEmail,
        endereco: {
          logradouro: addr.street,
          numero: addr.number ?? 'S/N',
          complemento: addr.complement,
          bairro: addr.district ?? 'Centro',
          codMunicipio: cMun,
          municipioNome: addr.city,
          cep: (addr.postalCode ?? '').replace(/\D/g, ''),
          uf,
          fone: customer.primaryPhone,
        },
      },
      assinante: {
        codigo: contractCode ?? customer.id.slice(0, 30),
        tipo: taxId && taxId.length === 14 ? '1' : '3', // 1=Comercial, 3=Residencial/PF
        tipoServico: cfg.taxDefaults.tpServ ?? '4', // 4=Internet
        contrato: contractCode,
      },
    };
  }

  private normalizeUf(state: string | null): string | null {
    if (!state) return null;
    const s = state.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(s)) return s;
    const noAccent = s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    return UF_BY_NAME[noAccent] ?? null;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  /** Próximo número sequencial por tenant (atômico via transação na config). */
  private async nextSequence(tenantId: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const cfg = await tx.nfcomConfig.findUnique({ where: { tenantId } });
      const numero = cfg?.nextNumero ?? 1;
      await tx.nfcomConfig.update({
        where: { tenantId },
        data: { nextNumero: numero + 1 },
      });
      return numero;
    });
  }

  private icmsBase(cfg: NfcomEffectiveConfig, total: number): Prisma.Decimal | null {
    const cst = cfg.taxDefaults.cstIcms ?? '00';
    if (cst === '40' || cst === '41' || cfg.emitente.crt === '1') return new Prisma.Decimal(0);
    return new Prisma.Decimal(total);
  }

  private icmsValor(cfg: NfcomEffectiveConfig, total: number): Prisma.Decimal | null {
    const cst = cfg.taxDefaults.cstIcms ?? '00';
    const aliq = cfg.taxDefaults.aliquotaIcms ?? 0;
    if (cst === '40' || cst === '41' || cfg.emitente.crt === '1') return new Prisma.Decimal(0);
    return new Prisma.Decimal((total * aliq) / 100);
  }

  /** Retry simples: REJECTED/DENIED não re-tenta; SENT (transporte) re-tenta em 5min. */
  private computeRetry(status: string): Date | null {
    return status === 'SENT' ? new Date(Date.now() + 5 * 60_000) : null;
  }

  private toResponse(d: {
    id: string;
    tenantId: string;
    contractInvoiceId: string | null;
    oneTimeChargeId: string | null;
    type: PType;
    status: PStatus;
    serie: string;
    numero: number;
    chaveAcesso: string | null;
    protocolo: string | null;
    emitenteCnpj: string;
    receptorTaxId: string | null;
    receptorName: string | null;
    totalAmount: Prisma.Decimal;
    currency: string;
    cstIcms: string | null;
    aliquotaIcms: Prisma.Decimal | null;
    baseCalculoIcms: Prisma.Decimal | null;
    valorIcms: Prisma.Decimal | null;
    danfeUrl: string | null;
    qrCodeData: string | null;
    rejectionCode: string | null;
    rejectionReason: string | null;
    cancelReason: string | null;
    substitutesId: string | null;
    issuedAt: Date;
    signedAt: Date | null;
    sentAt: Date | null;
    authorizedAt: Date | null;
    rejectedAt: Date | null;
    cancelledAt: Date | null;
    retryCount: number;
    lastError: string | null;
    nextRetryAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): NfcomDocumentResponse {
    return {
      id: d.id,
      tenantId: d.tenantId,
      contractInvoiceId: d.contractInvoiceId,
      oneTimeChargeId: d.oneTimeChargeId,
      type: d.type,
      status: d.status,
      serie: d.serie,
      numero: d.numero,
      numeroDocumento: `${d.serie}-${String(d.numero).padStart(9, '0')}`,
      chaveAcesso: d.chaveAcesso,
      protocolo: d.protocolo,
      emitenteCnpj: d.emitenteCnpj,
      receptorTaxId: d.receptorTaxId,
      receptorName: d.receptorName,
      totalAmount: Number(d.totalAmount),
      currency: d.currency,
      cstIcms: d.cstIcms,
      aliquotaIcms: d.aliquotaIcms != null ? Number(d.aliquotaIcms) : null,
      baseCalculoIcms: d.baseCalculoIcms != null ? Number(d.baseCalculoIcms) : null,
      valorIcms: d.valorIcms != null ? Number(d.valorIcms) : null,
      danfeUrl: d.danfeUrl,
      qrCodeData: d.qrCodeData,
      rejectionCode: d.rejectionCode,
      rejectionReason: d.rejectionReason,
      cancelReason: d.cancelReason,
      substitutesId: d.substitutesId,
      issuedAt: d.issuedAt.toISOString(),
      signedAt: d.signedAt?.toISOString() ?? null,
      sentAt: d.sentAt?.toISOString() ?? null,
      authorizedAt: d.authorizedAt?.toISOString() ?? null,
      rejectedAt: d.rejectedAt?.toISOString() ?? null,
      cancelledAt: d.cancelledAt?.toISOString() ?? null,
      retryCount: d.retryCount,
      lastError: d.lastError,
      nextRetryAt: d.nextRetryAt?.toISOString() ?? null,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    };
  }
}

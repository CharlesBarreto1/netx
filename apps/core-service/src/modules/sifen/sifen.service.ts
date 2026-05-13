/**
 * SifenService — emissão e persistência de DTEs (DE aprovados pelo SIFEN).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Orquestra: cdc.util → SifenEmitterService → Prisma persist → audit log.
 * Hooks futuros: chamado automaticamente por ContractInvoicesService.create()
 * e OneTimeChargesService.create() (TODO — adicionar quando habilitar).
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  SifenDocumentStatus as PrismaStatus,
  SifenDocumentType as PrismaType,
} from '@prisma/client';

import {
  paginationMeta,
  type EmitSifenDocumentRequest,
  type CancelSifenDocumentRequest,
  type ListSifenDocumentsQuery,
  type Paginated,
  type SifenDocumentResponse,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { formatNumeroDocumento, generateCdc } from './cdc.util';
import { SifenEmitterService } from './sifen-emitter.service';

const PUBLIC_PORTAL_URL = 'https://ekuatia.set.gov.py/consultas/qr';

@Injectable()
export class SifenService {
  private readonly logger = new Logger(SifenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly emitter: SifenEmitterService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // EMIT — manual via API ou hook automático no fluxo de fatura
  // ---------------------------------------------------------------------------
  async emit(
    tenantId: string,
    actorUserId: string | null,
    input: EmitSifenDocumentRequest,
  ): Promise<SifenDocumentResponse> {
    if (!input.contractInvoiceId && !input.oneTimeChargeId) {
      throw new BadRequestException('Informe contractInvoiceId ou oneTimeChargeId');
    }

    // Pega config do tenant (TODO: substituir por TenantSetting com fallback
    // pro env enquanto não tem UI de config). Por agora lê só do env.
    const emisorRuc = this.requiredEnv('SIFEN_RUC');
    const emisorTimbrado = this.requiredEnv('SIFEN_TIMBRADO');
    const establecimiento = this.config.get<string>('SIFEN_ESTABLECIMIENTO') ?? '001';
    const puntoExpedicion = this.config.get<string>('SIFEN_PUNTO_EXPEDICION') ?? '001';
    const emisorRazonSocial = this.requiredEnv('SIFEN_RAZON_SOCIAL');

    // Carrega origem (invoice ou charge) com cliente
    const origin = await this.resolveOrigin(tenantId, input);

    // Sequência atômica: próximo número disponível por (tenant/estab/punto/type)
    const numero = await this.nextSequence(tenantId, establecimiento, puntoExpedicion);

    const issuedAt = new Date();
    const cdc = generateCdc({
      type: input.type,
      emisorRuc,
      establecimiento,
      puntoExpedicion,
      numero,
      issuedAt,
    });

    // Cria registro DRAFT primeiro — assim mesmo se SIFEN cair, temos audit.
    const draft = await this.prisma.sifenDocument.create({
      data: {
        tenantId,
        contractInvoiceId: input.contractInvoiceId ?? null,
        oneTimeChargeId: input.oneTimeChargeId ?? null,
        type: input.type as PrismaType,
        status: PrismaStatus.DRAFT,
        establecimiento,
        puntoExpedicion,
        numero,
        cdc,
        emisorRuc,
        emisorTimbrado,
        receptorTaxId: origin.receptorTaxId,
        receptorName: origin.receptorName,
        totalAmount: new Prisma.Decimal(origin.totalAmount),
        currency: origin.currency,
        issuedAt,
      },
    });

    // Chama emitter (xmlgen → sign → qr → SIFEN). Pode demorar; é OK pq
    // estamos num endpoint de ação manual / hook async.
    const result = await this.emitter.emit({
      type: input.type,
      cdc,
      emisorRuc,
      emisorTimbrado,
      emisorRazonSocial,
      establecimiento,
      puntoExpedicion,
      numero,
      issuedAt,
      totalAmount: origin.totalAmount,
      currency: origin.currency,
      receptor: {
        taxId: origin.receptorTaxId,
        name: origin.receptorName,
      },
      items: origin.items,
    });

    // Persiste resultado
    const finalStatus = result.ok ? PrismaStatus.APPROVED : PrismaStatus.REJECTED;
    const qrUrl = result.qrUrl ?? `${PUBLIC_PORTAL_URL}?nVersion=150&Id=${cdc}`;
    const updated = await this.prisma.sifenDocument.update({
      where: { id: draft.id },
      data: {
        status: finalStatus,
        xmlGenerated: result.xmlGenerated,
        xmlSigned: result.xmlSigned ?? null,
        xmlSent: result.xmlSent ?? null,
        sifenResponse: result.sifenResponse
          ? (result.sifenResponse as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        qrUrl,
        signedAt: result.xmlSigned ? new Date() : null,
        sentAt: result.xmlSent ? new Date() : null,
        approvedAt: result.ok ? (result.approvedAt ?? new Date()) : null,
        rejectedAt: !result.ok ? new Date() : null,
        rejectionCode: result.rejectionCode ?? null,
        rejectionReason: result.rejectionReason ?? result.error ?? null,
        lastError: result.error ?? null,
      },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: result.ok ? 'sifen.document.approved' : 'sifen.document.rejected',
      resource: 'sifen_documents',
      resourceId: updated.id,
      metadata: {
        cdc,
        numero: formatNumeroDocumento(establecimiento, puntoExpedicion, numero),
        type: input.type,
        contractInvoiceId: input.contractInvoiceId ?? null,
        oneTimeChargeId: input.oneTimeChargeId ?? null,
        totalAmount: origin.totalAmount,
        rejectionCode: result.rejectionCode ?? null,
      },
    });

    return this.toResponse(updated);
  }

  // ---------------------------------------------------------------------------
  // CANCEL — janela de 48h após approvedAt
  // ---------------------------------------------------------------------------
  async cancel(
    tenantId: string,
    actorUserId: string | null,
    id: string,
    input: CancelSifenDocumentRequest,
  ): Promise<SifenDocumentResponse> {
    const doc = await this.prisma.sifenDocument.findFirst({
      where: { id, tenantId },
    });
    if (!doc) throw new NotFoundException('Documento SIFEN não encontrado');
    if (doc.status !== PrismaStatus.APPROVED) {
      throw new BadRequestException(
        `Só docs APPROVED podem ser cancelados (atual: ${doc.status})`,
      );
    }
    if (!doc.approvedAt) {
      throw new BadRequestException('approvedAt ausente — não dá pra calcular janela de 48h');
    }
    const ageMs = Date.now() - doc.approvedAt.getTime();
    if (ageMs > 48 * 3600_000) {
      throw new ConflictException(
        'Janela de 48h pra cancelar expirou. Emita Nota de Crédito.',
      );
    }

    const result = await this.emitter.cancel(doc.cdc, input.reason);

    const updated = await this.prisma.sifenDocument.update({
      where: { id: doc.id },
      data: {
        status: result.ok ? PrismaStatus.CANCELLED : doc.status,
        cancelledAt: result.ok ? new Date() : null,
        lastError: result.ok ? null : (result.error ?? 'cancel failed'),
      },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: result.ok ? 'sifen.document.cancelled' : 'sifen.document.cancel_failed',
      resource: 'sifen_documents',
      resourceId: updated.id,
      metadata: { cdc: doc.cdc, reason: input.reason, error: result.error ?? null },
    });

    return this.toResponse(updated);
  }

  // ---------------------------------------------------------------------------
  // QUERY
  // ---------------------------------------------------------------------------
  async list(
    tenantId: string,
    q: ListSifenDocumentsQuery,
  ): Promise<Paginated<SifenDocumentResponse>> {
    const where: Prisma.SifenDocumentWhereInput = {
      tenantId,
      ...(q.type ? { type: q.type as PrismaType } : {}),
      ...(q.status ? { status: q.status as PrismaStatus } : {}),
      ...(q.contractInvoiceId ? { contractInvoiceId: q.contractInvoiceId } : {}),
      ...(q.oneTimeChargeId ? { oneTimeChargeId: q.oneTimeChargeId } : {}),
      ...(q.cdc ? { cdc: q.cdc } : {}),
      ...(q.issuedFrom || q.issuedTo
        ? {
            issuedAt: {
              ...(q.issuedFrom ? { gte: new Date(q.issuedFrom) } : {}),
              ...(q.issuedTo ? { lte: new Date(q.issuedTo) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.sifenDocument.findMany({
        where,
        orderBy: { [q.sortBy]: q.sortDir },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.sifenDocument.count({ where }),
    ]);

    return {
      data: rows.map((r) => this.toResponse(r)),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  async findById(
    tenantId: string,
    id: string,
  ): Promise<SifenDocumentResponse> {
    const row = await this.prisma.sifenDocument.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Documento SIFEN não encontrado');
    return this.toResponse(row);
  }

  /** Retorna o XML assinado (representação KuDE/SIFEN). */
  async getSignedXml(tenantId: string, id: string): Promise<string> {
    const row = await this.prisma.sifenDocument.findFirst({
      where: { id, tenantId },
      select: { xmlSigned: true },
    });
    if (!row?.xmlSigned) {
      throw new NotFoundException('XML assinado ainda não disponível');
    }
    return row.xmlSigned;
  }

  // ---------------------------------------------------------------------------
  // Helpers privados
  // ---------------------------------------------------------------------------
  private async resolveOrigin(
    tenantId: string,
    input: EmitSifenDocumentRequest,
  ): Promise<{
    receptorTaxId: string | null;
    receptorName: string | null;
    totalAmount: number;
    currency: string;
    items: Array<{
      code: string;
      description: string;
      quantity: number;
      unitPrice: number;
      ivaRate: 0 | 5 | 10;
    }>;
  }> {
    if (input.contractInvoiceId) {
      const inv = await this.prisma.contractInvoice.findFirst({
        where: { id: input.contractInvoiceId, tenantId },
        include: {
          contract: {
            include: {
              customer: {
                select: { displayName: true, taxId: true },
              },
            },
          },
        },
      });
      if (!inv) throw new NotFoundException('ContractInvoice não encontrada');
      const amount = Number(inv.amount);
      return {
        receptorTaxId: inv.contract.customer.taxId,
        receptorName: inv.contract.customer.displayName,
        totalAmount: amount,
        currency: 'PYG', // TODO: pegar de Tenant.currency
        items: [
          {
            code: inv.contract.code ?? `CTR-${inv.contractId.slice(0, 8)}`,
            description: inv.reference ?? `Mensualidad ${inv.dueDate.toISOString().slice(0, 7)}`,
            quantity: 1,
            unitPrice: amount,
            // IVA 10% é o padrão de serviço telecom no Paraguai. Confirmar
            // com contador antes de usar em produção (pode ser 5% em alguns
            // serviços específicos).
            ivaRate: 10,
          },
        ],
      };
    }

    // OneTimeCharge
    const ch = await this.prisma.oneTimeCharge.findFirst({
      where: { id: input.oneTimeChargeId!, tenantId },
      include: {
        customer: { select: { displayName: true, taxId: true } },
      },
    });
    if (!ch) throw new NotFoundException('OneTimeCharge não encontrada');
    const amount = Number(ch.amount);
    return {
      receptorTaxId: ch.customer.taxId,
      receptorName: ch.customer.displayName,
      totalAmount: amount,
      currency: 'PYG',
      items: [
        {
          code: ch.code,
          description: ch.description ?? ch.code,
          quantity: 1,
          unitPrice: amount,
          ivaRate: 10,
        },
      ],
    };
  }

  /**
   * Próximo número sequencial pra (tenant, estab, punto). Lock no SELECT FOR
   * UPDATE garante atomicidade — sem buraco e sem duplicado entre transações
   * concorrentes (cron + UI manual).
   */
  private async nextSequence(
    tenantId: string,
    establecimiento: string,
    puntoExpedicion: string,
  ): Promise<number> {
    const last = await this.prisma.sifenDocument.findFirst({
      where: { tenantId, establecimiento, puntoExpedicion },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    });
    return (last?.numero ?? 0) + 1;
  }

  private requiredEnv(key: string): string {
    const v = this.config.get<string>(key);
    if (!v) {
      throw new BadRequestException(
        `Configuração SIFEN ausente: ${key}. Defina em /etc/netx/.env`,
      );
    }
    return v;
  }

  private toResponse(row: {
    id: string;
    tenantId: string;
    contractInvoiceId: string | null;
    oneTimeChargeId: string | null;
    type: PrismaType;
    status: PrismaStatus;
    establecimiento: string;
    puntoExpedicion: string;
    numero: number;
    cdc: string;
    emisorRuc: string;
    emisorTimbrado: string;
    receptorTaxId: string | null;
    receptorName: string | null;
    totalAmount: Prisma.Decimal;
    currency: string;
    qrUrl: string | null;
    rejectionCode: string | null;
    rejectionReason: string | null;
    issuedAt: Date;
    signedAt: Date | null;
    sentAt: Date | null;
    approvedAt: Date | null;
    rejectedAt: Date | null;
    cancelledAt: Date | null;
    retryCount: number;
    lastError: string | null;
    nextRetryAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): SifenDocumentResponse {
    return {
      id: row.id,
      tenantId: row.tenantId,
      contractInvoiceId: row.contractInvoiceId,
      oneTimeChargeId: row.oneTimeChargeId,
      type: row.type,
      status: row.status,
      establecimiento: row.establecimiento,
      puntoExpedicion: row.puntoExpedicion,
      numero: row.numero,
      numeroDocumento: formatNumeroDocumento(
        row.establecimiento,
        row.puntoExpedicion,
        row.numero,
      ),
      cdc: row.cdc,
      emisorRuc: row.emisorRuc,
      emisorTimbrado: row.emisorTimbrado,
      receptorTaxId: row.receptorTaxId,
      receptorName: row.receptorName,
      totalAmount: Number(row.totalAmount),
      currency: row.currency,
      qrUrl: row.qrUrl,
      rejectionCode: row.rejectionCode,
      rejectionReason: row.rejectionReason,
      issuedAt: row.issuedAt.toISOString(),
      signedAt: row.signedAt?.toISOString() ?? null,
      sentAt: row.sentAt?.toISOString() ?? null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      rejectedAt: row.rejectedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      retryCount: row.retryCount,
      lastError: row.lastError,
      nextRetryAt: row.nextRetryAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

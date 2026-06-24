import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  BtgChargeStatus as PrismaBtgChargeStatus,
  InvoiceStatus as PrismaInvoiceStatus,
  Prisma,
  type BtgCharge,
  type BtgChargeKind,
} from '@prisma/client';
import {
  paginationMeta,
  type BtgChargeResponse,
  type GenerateBtgChargeRequest,
  type ListBtgChargesQuery,
  type Paginated,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { BrBillingService } from '../br-billing/br-billing.service';
import { ContractInvoicesService } from '../contracts/contract-invoices.service';
import { PrismaService } from '../prisma/prisma.service';

import { BtgClientService, type PersistRefresh } from './btg-client.service';
import { BtgConfigService } from './btg-config.service';
import type { BtgResolvedConfig, BtgWebhookEvent } from './btg.types';

/** Soma `days` dias a uma data (UTC) e formata AAAA-MM-DD. */
function isoDate(date: Date, addDays = 0): string {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + addDays);
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class BtgChargesService implements OnModuleInit {
  private readonly logger = new Logger(BtgChargesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: BtgConfigService,
    private readonly client: BtgClientService,
    private readonly invoices: ContractInvoicesService,
    private readonly audit: AuditService,
    private readonly brBilling: BrBillingService,
  ) {}

  /** Registra o emissor BTG no dispatcher (evita ciclo de imports). */
  onModuleInit(): void {
    this.brBilling.register('BTG', (tenantId, actor, invoiceId) =>
      this.createForInvoice(tenantId, actor, invoiceId, {}),
    );
  }

  // ===========================================================================
  // EMISSÃO
  // ===========================================================================
  /**
   * Emite (ou reaproveita) uma cobrança boleto/Pix para a fatura. `actor` é o
   * UUID do usuário (endpoint) ou `system:*` (cron de autogeração).
   */
  async createForInvoice(
    tenantId: string,
    actor: string,
    invoiceId: string,
    input: GenerateBtgChargeRequest,
  ): Promise<BtgChargeResponse> {
    const isSystemActor = actor.includes(':');
    const invoice = await this.prisma.contractInvoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: { contract: { include: { customer: true } } },
    });
    if (!invoice) throw new NotFoundException('Fatura não encontrada');
    if (invoice.status === PrismaInvoiceStatus.PAID) {
      throw new BadRequestException('Fatura já está paga');
    }
    if (invoice.status === PrismaInvoiceStatus.CANCELLED) {
      throw new BadRequestException('Fatura cancelada não pode gerar cobrança');
    }
    const amount = Number(invoice.amount);
    if (amount <= 0) {
      throw new BadRequestException('Fatura sem valor a cobrar (use o fluxo de crédito)');
    }

    // Reaproveita cobrança ATIVA existente, salvo `force`.
    const active = await this.prisma.btgCharge.findFirst({
      where: { tenantId, invoiceId, status: PrismaBtgChargeStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
    });
    if (active && !input.force) return this.toResponse(active);
    if (active && input.force) {
      await this.prisma.btgCharge.update({
        where: { id: active.id },
        data: { status: PrismaBtgChargeStatus.CANCELED },
      });
    }

    const cfg = await this.config.resolve(tenantId);
    const persist = this.config.makePersistRefresh(tenantId);
    const kind: BtgChargeKind =
      input.kind ??
      (await this.prisma.btgConfig.findUnique({ where: { tenantId } }))?.defaultChargeKind ??
      'BOLETO';

    // Cria a linha PENDING — o id serve de correlationId/idempotência.
    const charge = await this.prisma.btgCharge.create({
      data: {
        tenantId,
        invoiceId,
        kind,
        status: PrismaBtgChargeStatus.PENDING,
        amount: new Prisma.Decimal(amount),
      },
    });

    try {
      const updated =
        kind === 'PIX'
          ? await this.emitPix(cfg, persist, charge, invoice, amount)
          : await this.emitBoleto(cfg, persist, charge, invoice, amount);

      await this.audit.log({
        tenantId,
        userId: isSystemActor ? null : actor,
        actor: isSystemActor ? actor : null,
        action: 'btg.charges.created',
        resource: 'btg_charges',
        resourceId: updated.id,
        metadata: { invoiceId, kind, amount },
      });
      return this.toResponse(updated);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.prisma.btgCharge.update({
        where: { id: charge.id },
        data: { status: PrismaBtgChargeStatus.ERROR, lastError: msg.slice(0, 2000) },
      });
      this.logger.warn(`Falha ao emitir cobrança BTG (${kind}) fatura=${invoiceId}: ${msg}`);
      throw new BadRequestException(`Falha ao emitir cobrança no BTG: ${msg}`);
    }
  }

  // ── Boleto com Pix híbrido (BANKSLIP_QRCODE) ────────────────────────────────
  private async emitBoleto(
    cfg: BtgResolvedConfig,
    persist: PersistRefresh,
    charge: BtgCharge,
    invoice: {
      dueDate: Date;
      reference: string | null;
      contract: {
        code: string | null;
        customer: {
          displayName: string;
          taxId: string | null;
          primaryPhone: string | null;
          primaryEmail: string | null;
        };
      };
    },
    amount: number,
  ): Promise<BtgCharge> {
    if (!cfg.companyId || !cfg.accountNumber || !cfg.accountBranch) {
      throw new BadRequestException('Conta BTG incompleta (companyId/agência/número)');
    }
    const customer = invoice.contract.customer;
    const doc = (customer.taxId ?? '').replace(/\D/g, '');
    if (doc.length !== 11 && doc.length !== 14) {
      throw new BadRequestException('Cliente sem CPF/CNPJ válido — exigido para emitir boleto');
    }
    const personType = doc.length === 11 ? 'F' : 'J';
    const phone = (customer.primaryPhone ?? '').replace(/\D/g, '');
    const email = customer.primaryEmail ?? undefined;
    const description = (invoice.reference ?? `Mensalidade ${invoice.contract.code ?? ''}`).slice(0, 300);

    const fine =
      cfg.finePercent != null
        ? { startDate: isoDate(invoice.dueDate, 1), type: 'PERCENTAGE', value: cfg.finePercent }
        : undefined;
    const interest =
      cfg.interestPercent != null
        ? {
            startDate: isoDate(invoice.dueDate, 1),
            type: 'PERCENTAGE_PER_MONTH',
            value: cfg.interestPercent,
          }
        : undefined;

    const payload = {
      type: 'BANKSLIP_QRCODE',
      amount: Number(amount.toFixed(2)),
      dueDate: isoDate(invoice.dueDate),
      overDueDate: isoDate(invoice.dueDate, cfg.expirationDays),
      account: { number: cfg.accountNumber, branch: cfg.accountBranch },
      payer: {
        name: customer.displayName.slice(0, 255),
        taxId: doc,
        personType,
        ...(email ? { email } : {}),
        ...(phone ? { phoneNumber: phone } : {}),
      },
      detail: {
        // correlationId = nosso id → casa o webhook com a charge.
        documentNumber: charge.id.replace(/-/g, '').slice(0, 15),
        correlationId: charge.id.slice(0, 20),
        ...(cfg.pixKey ? { pixKey: cfg.pixKey } : {}),
      },
      description,
      ...(fine ? { fine } : {}),
      ...(interest ? { interest } : {}),
    };

    const res = await this.client.createCollection(cfg, persist, payload);
    const detail = res.detail ?? {};
    const expiresAt = res.overDueDate
      ? new Date(`${res.overDueDate}T23:59:59.000Z`)
      : new Date(`${isoDate(invoice.dueDate, cfg.expirationDays)}T23:59:59.000Z`);
    return this.prisma.btgCharge.update({
      where: { id: charge.id },
      data: {
        status: PrismaBtgChargeStatus.ACTIVE,
        btgChargeId: res.collectionId ?? null,
        barcode: detail.barCode ?? null,
        digitableLine: detail.digitableLine ?? null,
        pixEmv: detail.emv ?? null,
        txid: detail.txId ?? null,
        expiresAt,
        lastError: null,
        lastPayload: res as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // ── Pix imediato (pix-cash-in) ──────────────────────────────────────────────
  private async emitPix(
    cfg: BtgResolvedConfig,
    persist: PersistRefresh,
    charge: BtgCharge,
    invoice: { reference: string | null; contract: { code: string | null } },
    amount: number,
  ): Promise<BtgCharge> {
    if (!cfg.pixKey) {
      throw new BadRequestException('Chave Pix recebedora não configurada no BTG');
    }
    const txid = randomBytes(16).toString('hex'); // 32 chars (BACEN 26..35)
    const payload = {
      pixKey: cfg.pixKey,
      amount: { original: Number(amount.toFixed(2)), allowCustomerChangeValue: false },
      expiresIn: cfg.expirationDays * 86_400,
      displayText: (invoice.reference ?? `Fatura ${invoice.contract.code ?? ''}`).slice(0, 140),
      txId: txid,
    };
    const res = await this.client.createPixInstant(cfg, persist, payload);
    const expiresAt = new Date(Date.now() + cfg.expirationDays * 86_400_000);
    return this.prisma.btgCharge.update({
      where: { id: charge.id },
      data: {
        status: PrismaBtgChargeStatus.ACTIVE,
        btgChargeId: res.id ?? null,
        txid: res.txId ?? txid,
        pixEmv: res.emv ?? null,
        paymentLink: res.location?.url ?? null,
        expiresAt,
        lastError: null,
        lastPayload: res as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // ===========================================================================
  // WEBHOOK (chamado pelo controller após validar o Bearer secret)
  // ===========================================================================
  /**
   * Processa um evento do BTG. Casa o recurso (collectionId/txId) com uma
   * BtgCharge, RECONSULTA o status na API (fonte da verdade) e dá baixa se pago.
   * Sempre devolve ok=true — erros são logados, não propagados (evita retry).
   */
  async handleWebhook(tenantId: string, event: BtgWebhookEvent): Promise<{ ok: boolean }> {
    const data = event.data ?? {};
    const ids = [data.collectionId, data.id, data.txId, data.txid]
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (ids.length === 0) return { ok: true };

    const charge = await this.prisma.btgCharge.findFirst({
      where: {
        tenantId,
        OR: [{ btgChargeId: { in: ids } }, { txid: { in: ids } }],
      },
    });
    if (!charge) return { ok: true }; // pode ser evento de recorrência → outro handler
    if (charge.status === PrismaBtgChargeStatus.PAID) return { ok: true };

    try {
      const cfg = await this.config.resolve(tenantId);
      const persist = this.config.makePersistRefresh(tenantId);
      if (charge.kind === 'PIX' && charge.btgChargeId) {
        const pix = await this.client.getPixInstant(cfg, persist, charge.btgChargeId);
        if ((pix.status ?? '').toUpperCase() === 'PAID' || (pix.status ?? '').toUpperCase() === 'CONCLUIDA') {
          await this.markChargePaid(charge, Number(charge.amount), new Date(), 'PIX', pix.txId ?? null);
        }
      } else if (charge.btgChargeId) {
        const col = await this.client.getCollection(cfg, persist, charge.btgChargeId);
        if (col.status === 'PAID') {
          const paid = col.paidAmount != null ? Number(col.paidAmount) : Number(charge.amount);
          const paidAt = col.settledAt ? new Date(col.settledAt) : new Date();
          const via = col.detail?.emv ? 'PIX' : 'BOLETO';
          await this.markChargePaid(charge, paid, paidAt, via, col.detail?.txId ?? null);
        }
      }
    } catch (e) {
      this.logger.warn(`Falha ao reconciliar webhook BTG (charge=${charge.id}): ${String(e)}`);
    }
    return { ok: true };
  }

  /** Marca a cobrança paga e dá baixa na fatura (idempotente). */
  private async markChargePaid(
    charge: BtgCharge,
    paidAmount: number,
    paidAt: Date,
    paidVia: 'PIX' | 'BOLETO',
    endToEndId: string | null,
  ): Promise<void> {
    if (charge.status === PrismaBtgChargeStatus.PAID) return;
    await this.prisma.btgCharge.update({
      where: { id: charge.id },
      data: {
        status: PrismaBtgChargeStatus.PAID,
        paidAt,
        paidAmount: new Prisma.Decimal(paidAmount),
        endToEndId,
      },
    });
    await this.invoices.registerGatewayPayment(charge.tenantId, charge.invoiceId, {
      paidAmount,
      paidAt,
      paidVia,
      gatewayRef: endToEndId ?? charge.btgChargeId ?? charge.txid ?? charge.id,
    });
    this.logger.log(`BTG baixa: charge=${charge.id} fatura=${charge.invoiceId} via=${paidVia}`);
  }

  // ===========================================================================
  // LEITURA
  // ===========================================================================
  async list(tenantId: string, q: ListBtgChargesQuery): Promise<Paginated<BtgChargeResponse>> {
    const where = {
      tenantId,
      ...(q.invoiceId && { invoiceId: q.invoiceId }),
      ...(q.status && { status: q.status as PrismaBtgChargeStatus }),
      ...(q.kind && { kind: q.kind as BtgChargeKind }),
    };
    const skip = (q.page - 1) * q.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.btgCharge.findMany({
        where,
        orderBy: { [q.sortBy]: q.sortDir },
        skip,
        take: q.pageSize,
      }),
      this.prisma.btgCharge.count({ where }),
    ]);
    return {
      data: rows.map((r) => this.toResponse(r)),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  async getForInvoice(tenantId: string, invoiceId: string): Promise<BtgChargeResponse | null> {
    const row = await this.prisma.btgCharge.findFirst({
      where: { tenantId, invoiceId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    return row ? this.toResponse(row) : null;
  }

  /** Baixa o PDF do boleto sob demanda (proxy autenticado). */
  async getPdf(tenantId: string, chargeId: string): Promise<Buffer> {
    const charge = await this.prisma.btgCharge.findFirst({ where: { id: chargeId, tenantId } });
    if (!charge || !charge.btgChargeId) throw new NotFoundException('Boleto não encontrado');
    const cfg = await this.config.resolve(tenantId);
    return this.client.getCollectionPdf(cfg, this.config.makePersistRefresh(tenantId), charge.btgChargeId);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================
  private toResponse(c: BtgCharge): BtgChargeResponse {
    return {
      id: c.id,
      tenantId: c.tenantId,
      invoiceId: c.invoiceId,
      kind: c.kind,
      status: c.status,
      amount: Number(c.amount),
      txid: c.txid,
      btgChargeId: c.btgChargeId,
      pixEmv: c.pixEmv,
      pixQrImage: c.pixQrImage,
      barcode: c.barcode,
      digitableLine: c.digitableLine,
      pdfUrl: c.pdfUrl,
      paymentLink: c.paymentLink,
      expiresAt: c.expiresAt?.toISOString() ?? null,
      paidAt: c.paidAt?.toISOString() ?? null,
      paidAmount: c.paidAmount != null ? Number(c.paidAmount) : null,
      lastError: c.lastError,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }
}

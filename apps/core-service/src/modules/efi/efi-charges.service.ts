import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  EfiChargeStatus as PrismaEfiChargeStatus,
  InvoiceStatus as PrismaInvoiceStatus,
  Prisma,
  type EfiCharge,
  type EfiChargeKind,
} from '@prisma/client';
import {
  paginationMeta,
  type EfiChargeResponse,
  type GenerateEfiChargeRequest,
  type ListEfiChargesQuery,
  type Paginated,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { BrBillingService } from '../br-billing/br-billing.service';
import { ContractInvoicesService } from '../contracts/contract-invoices.service';
import { PrismaService } from '../prisma/prisma.service';

import { EfiClientService } from './efi-client.service';
import { EfiConfigService } from './efi-config.service';
import type { EfiNotificationResponse, EfiResolvedConfig } from './efi.types';

@Injectable()
export class EfiChargesService implements OnModuleInit {
  private readonly logger = new Logger(EfiChargesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: EfiConfigService,
    private readonly client: EfiClientService,
    private readonly invoices: ContractInvoicesService,
    private readonly audit: AuditService,
    private readonly brBilling: BrBillingService,
  ) {}

  /** Registra o emissor EFI no dispatcher (evita ciclo de imports). */
  onModuleInit(): void {
    this.brBilling.register('EFI', (tenantId, actor, invoiceId) =>
      this.createForInvoice(tenantId, actor, invoiceId, {}),
    );
  }

  // ===========================================================================
  // EMISSÃO
  // ===========================================================================
  /**
   * Emite (ou reaproveita) uma cobrança Pix/Bolix para a fatura.
   * `actor` é o UUID do usuário quando veio de um endpoint, ou uma string
   * `system:*` quando veio do cron de autogeração — separamos em userId
   * (UUID) vs actor (texto livre) pra não quebrar a FK do audit_log.
   */
  async createForInvoice(
    tenantId: string,
    actor: string,
    invoiceId: string,
    input: GenerateEfiChargeRequest,
  ): Promise<EfiChargeResponse> {
    const isSystemActor = actor.includes(':');
    const invoice = await this.prisma.contractInvoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: {
        contract: { include: { customer: true } },
      },
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
    const active = await this.prisma.efiCharge.findFirst({
      where: { tenantId, invoiceId, status: PrismaEfiChargeStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
    });
    if (active && !input.force) return this.toResponse(active);
    if (active && input.force) {
      await this.prisma.efiCharge.update({
        where: { id: active.id },
        data: { status: PrismaEfiChargeStatus.CANCELED },
      });
    }

    const cfg = await this.config.resolve(tenantId);
    const kind: EfiChargeKind =
      input.kind ??
      (await this.prisma.efiConfig.findUnique({ where: { tenantId } }))?.defaultChargeKind ??
      'BOLIX';

    // Cria a linha PENDING primeiro — o id serve de custom_id no boleto.
    const charge = await this.prisma.efiCharge.create({
      data: {
        tenantId,
        invoiceId,
        kind,
        status: PrismaEfiChargeStatus.PENDING,
        amount: new Prisma.Decimal(amount),
      },
    });

    try {
      const updated =
        kind === 'PIX'
          ? await this.emitPix(cfg, charge, invoice, amount)
          : await this.emitBolix(tenantId, cfg, charge, invoice, amount);

      await this.audit.log({
        tenantId,
        userId: isSystemActor ? null : actor,
        actor: isSystemActor ? actor : null,
        action: 'efi.charges.created',
        resource: 'efi_charges',
        resourceId: updated.id,
        metadata: { invoiceId, kind, amount },
      });
      return this.toResponse(updated);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.prisma.efiCharge.update({
        where: { id: charge.id },
        data: { status: PrismaEfiChargeStatus.ERROR, lastError: msg.slice(0, 2000) },
      });
      this.logger.warn(`Falha ao emitir cobrança EFI (${kind}) fatura=${invoiceId}: ${msg}`);
      throw new BadRequestException(`Falha ao emitir cobrança no EFI: ${msg}`);
    }
  }

  // ── Pix imediato ───────────────────────────────────────────────────────────
  private async emitPix(
    cfg: EfiResolvedConfig,
    charge: EfiCharge,
    invoice: { reference: string | null; contract: { code: string | null } },
    amount: number,
  ): Promise<EfiCharge> {
    if (!cfg.pixKey) {
      throw new BadRequestException('Chave Pix recebedora não configurada no EFI');
    }
    // txid BACEN: ^[a-zA-Z0-9]{26,35}$ — 32 chars hex satisfaz.
    const txid = randomBytes(16).toString('hex');
    const payload = {
      calendario: { expiracao: cfg.expirationDays * 86_400 },
      valor: { original: amount.toFixed(2) },
      chave: cfg.pixKey,
      solicitacaoPagador: (invoice.reference ?? `Fatura ${invoice.contract.code ?? ''}`).slice(0, 140),
    };
    const cob = await this.client.createPixCob(cfg, txid, payload);
    const locId = cob.loc?.id;
    let pixCopiaECola = cob.pixCopiaECola ?? null;
    let pixQrImage: string | null = null;
    if (locId != null) {
      const qr = await this.client.getPixQrCode(cfg, locId);
      pixCopiaECola = qr.qrcode ?? pixCopiaECola;
      pixQrImage = qr.imagemQrcode ?? null;
    }
    const expiresAt = new Date(Date.now() + cfg.expirationDays * 86_400_000);
    return this.prisma.efiCharge.update({
      where: { id: charge.id },
      data: {
        status: PrismaEfiChargeStatus.ACTIVE,
        txid: cob.txid ?? txid,
        locId: locId != null ? String(locId) : null,
        pixCopiaECola,
        pixQrImage,
        expiresAt,
        lastError: null,
        lastPayload: cob as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // ── Boleto híbrido com Pix (Bolix) ──────────────────────────────────────────
  private async emitBolix(
    tenantId: string,
    cfg: EfiResolvedConfig,
    charge: EfiCharge,
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
  ): Promise<EfiCharge> {
    const customer = invoice.contract.customer;
    const doc = (customer.taxId ?? '').replace(/\D/g, '');
    if (doc.length !== 11 && doc.length !== 14) {
      throw new BadRequestException('Cliente sem CPF/CNPJ válido — exigido para emitir boleto');
    }
    const phone = (customer.primaryPhone ?? '').replace(/\D/g, '');
    const email = customer.primaryEmail ?? undefined;

    const cfgRow = await this.prisma.efiConfig.findUnique({ where: { tenantId } });
    const notificationUrl = this.boletoNotificationUrl(cfgRow?.webhookToken ?? null);

    const configurations: Record<string, number> = {};
    if (cfg.finePercent != null) configurations.fine = Math.round(cfg.finePercent * 100);
    if (cfg.interestPercent != null) configurations.interest = Math.round(cfg.interestPercent * 100);

    const payload = {
      items: [
        {
          name: (invoice.reference ?? `Mensalidade ${invoice.contract.code ?? ''}`).slice(0, 255),
          value: Math.round(amount * 100), // centavos
          amount: 1,
        },
      ],
      payment: {
        banking_billet: {
          expire_at: invoice.dueDate.toISOString().slice(0, 10),
          customer: {
            name: customer.displayName.slice(0, 255),
            ...(doc.length === 11 ? { cpf: doc } : { cnpj: doc }),
            ...(phone ? { phone_number: phone } : {}),
            ...(email ? { email } : {}),
          },
          ...(Object.keys(configurations).length ? { configurations } : {}),
          message: (invoice.reference ?? '').slice(0, 80) || undefined,
        },
      },
      metadata: {
        custom_id: charge.id,
        ...(notificationUrl ? { notification_url: notificationUrl } : {}),
      },
    };

    const res = await this.client.createBoletoOneStep(cfg, payload);
    const data = res.data ?? {};
    const expiresAt = data.expire_at ? new Date(`${data.expire_at}T23:59:59.000Z`) : invoice.dueDate;
    return this.prisma.efiCharge.update({
      where: { id: charge.id },
      data: {
        status: PrismaEfiChargeStatus.ACTIVE,
        efiChargeId: data.charge_id != null ? String(data.charge_id) : null,
        barcode: data.barcode ?? null,
        paymentLink: data.link ?? null,
        pdfUrl: data.pdf?.charge ?? null,
        pixCopiaECola: data.pix?.qrcode ?? null,
        pixQrImage: data.pix?.qrcode_image ?? null,
        expiresAt,
        lastError: null,
        lastPayload: res as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // ===========================================================================
  // WEBHOOKS
  // ===========================================================================
  /** Webhook Pix (EFI POSTa { pix: [{ txid, valor, endToEndId, horario }] }). */
  async handlePixWebhook(token: string, body: unknown): Promise<{ ok: boolean }> {
    const cfg = await this.config.findByWebhookToken(token);
    if (!cfg) {
      this.logger.warn('Webhook Pix com token desconhecido — ignorado');
      return { ok: true }; // 200 pra não gerar retentativa infinita
    }
    const items = Array.isArray((body as { pix?: unknown[] })?.pix)
      ? (body as { pix: Array<Record<string, unknown>> }).pix
      : [];
    for (const item of items) {
      const txid = typeof item.txid === 'string' ? item.txid : null;
      if (!txid) continue;
      const charge = await this.prisma.efiCharge.findFirst({
        where: { tenantId: cfg.tenantId, txid },
      });
      if (!charge) continue;
      const valor = typeof item.valor === 'string' ? Number(item.valor) : Number(charge.amount);
      const e2e = typeof item.endToEndId === 'string' ? item.endToEndId : null;
      await this.markChargePaid(charge, valor, new Date(), 'PIX', e2e);
    }
    return { ok: true };
  }

  /** Webhook de Cobranças (EFI POSTa { notification: <token>, ... }). */
  async handleBoletoNotification(token: string, body: unknown): Promise<{ ok: boolean }> {
    const cfg = await this.config.findByWebhookToken(token);
    if (!cfg) {
      this.logger.warn('Notificação de boleto com token desconhecido — ignorada');
      return { ok: true };
    }
    const notificationToken = (body as { notification?: string })?.notification;
    if (!notificationToken) return { ok: true };

    const resolved = await this.config.resolve(cfg.tenantId);
    let detail: EfiNotificationResponse;
    try {
      detail = await this.client.getNotification(resolved, notificationToken);
    } catch (e) {
      this.logger.warn(`Falha ao consultar notificação EFI: ${String(e)}`);
      return { ok: true };
    }
    const events = detail.data ?? [];
    // Último evento da notificação tem o status corrente.
    const last = events[events.length - 1];
    if (!last) return { ok: true };
    const status = (last.status?.current ?? '').toLowerCase();
    if (status !== 'paid' && status !== 'settled') return { ok: true };

    const customId = last.custom_id ?? null;
    const chargeId = last.identifiers?.charge_id != null ? String(last.identifiers.charge_id) : null;
    const charge = await this.prisma.efiCharge.findFirst({
      where: {
        tenantId: cfg.tenantId,
        OR: [
          ...(customId ? [{ id: customId }] : []),
          ...(chargeId ? [{ efiChargeId: chargeId }] : []),
        ],
      },
    });
    if (!charge) {
      this.logger.warn(`Notificação de boleto paga sem EfiCharge correspondente (custom_id=${customId})`);
      return { ok: true };
    }
    const valor = last.value != null ? last.value / 100 : Number(charge.amount);
    await this.markChargePaid(charge, valor, new Date(), 'BOLETO', null);
    return { ok: true };
  }

  /** Marca a cobrança paga e dá baixa na fatura (idempotente). */
  private async markChargePaid(
    charge: EfiCharge,
    paidAmount: number,
    paidAt: Date,
    paidVia: 'PIX' | 'BOLETO',
    endToEndId: string | null,
  ): Promise<void> {
    if (charge.status === PrismaEfiChargeStatus.PAID) return; // idempotência (webhooks repetem)
    await this.prisma.efiCharge.update({
      where: { id: charge.id },
      data: {
        status: PrismaEfiChargeStatus.PAID,
        paidAt,
        paidAmount: new Prisma.Decimal(paidAmount),
        endToEndId,
      },
    });
    await this.invoices.registerGatewayPayment(charge.tenantId, charge.invoiceId, {
      paidAmount,
      paidAt,
      paidVia,
      gatewayRef: endToEndId ?? charge.efiChargeId ?? charge.txid ?? charge.id,
    });
    this.logger.log(`EFI baixa: charge=${charge.id} fatura=${charge.invoiceId} via=${paidVia}`);
  }

  // ===========================================================================
  // LEITURA
  // ===========================================================================
  async list(tenantId: string, q: ListEfiChargesQuery): Promise<Paginated<EfiChargeResponse>> {
    const where = {
      tenantId,
      ...(q.invoiceId && { invoiceId: q.invoiceId }),
      ...(q.status && { status: q.status as PrismaEfiChargeStatus }),
      ...(q.kind && { kind: q.kind as EfiChargeKind }),
    };
    const skip = (q.page - 1) * q.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.efiCharge.findMany({
        where,
        orderBy: { [q.sortBy]: q.sortDir },
        skip,
        take: q.pageSize,
      }),
      this.prisma.efiCharge.count({ where }),
    ]);
    return {
      data: rows.map((r) => this.toResponse(r)),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  async getForInvoice(tenantId: string, invoiceId: string): Promise<EfiChargeResponse | null> {
    const row = await this.prisma.efiCharge.findFirst({
      where: { tenantId, invoiceId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    return row ? this.toResponse(row) : null;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================
  private boletoNotificationUrl(token: string | null): string | null {
    if (!token) return null;
    const base = (process.env.EFI_PUBLIC_WEBHOOK_BASE ?? '').replace(/\/+$/, '');
    const path = `/efi/webhook/boleto/${token}`;
    return base ? `${base}${path}` : null; // sem base pública não dá pra notificar
  }

  private toResponse(c: EfiCharge): EfiChargeResponse {
    return {
      id: c.id,
      tenantId: c.tenantId,
      invoiceId: c.invoiceId,
      kind: c.kind,
      status: c.status,
      amount: Number(c.amount),
      txid: c.txid,
      efiChargeId: c.efiChargeId,
      pixCopiaECola: c.pixCopiaECola,
      pixQrImage: c.pixQrImage,
      barcode: c.barcode,
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

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InvoiceStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { WhatsappConversationsService } from './whatsapp-conversations.service';

/** Canais de disparo. Só WHATSAPP_META dispara hoje; os demais ficam prontos
 *  pra migração (sistema multicanal em breve). */
export const BILLING_CHANNELS = ['WHATSAPP_META', 'WHATSAPP_WAHA', 'SMS', 'EMAIL'] as const;
export type BillingChannel = (typeof BILLING_CHANNELS)[number];
const SUPPORTED_CHANNELS: BillingChannel[] = ['WHATSAPP_META'];

export interface BillingRuleInput {
  enabled?: boolean;
  label?: string | null;
  /** <0 = dias ANTES do vencimento | 0 = no dia | >0 = dias DEPOIS. */
  offsetDays: number;
  channel: string;
  templateName: string;
  language?: string;
  instanceId?: string | null;
  sortOrder?: number;
}

/**
 * Régua de cobrança configurável por tenant (múltiplos disparos + canal).
 *
 * Um cron diário (09:00) percorre os tenants com config ligada e, pra cada
 * REGRA habilitada, dispara o template no dia certo relativo ao vencimento.
 * Cada regra dispara UMA vez por fatura (dedup em BillingReminderLog).
 *
 * Config/regras moram no banco (telas em Configurações → Cobrança). Duas env
 * globais permanecem como rede de segurança:
 *   WHATSAPP_BILLING_ENABLED=false      kill-switch global (desliga tudo)
 *   WHATSAPP_BILLING_TEST_RECIPIENT     redireciona TODO envio (override global)
 */
@Injectable()
export class WhatsappBillingRemindersService {
  private readonly logger = new Logger(WhatsappBillingRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: WhatsappConversationsService,
  ) {}

  // ----- configuração (telas) -----

  /** Config-mestre + régua de regras do tenant. */
  async getConfig(tenantId: string) {
    const [config, rules] = await Promise.all([
      this.prisma.billingReminderConfig.findUnique({ where: { tenantId } }),
      this.prisma.billingReminderRule.findMany({
        where: { tenantId },
        orderBy: [{ sortOrder: 'asc' }, { offsetDays: 'asc' }],
      }),
    ]);
    return {
      config: {
        enabled: config?.enabled ?? false,
        testRecipient: config?.testRecipient ?? null,
      },
      rules,
      channels: BILLING_CHANNELS,
      supportedChannels: SUPPORTED_CHANNELS,
    };
  }

  async setConfig(tenantId: string, input: { enabled?: boolean; testRecipient?: string | null }) {
    const data = {
      enabled: input.enabled,
      testRecipient: input.testRecipient !== undefined ? input.testRecipient?.trim() || null : undefined,
    };
    await this.prisma.billingReminderConfig.upsert({
      where: { tenantId },
      create: { tenantId, enabled: data.enabled ?? false, testRecipient: data.testRecipient ?? null },
      update: data,
    });
    return this.getConfig(tenantId);
  }

  async createRule(tenantId: string, input: BillingRuleInput) {
    this.validateRule(input);
    await this.prisma.billingReminderRule.create({
      data: {
        tenantId,
        enabled: input.enabled ?? true,
        label: input.label?.trim() || null,
        offsetDays: input.offsetDays,
        channel: input.channel,
        templateName: input.templateName.trim(),
        language: input.language?.trim() || 'pt_BR',
        instanceId: input.instanceId ?? null,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    return this.getConfig(tenantId);
  }

  async updateRule(tenantId: string, id: string, input: Partial<BillingRuleInput>) {
    const existing = await this.prisma.billingReminderRule.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Regra não encontrada');
    if (input.channel !== undefined || input.offsetDays !== undefined || input.templateName !== undefined) {
      this.validateRule({
        offsetDays: input.offsetDays ?? existing.offsetDays,
        channel: input.channel ?? existing.channel,
        templateName: input.templateName ?? existing.templateName,
      });
    }
    await this.prisma.billingReminderRule.update({
      where: { id },
      data: {
        enabled: input.enabled,
        label: input.label !== undefined ? input.label?.trim() || null : undefined,
        offsetDays: input.offsetDays,
        channel: input.channel,
        templateName: input.templateName?.trim(),
        language: input.language?.trim(),
        instanceId: input.instanceId !== undefined ? input.instanceId : undefined,
        sortOrder: input.sortOrder,
      },
    });
    return this.getConfig(tenantId);
  }

  async deleteRule(tenantId: string, id: string) {
    const existing = await this.prisma.billingReminderRule.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Regra não encontrada');
    await this.prisma.billingReminderRule.delete({ where: { id } });
    return this.getConfig(tenantId);
  }

  private validateRule(input: { offsetDays: number; channel: string; templateName: string }) {
    if (!Number.isInteger(input.offsetDays) || input.offsetDays < -60 || input.offsetDays > 60) {
      throw new BadRequestException('offsetDays deve ser um inteiro entre -60 e 60.');
    }
    if (!(BILLING_CHANNELS as readonly string[]).includes(input.channel)) {
      throw new BadRequestException(`Canal inválido. Use um de: ${BILLING_CHANNELS.join(', ')}.`);
    }
    if (!input.templateName?.trim()) {
      throw new BadRequestException('Template obrigatório.');
    }
  }

  // ----- disparo (cron + manual) -----

  /** Cron diário às 09:00. Percorre as configs ligadas (por tenant). */
  @Cron('0 9 * * *')
  async handleDaily(): Promise<void> {
    await this.runOnce();
  }

  /**
   * Executa a régua uma vez. `dryRun` só loga; `date` simula outra data-base.
   * Retorna um resumo agregado.
   */
  async runOnce(opts: { dryRun?: boolean; date?: Date } = {}): Promise<{
    tenants: number;
    rules: number;
    due: number;
    sent: number;
    skipped: number;
    failed: number;
    testRedirect: string | null;
    dryRun: boolean;
  }> {
    const dryRun = opts.dryRun ?? false;
    const envTestRecipient = (process.env.WHATSAPP_BILLING_TEST_RECIPIENT ?? '').trim() || null;
    const res = { tenants: 0, rules: 0, due: 0, sent: 0, skipped: 0, failed: 0, testRedirect: envTestRecipient, dryRun };

    // Kill-switch global (rede de segurança de deploy).
    if (process.env.WHATSAPP_BILLING_ENABLED === 'false') {
      this.logger.log('Disparo de cobrança desligado pelo kill-switch (WHATSAPP_BILLING_ENABLED=false).');
      return res;
    }

    const configs = await this.prisma.billingReminderConfig.findMany({ where: { enabled: true } });
    for (const cfg of configs) {
      const rules = await this.prisma.billingReminderRule.findMany({
        where: { tenantId: cfg.tenantId, enabled: true },
        orderBy: { sortOrder: 'asc' },
      });
      if (!rules.length) continue;
      res.tenants++;
      // Modo teste: env (override global) tem prioridade sobre o do tenant.
      const testRecipient = envTestRecipient ?? cfg.testRecipient ?? null;

      for (const rule of rules) {
        res.rules++;
        if (!SUPPORTED_CHANNELS.includes(rule.channel as BillingChannel)) {
          this.logger.log(`Regra ${rule.id}: canal ${rule.channel} ainda não suportado — pulando.`);
          continue;
        }

        // Data-alvo de vencimento = hoje deslocado por -offsetDays. Ex.: regra
        // "3 dias antes" (offset -3) casa faturas que vencem em hoje+3.
        const base = opts.date ? new Date(opts.date) : new Date();
        const start = new Date(base);
        start.setDate(start.getDate() - rule.offsetDays);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);

        const invoices = await this.prisma.contractInvoice.findMany({
          where: {
            tenantId: cfg.tenantId,
            status: { in: [InvoiceStatus.OPEN, InvoiceStatus.OVERDUE] },
            dueDate: { gte: start, lt: end },
          },
          include: {
            contract: { include: { customer: { select: { displayName: true, primaryPhone: true } } } },
          },
        });
        res.due += invoices.length;

        for (const inv of invoices) {
          // Dedup: essa regra já disparou (com sucesso) pra essa fatura?
          const prior = await this.prisma.billingReminderLog.findUnique({
            where: { ruleId_invoiceId: { ruleId: rule.id, invoiceId: inv.id } },
          });
          if (prior?.status === 'SENT') {
            res.skipped++;
            continue;
          }

          const customer = inv.contract?.customer;
          const realPhone = customer?.primaryPhone ?? null;
          const name = customer?.displayName ?? 'cliente';
          const phone = testRecipient ?? realPhone;

          if (!phone) {
            res.skipped++;
            this.logger.warn(`Fatura ${inv.id}: cliente sem telefone — pulando.`);
            continue;
          }
          if (dryRun) {
            this.logger.log(`[dry-run] regra ${rule.label ?? rule.offsetDays} → ${phone} (${name})`);
            res.sent++;
            continue;
          }

          try {
            await this.conversations.sendTemplateToPhone(cfg.tenantId, {
              phoneE164: phone,
              templateName: rule.templateName,
              language: rule.language,
              variables: [name],
              name,
              instanceId: rule.instanceId ?? undefined,
              actor: 'system:billing',
              previewBody: `[cobrança] fatura ${inv.reference ?? inv.id} vence ${start.toISOString().slice(0, 10)}`,
            });
            res.sent++;
            await this.markLog(cfg.tenantId, rule.id, inv.id, rule.channel, 'SENT', null);
          } catch (e) {
            res.failed++;
            await this.markLog(cfg.tenantId, rule.id, inv.id, rule.channel, 'FAILED', (e as Error).message);
            this.logger.warn(`Falha ao enviar cobrança ${inv.id} (regra ${rule.id}): ${(e as Error).message}`);
          }
        }
      }
    }

    this.logger.log(`Régua de cobrança concluída: ${JSON.stringify(res)}`);
    return res;
  }

  /** Upsert do log de disparo (dedup por regra+fatura). */
  private async markLog(
    tenantId: string,
    ruleId: string,
    invoiceId: string,
    channel: string,
    status: 'SENT' | 'FAILED',
    error: string | null,
  ) {
    await this.prisma.billingReminderLog.upsert({
      where: { ruleId_invoiceId: { ruleId, invoiceId } },
      create: { tenantId, ruleId, invoiceId, channel, status, error },
      update: { status, error, sentAt: new Date() },
    });
  }
}

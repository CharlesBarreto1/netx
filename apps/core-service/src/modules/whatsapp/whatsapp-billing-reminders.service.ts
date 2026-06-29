import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../prisma/prisma.service';

import { WhatsappConversationsService } from './whatsapp-conversations.service';

/**
 * Lembrete de cobrança via WhatsApp (canal oficial Meta).
 *
 * Roda 1x/dia e dispara um template HSM aprovado para os clientes com fatura
 * (`ContractInvoice`) OPEN vencendo na data-alvo (hoje + offset). Como template
 * ignora a janela de 24h, funciona mesmo sem conversa prévia.
 *
 * Config por env (todas opcionais):
 *   WHATSAPP_BILLING_ENABLED         "true" liga o cron diário (default: off)
 *   WHATSAPP_BILLING_TEST_RECIPIENT  E164 — REDIRECIONA todo envio p/ este número
 *                                    (modo teste: nada vai para clientes reais)
 *   WHATSAPP_BILLING_TEMPLATE        nome do template (default cobros_chat_5949)
 *   WHATSAPP_BILLING_LANG            idioma do template (default pt_BR)
 *   WHATSAPP_BILLING_DUE_OFFSET_DAYS dias a partir de hoje (default 0 = no vencimento)
 *
 * Segurança: enquanto WHATSAPP_BILLING_TEST_RECIPIENT estiver setado, NENHUMA
 * mensagem chega a cliente real — tudo é redirecionado para o número de teste.
 */
@Injectable()
export class WhatsappBillingRemindersService {
  private readonly logger = new Logger(WhatsappBillingRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: WhatsappConversationsService,
  ) {}

  private cfg() {
    return {
      enabled: process.env.WHATSAPP_BILLING_ENABLED === 'true',
      testRecipient: (process.env.WHATSAPP_BILLING_TEST_RECIPIENT ?? '').trim() || null,
      template: (process.env.WHATSAPP_BILLING_TEMPLATE ?? '').trim() || 'cobros_chat_5949',
      language: (process.env.WHATSAPP_BILLING_LANG ?? '').trim() || 'pt_BR',
      offsetDays: Number.parseInt(process.env.WHATSAPP_BILLING_DUE_OFFSET_DAYS ?? '0', 10) || 0,
    };
  }

  /** Cron diário às 09:00. Só age se WHATSAPP_BILLING_ENABLED=true. */
  @Cron('0 9 * * *')
  async handleDaily(): Promise<void> {
    if (!this.cfg().enabled) {
      this.logger.log('Lembrete de cobrança desativado (WHATSAPP_BILLING_ENABLED != true).');
      return;
    }
    await this.runOnce();
  }

  /**
   * Executa o disparo uma vez. `dryRun` apenas loga (não envia). `date` permite
   * simular outra data-base (testes). Retorna um resumo agregado.
   */
  async runOnce(
    opts: { dryRun?: boolean; date?: Date } = {},
  ): Promise<{
    tenants: number;
    due: number;
    sent: number;
    skipped: number;
    failed: number;
    testRedirect: string | null;
    dryRun: boolean;
  }> {
    const cfg = this.cfg();
    const dryRun = opts.dryRun ?? false;

    // Janela do dia-alvo [00:00, +1d) sobre a data de vencimento (coluna Date).
    const target = opts.date ? new Date(opts.date) : new Date();
    target.setDate(target.getDate() + cfg.offsetDays);
    const start = new Date(target);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const res = {
      tenants: 0,
      due: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      testRedirect: cfg.testRecipient,
      dryRun,
    };

    // Tenants com instância Meta ativa e conectada (uma por tenant).
    const instances = await this.prisma.whatsappInstance.findMany({
      where: { channel: 'META_CLOUD', active: true, status: 'CONNECTED' },
      select: { id: true, tenantId: true },
      orderBy: { createdAt: 'asc' },
    });
    const instanceByTenant = new Map<string, string>();
    for (const i of instances) if (!instanceByTenant.has(i.tenantId)) instanceByTenant.set(i.tenantId, i.id);
    res.tenants = instanceByTenant.size;

    for (const [tenantId, instanceId] of instanceByTenant) {
      const invoices = await this.prisma.contractInvoice.findMany({
        where: { tenantId, status: 'OPEN', dueDate: { gte: start, lt: end } },
        include: {
          contract: { include: { customer: { select: { displayName: true, primaryPhone: true } } } },
        },
      });
      res.due += invoices.length;

      for (const inv of invoices) {
        const customer = inv.contract?.customer;
        const realPhone = customer?.primaryPhone ?? null;
        const name = customer?.displayName ?? 'cliente';
        // Modo teste: redireciona p/ o número de teste; senão usa o do cliente.
        const phone = cfg.testRecipient ?? realPhone;

        if (!phone) {
          res.skipped++;
          this.logger.warn(`Fatura ${inv.id}: cliente sem telefone — pulando.`);
          continue;
        }
        if (dryRun) {
          this.logger.log(`[dry-run] cobrança ${inv.reference ?? inv.id} → ${phone} (${name})`);
          res.sent++;
          continue;
        }
        try {
          await this.conversations.sendTemplateToPhone(tenantId, {
            phoneE164: phone,
            templateName: cfg.template,
            language: cfg.language,
            variables: [name],
            name,
            instanceId,
            actor: 'system:billing',
            previewBody: `[cobrança] fatura ${inv.reference ?? inv.id} vence ${start
              .toISOString()
              .slice(0, 10)}`,
          });
          res.sent++;
          if (cfg.testRecipient) {
            this.logger.log(`Cobrança ${inv.id} (cliente real ${realPhone ?? '∅'}) redirecionada p/ teste ${phone}.`);
          }
        } catch (e) {
          res.failed++;
          this.logger.warn(`Falha ao enviar cobrança ${inv.id}: ${(e as Error).message}`);
        }
      }
    }

    this.logger.log(`Lembrete de cobrança concluído: ${JSON.stringify(res)}`);
    return res;
  }
}

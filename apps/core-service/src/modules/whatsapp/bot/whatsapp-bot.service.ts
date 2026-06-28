import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AiService } from '../../ai/ai.service';
import { AuditService } from '../../audit/audit.service';
import { BtgChargesService } from '../../btg/btg-charges.service';
import { ContractsService } from '../../contracts/contracts.service';
import { EfiChargesService } from '../../efi/efi-charges.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RadacctService } from '../../radius/radacct.service';
import { ServiceOrdersService } from '../../service-orders/service-orders.service';
import { WhatsappConversationsService } from '../whatsapp-conversations.service';
import { WhatsappEventsBus } from '../whatsapp-events.bus';

import {
  BOT_TOOLS,
  buildBotExecutor,
  connectionStatus,
  generateSegundaVia,
  listOpenInvoices,
  openTicket,
  trustUnblock,
  type BotActionCtx,
  type BotActionDeps,
} from './bot-tools';

// ---- tipos de config ----

export type BotMenuAction = 'tool' | 'reply' | 'handoff' | 'ai';
export interface BotMenuOption {
  key: string; // o que o cliente digita (ex.: "1")
  label: string;
  action: BotMenuAction;
  tool?: string; // quando action = tool
  reply?: string; // quando action = reply
}
export interface BotConfigDto {
  enabled: boolean;
  aiEnabled: boolean;
  greeting: string;
  fallbackText: string;
  handoffText: string;
  unknownText: string;
  options: BotMenuOption[];
}

const DEFAULTS: BotConfigDto = {
  enabled: false,
  aiEnabled: false,
  greeting: 'Olá! 👋 Sou o assistente virtual. Como posso ajudar você hoje?',
  fallbackText: 'Não entendi 🤔. Responda com o número de uma opção ou digite *menu*.',
  handoffText: 'Certo! Já estou te encaminhando para um de nossos atendentes. 👤',
  unknownText:
    'Não localizei seu cadastro por este número. Vou te transferir para um atendente. 👤',
  options: [
    { key: '1', label: '2ª via / Pix do boleto', action: 'tool', tool: 'segunda_via' },
    { key: '2', label: 'Status da minha conexão', action: 'tool', tool: 'status_conexao' },
    { key: '3', label: 'Desbloqueio de confiança', action: 'tool', tool: 'desbloqueio_confianca' },
    { key: '4', label: 'Abrir um chamado', action: 'tool', tool: 'abrir_chamado' },
    { key: '5', label: 'Falar com um atendente', action: 'handoff' },
  ],
};

const HANDOFF_WORDS = ['atendente', 'humano', 'pessoa', 'falar com alguem', 'falar com alguém'];
const MENU_WORDS = ['menu', 'voltar', 'inicio', 'início', 'oi', 'ola', 'olá'];

const BOT_SYSTEM = [
  'Você é o assistente virtual de um provedor de internet, atendendo o cliente no WhatsApp.',
  'Use SEMPRE as ferramentas para agir (2ª via, status, desbloqueio, chamado) — nunca invente dados.',
  'Responda em português do Brasil, cordial e BREVE (no máximo 3 frases — é WhatsApp).',
  'Se o cliente pedir algo fora do seu alcance ou quiser falar com humano, use falar_com_atendente.',
  'Ao gerar Pix, mostre o código copia-e-cola exatamente como veio da ferramenta.',
].join(' ');

interface BotContext {
  node?: 'menu' | 'ai' | 'await_ticket';
}

@Injectable()
export class WhatsappBotService {
  private readonly logger = new Logger(WhatsappBotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: WhatsappConversationsService,
    private readonly events: WhatsappEventsBus,
    private readonly ai: AiService,
    private readonly audit: AuditService,
    private readonly efi: EfiChargesService,
    private readonly btg: BtgChargesService,
    private readonly contracts: ContractsService,
    private readonly serviceOrders: ServiceOrdersService,
    private readonly radacct: RadacctService,
  ) {}

  private deps(): BotActionDeps {
    return {
      prisma: this.prisma,
      efi: this.efi,
      btg: this.btg,
      contracts: this.contracts,
      serviceOrders: this.serviceOrders,
      radacct: this.radacct,
    };
  }

  // -------- config (admin) --------

  async getConfig(tenantId: string): Promise<BotConfigDto> {
    const row = await this.prisma.whatsappBotConfig.findUnique({ where: { tenantId } });
    if (!row) return DEFAULTS;
    const menu = (row.menuJson as { options?: BotMenuOption[] } | null) ?? null;
    return {
      enabled: row.enabled,
      aiEnabled: row.aiEnabled,
      greeting: row.greeting ?? DEFAULTS.greeting,
      fallbackText: row.fallbackText ?? DEFAULTS.fallbackText,
      handoffText: row.handoffText ?? DEFAULTS.handoffText,
      unknownText: row.unknownText ?? DEFAULTS.unknownText,
      options: menu?.options?.length ? menu.options : DEFAULTS.options,
    };
  }

  async updateConfig(tenantId: string, actorUserId: string, input: BotConfigDto): Promise<BotConfigDto> {
    const data = {
      enabled: input.enabled,
      aiEnabled: input.aiEnabled,
      greeting: input.greeting,
      fallbackText: input.fallbackText,
      handoffText: input.handoffText,
      unknownText: input.unknownText,
      menuJson: { options: input.options } as unknown as Prisma.InputJsonValue,
    };
    await this.prisma.whatsappBotConfig.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'whatsapp.bot.config.update',
      resource: 'whatsapp_bot_config',
      resourceId: tenantId,
      metadata: { enabled: input.enabled, aiEnabled: input.aiEnabled },
    });
    return this.getConfig(tenantId);
  }

  // -------- motor (chamado pelos webhooks em mensagem inbound nova) --------

  /** Best-effort: nunca lança (não pode quebrar o webhook). */
  async onInbound(tenantId: string, conversationId: string): Promise<void> {
    try {
      await this.handle(tenantId, conversationId);
    } catch (e) {
      this.logger.warn(`bot onInbound falhou: ${(e as Error).message}`);
    }
  }

  private async handle(tenantId: string, conversationId: string): Promise<void> {
    const conv = await this.prisma.whatsappConversation.findFirst({
      where: { id: conversationId, tenantId },
      include: {
        contact: true,
        instance: { select: { channel: true, status: true } },
        messages: { where: { direction: 'IN' }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!conv) return;
    // Humano no controle, grupo, ou instância offline → bot não age.
    if (conv.assignedUserId) return;
    if (conv.contact.isGroup) return;
    if (conv.instance.channel === 'WAHA' && conv.instance.status !== 'CONNECTED') return;

    const config = await this.getConfig(tenantId);
    if (!config.enabled) return;

    const text = (conv.messages[0]?.body ?? '').trim();
    const lower = text.toLowerCase();
    const ctxState = (conv.botContext as BotContext | null) ?? {};

    // Pedido explícito de humano em qualquer ponto.
    if (HANDOFF_WORDS.some((w) => lower.includes(w))) {
      await this.handoff(tenantId, conv.id, config);
      return;
    }

    // Conversa nova/reaberta → saúda e mostra o menu.
    if (!conv.botActive) {
      await this.setContext(conv.id, { node: 'menu' }, true);
      await this.send(tenantId, conv.id, `${config.greeting}\n\n${this.renderMenu(config)}`);
      return;
    }

    // Aguardando descrição de chamado.
    if (ctxState.node === 'await_ticket') {
      await this.runTicket(tenantId, conv, config, text);
      return;
    }

    // Modo IA livre: tudo vai pra IA até pedir menu/humano.
    if (ctxState.node === 'ai') {
      if (MENU_WORDS.includes(lower)) {
        await this.setContext(conv.id, { node: 'menu' });
        await this.send(tenantId, conv.id, this.renderMenu(config));
        return;
      }
      await this.routeToAi(tenantId, conv, config, text);
      return;
    }

    // Modo menu: tenta casar a opção.
    if (MENU_WORDS.includes(lower)) {
      await this.send(tenantId, conv.id, this.renderMenu(config));
      return;
    }
    const opt = config.options.find(
      (o) => o.key.toLowerCase() === lower || (text.length > 2 && o.label.toLowerCase() === lower),
    );
    if (opt) {
      await this.runOption(tenantId, conv, config, opt);
      return;
    }

    // Sem casar: IA (se ligada) ou fallback.
    if (config.aiEnabled) {
      await this.routeToAi(tenantId, conv, config, text);
      return;
    }
    await this.send(tenantId, conv.id, `${config.fallbackText}\n\n${this.renderMenu(config)}`);
  }

  // -------- handlers --------

  private async runOption(
    tenantId: string,
    conv: { id: string; contact: { customerId: string | null } },
    config: BotConfigDto,
    opt: BotMenuOption,
  ): Promise<void> {
    if (opt.action === 'handoff') return this.handoff(tenantId, conv.id, config);
    if (opt.action === 'reply') {
      await this.send(tenantId, conv.id, `${opt.reply ?? ''}\n\n${this.renderMenu(config)}`);
      return;
    }
    if (opt.action === 'ai') {
      await this.setContext(conv.id, { node: 'ai' });
      await this.send(tenantId, conv.id, 'Pode escrever sua dúvida que eu te respondo. 🙂');
      return;
    }
    // action = tool
    if (!conv.contact.customerId) {
      await this.handoff(tenantId, conv.id, config, config.unknownText);
      return;
    }
    if (opt.tool === 'abrir_chamado') {
      await this.setContext(conv.id, { node: 'await_ticket' });
      await this.send(tenantId, conv.id, 'Descreva rapidamente o que está acontecendo que eu abro o chamado. ✍️');
      return;
    }
    await this.runTool(tenantId, conv.id, conv.contact.customerId, opt.tool ?? '', config);
  }

  private async runTool(
    tenantId: string,
    conversationId: string,
    customerId: string,
    tool: string,
    config: BotConfigDto,
  ): Promise<void> {
    const ctx: BotActionCtx = { tenantId, customerId };
    let msg: string;
    switch (tool) {
      case 'minhas_faturas': {
        const fats = await listOpenInvoices(this.deps(), ctx);
        msg = fats.length
          ? 'Suas faturas em aberto:\n' +
            fats.map((f) => `• ${f.valorFmt} — vence ${f.vencimento} (${f.status})`).join('\n')
          : 'Você não tem faturas em aberto. 🎉';
        break;
      }
      case 'segunda_via': {
        const r = await generateSegundaVia(this.deps(), ctx, undefined);
        if (r.ok && r.pix) {
          msg =
            `Aqui está o Pix da sua fatura de ${r.valorFmt} (vence ${r.vencimento}):\n\n` +
            `${r.pix}\n\nÉ só copiar e colar no app do seu banco. ✅`;
          if (r.paymentLink) msg += `\n\nOu pague pelo link: ${r.paymentLink}`;
        } else if (r.reason === 'nenhuma fatura em aberto') {
          msg = 'Você não tem faturas em aberto. 🎉';
        } else if (r.reason === 'gateway manual') {
          msg = `Sua fatura de ${r.valorFmt} vence em ${r.vencimento}. Vou te passar para um atendente gerar a 2ª via.`;
          await this.send(tenantId, conversationId, msg);
          return this.handoff(tenantId, conversationId, config);
        } else {
          msg = 'Não consegui gerar a 2ª via agora. Vou te passar para um atendente.';
          await this.send(tenantId, conversationId, msg);
          return this.handoff(tenantId, conversationId, config);
        }
        break;
      }
      case 'status_conexao': {
        const cs = await connectionStatus(this.deps(), ctx);
        msg = cs.length
          ? cs
              .map((c) => {
                const dot = c.online === null ? '⚪' : c.online ? '🟢 Online' : '🔴 Offline';
                const ip = c.ip ? ` (IP ${c.ip})` : '';
                return `Contrato ${c.contrato}: ${dot}${ip} — ${c.statusContrato}`;
              })
              .join('\n')
          : 'Não encontrei contratos no seu cadastro.';
        break;
      }
      case 'desbloqueio_confianca': {
        const r = await trustUnblock(this.deps(), ctx);
        msg = r.ok
          ? `Prontinho! ✅ Liberei seu acesso por confiança até ${r.ate}. Pode levar alguns minutos para normalizar.`
          : r.reason === 'nenhum contrato bloqueado por dívida'
          ? 'Não encontrei bloqueio por débito no seu contrato. Se ainda estiver sem conexão, escolha "Status" ou fale com um atendente.'
          : 'Não consegui fazer o religue agora. Vou te passar para um atendente.';
        if (!r.ok && r.reason !== 'nenhum contrato bloqueado por dívida') {
          await this.send(tenantId, conversationId, msg);
          return this.handoff(tenantId, conversationId, config);
        }
        break;
      }
      default:
        msg = config.fallbackText;
    }
    await this.send(tenantId, conversationId, `${msg}\n\n${this.renderMenu(config)}`);
  }

  private async runTicket(
    tenantId: string,
    conv: { id: string; contact: { customerId: string | null } },
    config: BotConfigDto,
    description: string,
  ): Promise<void> {
    await this.setContext(conv.id, { node: 'menu' });
    if (!conv.contact.customerId) {
      return this.handoff(tenantId, conv.id, config, config.unknownText);
    }
    const r = await openTicket(this.deps(), { tenantId, customerId: conv.contact.customerId }, description);
    if (r.ok) {
      await this.send(
        tenantId,
        conv.id,
        `Chamado aberto com sucesso! 📋 Protocolo *${r.code}*. Em breve nossa equipe entra em contato.\n\n${this.renderMenu(config)}`,
      );
    } else {
      await this.send(tenantId, conv.id, 'Não consegui abrir o chamado automaticamente. Vou te passar para um atendente.');
      await this.handoff(tenantId, conv.id, config);
    }
  }

  private async routeToAi(
    tenantId: string,
    conv: { id: string; contact: { customerId: string | null } },
    config: BotConfigDto,
    text: string,
  ): Promise<void> {
    if (!conv.contact.customerId) {
      return this.handoff(tenantId, conv.id, config, config.unknownText);
    }
    const engine = await this.ai.getEngine(tenantId);
    if (!engine.supportsTools()) {
      // IA sem suporte a ferramentas (ex.: só Ollama) → não tenta, cai no menu.
      await this.send(tenantId, conv.id, `${config.fallbackText}\n\n${this.renderMenu(config)}`);
      return;
    }
    await this.setContext(conv.id, { node: 'ai' });
    const state = { handoff: false };
    const executor = buildBotExecutor(
      this.deps(),
      { tenantId, customerId: conv.contact.customerId },
      state,
    );
    const r = await engine.agent(
      [{ role: 'user', content: text }],
      BOT_TOOLS,
      executor,
      { system: BOT_SYSTEM, maxTokens: 700, maxSteps: 5 },
      'whatsapp.bot',
    );
    if (r.text?.trim()) await this.send(tenantId, conv.id, r.text.trim());
    if (state.handoff) await this.handoff(tenantId, conv.id, config);
  }

  // -------- util --------

  private renderMenu(config: BotConfigDto): string {
    const lines = config.options.map((o) => `${o.key} - ${o.label}`).join('\n');
    return `${lines}\n\n_Responda com o número da opção._`;
  }

  private async send(tenantId: string, conversationId: string, text: string): Promise<void> {
    await this.conversations.sendAsBot(tenantId, conversationId, text);
  }

  private async setContext(
    conversationId: string,
    ctx: BotContext,
    activate?: boolean,
  ): Promise<void> {
    await this.prisma.whatsappConversation.update({
      where: { id: conversationId },
      data: {
        botContext: ctx as object,
        ...(activate ? { botActive: true } : {}),
      },
    });
  }

  private async handoff(
    tenantId: string,
    conversationId: string,
    config: BotConfigDto,
    customText?: string,
  ): Promise<void> {
    await this.send(tenantId, conversationId, customText ?? config.handoffText);
    await this.prisma.whatsappConversation.update({
      where: { id: conversationId },
      data: { botActive: false, botContext: Prisma.JsonNull },
    });
    // Avisa o inbox: a conversa (não atribuída) está esperando um humano.
    this.events.emit({
      type: 'conversation.updated',
      tenantId,
      payload: { id: conversationId, botActive: false },
    });
  }
}

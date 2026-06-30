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

// ---- i18n do bot (idioma escolhido por DDI do cliente, fallback no provedor) ----

export type BotLang = 'pt' | 'es' | 'en';

/** Idioma a partir do DDI do telefone; cai no idioma do provedor (locale). */
function langForPhone(phoneE164: string | null | undefined, tenantLocale: string): BotLang {
  const d = (phoneE164 ?? '').replace(/\D/g, '');
  if (d.startsWith('595')) return 'es'; // Paraguai
  if (d.startsWith('55')) return 'pt'; // Brasil
  return langFromLocale(tenantLocale);
}
function langFromLocale(locale: string | null | undefined): BotLang {
  const l = (locale ?? '').toLowerCase();
  if (l.startsWith('es')) return 'es';
  if (l.startsWith('en')) return 'en';
  return 'pt';
}

interface BotStrings {
  aiAsk: string;
  ticketAsk: string;
  noInvoices: string;
  pixIntro: (v: string, d: string) => string;
  pixCopy: string;
  payLink: (l: string) => string;
  segManual: (v: string, d: string) => string;
  segError: string;
  noContracts: string;
  online: string;
  offline: string;
  trustOk: (ate: string) => string;
  trustNoBlock: string;
  trustError: string;
  ticketOk: (code: string) => string;
  ticketError: string;
  menuFooter: string;
}

const STR: Record<BotLang, BotStrings> = {
  pt: {
    aiAsk: 'Pode escrever sua dúvida que eu te respondo. 🙂',
    ticketAsk: 'Descreva rapidamente o que está acontecendo que eu abro o chamado. ✍️',
    noInvoices: 'Você não tem faturas em aberto. 🎉',
    pixIntro: (v, d) => `Aqui está o Pix da sua fatura de ${v} (vence ${d}):`,
    pixCopy: 'É só copiar e colar no app do seu banco. ✅',
    payLink: (l) => `Ou pague pelo link: ${l}`,
    segManual: (v, d) => `Sua fatura de ${v} vence em ${d}. Vou te passar para um atendente gerar a 2ª via.`,
    segError: 'Não consegui gerar a 2ª via agora. Vou te passar para um atendente.',
    noContracts: 'Não encontrei contratos no seu cadastro.',
    online: '🟢 Online',
    offline: '🔴 Offline',
    trustOk: (ate) => `Prontinho! ✅ Liberei seu acesso por confiança até ${ate}. Pode levar alguns minutos para normalizar.`,
    trustNoBlock: 'Não encontrei bloqueio por débito no seu contrato. Se ainda estiver sem conexão, escolha "Status" ou fale com um atendente.',
    trustError: 'Não consegui fazer o religue agora. Vou te passar para um atendente.',
    ticketOk: (code) => `Chamado aberto com sucesso! 📋 Protocolo *${code}*. Em breve nossa equipe entra em contato.`,
    ticketError: 'Não consegui abrir o chamado automaticamente. Vou te passar para um atendente.',
    menuFooter: '_Responda com o número da opção._',
  },
  es: {
    aiAsk: 'Escribí tu consulta que yo te respondo. 🙂',
    ticketAsk: 'Contame brevemente qué está pasando y abro el reclamo. ✍️',
    noInvoices: 'No tenés facturas pendientes. 🎉',
    pixIntro: (v, d) => `Acá está el Pix de tu factura de ${v} (vence ${d}):`,
    pixCopy: 'Solo copiá y pegá en la app de tu banco. ✅',
    payLink: (l) => `O pagá por el link: ${l}`,
    segManual: (v, d) => `Tu factura de ${v} vence el ${d}. Te paso con un agente para generar la 2ª vía.`,
    segError: 'No pude generar la 2ª vía ahora. Te paso con un agente.',
    noContracts: 'No encontré contratos en tu registro.',
    online: '🟢 En línea',
    offline: '🔴 Sin conexión',
    trustOk: (ate) => `¡Listo! ✅ Habilité tu acceso por confianza hasta ${ate}. Puede tardar unos minutos en normalizar.`,
    trustNoBlock: 'No encontré bloqueo por deuda en tu contrato. Si seguís sin conexión, elegí "Estado" o hablá con un agente.',
    trustError: 'No pude hacer el religue ahora. Te paso con un agente.',
    ticketOk: (code) => `¡Reclamo abierto! 📋 Protocolo *${code}*. Nuestro equipo te contactará pronto.`,
    ticketError: 'No pude abrir el reclamo automáticamente. Te paso con un agente.',
    menuFooter: '_Respondé con el número de la opción._',
  },
  en: {
    aiAsk: 'Type your question and I will help. 🙂',
    ticketAsk: 'Briefly describe the issue and I will open the ticket. ✍️',
    noInvoices: 'You have no open invoices. 🎉',
    pixIntro: (v, d) => `Here is the Pix for your ${v} invoice (due ${d}):`,
    pixCopy: 'Just copy and paste it in your bank app. ✅',
    payLink: (l) => `Or pay via link: ${l}`,
    segManual: (v, d) => `Your ${v} invoice is due ${d}. I'll pass you to an agent to issue it.`,
    segError: "I couldn't issue it now. I'll pass you to an agent.",
    noContracts: 'I found no contracts on your account.',
    online: '🟢 Online',
    offline: '🔴 Offline',
    trustOk: (ate) => `Done! ✅ I enabled trust access until ${ate}. It may take a few minutes to restore.`,
    trustNoBlock: 'I found no overdue block on your contract. If you are still offline, pick "Status" or talk to an agent.',
    trustError: "I couldn't reconnect now. I'll pass you to an agent.",
    ticketOk: (code) => `Ticket opened! 📋 Protocol *${code}*. Our team will contact you soon.`,
    ticketError: "I couldn't open the ticket automatically. I'll pass you to an agent.",
    menuFooter: '_Reply with the option number._',
  },
};

const DEFAULTS_BY_LANG: Record<BotLang, Pick<BotConfigDto, 'greeting' | 'fallbackText' | 'handoffText' | 'unknownText' | 'options'>> = {
  pt: {
    greeting: 'Olá! 👋 Sou o assistente virtual. Como posso ajudar você hoje?',
    fallbackText: 'Não entendi 🤔. Responda com o número de uma opção ou digite *menu*.',
    handoffText: 'Certo! Já estou te encaminhando para um de nossos atendentes. 👤',
    unknownText: 'Não localizei seu cadastro por este número. Vou te transferir para um atendente. 👤',
    options: [
      { key: '1', label: '2ª via / Pix do boleto', action: 'tool', tool: 'segunda_via' },
      { key: '2', label: 'Status da minha conexão', action: 'tool', tool: 'status_conexao' },
      { key: '3', label: 'Desbloqueio de confiança', action: 'tool', tool: 'desbloqueio_confianca' },
      { key: '4', label: 'Abrir um chamado', action: 'tool', tool: 'abrir_chamado' },
      { key: '5', label: 'Falar com um atendente', action: 'handoff' },
    ],
  },
  es: {
    greeting: '¡Hola! 👋 Soy el asistente virtual. ¿Cómo puedo ayudarte hoy?',
    fallbackText: 'No entendí 🤔. Respondé con el número de una opción o escribí *menú*.',
    handoffText: '¡Listo! Te estoy derivando a uno de nuestros agentes. 👤',
    unknownText: 'No encontré tu registro por este número. Te transfiero a un agente. 👤',
    options: [
      { key: '1', label: '2ª vía / Pix de la factura', action: 'tool', tool: 'segunda_via' },
      { key: '2', label: 'Estado de mi conexión', action: 'tool', tool: 'status_conexao' },
      { key: '3', label: 'Desbloqueo de confianza', action: 'tool', tool: 'desbloqueio_confianca' },
      { key: '4', label: 'Abrir un reclamo', action: 'tool', tool: 'abrir_chamado' },
      { key: '5', label: 'Hablar con un agente', action: 'handoff' },
    ],
  },
  en: {
    greeting: 'Hi! 👋 I am the virtual assistant. How can I help you today?',
    fallbackText: "I didn't get that 🤔. Reply with an option number or type *menu*.",
    handoffText: 'Got it! Connecting you to one of our agents. 👤',
    unknownText: "I couldn't find your account for this number. I'll transfer you to an agent. 👤",
    options: [
      { key: '1', label: 'Invoice / Pix copy', action: 'tool', tool: 'segunda_via' },
      { key: '2', label: 'My connection status', action: 'tool', tool: 'status_conexao' },
      { key: '3', label: 'Trust unblock', action: 'tool', tool: 'desbloqueio_confianca' },
      { key: '4', label: 'Open a ticket', action: 'tool', tool: 'abrir_chamado' },
      { key: '5', label: 'Talk to an agent', action: 'handoff' },
    ],
  },
};

// Palavras-gatilho combinadas (pt/es/en) — funcionam em qualquer idioma.
const HANDOFF_WORDS = ['atendente', 'humano', 'pessoa', 'falar com alguem', 'falar com alguém', 'agente', 'persona', 'hablar con alguien', 'human', 'agent'];
const MENU_WORDS = ['menu', 'menú', 'voltar', 'inicio', 'início', 'volver', 'oi', 'ola', 'olá', 'hola', 'buenas', 'hi', 'hello', 'start'];

function botSystem(lang: BotLang): string {
  const langName = { pt: 'português do Brasil', es: 'español', en: 'English' }[lang];
  return [
    'Você é o assistente virtual de um provedor de internet, atendendo o cliente no WhatsApp.',
    'Use SEMPRE as ferramentas para agir (2ª via, status, desbloqueio, chamado) — nunca invente dados.',
    `Responda SEMPRE em ${langName}, cordial e BREVE (no máximo 3 frases — é WhatsApp).`,
    'Se o cliente pedir algo fora do seu alcance ou quiser falar com humano, use falar_com_atendente.',
    'Ao gerar Pix, mostre o código copia-e-cola exatamente como veio da ferramenta.',
  ].join(' ');
}

interface BotContext {
  node?: 'menu' | 'ai' | 'await_ticket' | 'handed_off';
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

  /** Config pro admin (defaults no idioma do provedor). */
  async getConfig(tenantId: string): Promise<BotConfigDto> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { locale: true },
    });
    return this.resolveConfig(tenantId, langFromLocale(tenant?.locale));
  }

  /** Config efetiva pra um idioma: valores salvos, com defaults do idioma. */
  private async resolveConfig(tenantId: string, lang: BotLang): Promise<BotConfigDto> {
    const row = await this.prisma.whatsappBotConfig.findUnique({ where: { tenantId } });
    const def = DEFAULTS_BY_LANG[lang];
    if (!row) return { enabled: false, aiEnabled: false, ...def };
    const menu = (row.menuJson as { options?: BotMenuOption[] } | null) ?? null;
    return {
      enabled: row.enabled,
      aiEnabled: row.aiEnabled,
      greeting: row.greeting ?? def.greeting,
      fallbackText: row.fallbackText ?? def.fallbackText,
      handoffText: row.handoffText ?? def.handoffText,
      unknownText: row.unknownText ?? def.unknownText,
      options: menu?.options?.length ? menu.options : def.options,
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

    // Idioma por DDI do cliente (fallback no provedor); moeda/locale p/ valores.
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { locale: true, currency: true },
    });
    const lang = langForPhone(conv.contact.phoneE164, tenant?.locale ?? 'pt-BR');
    const fmt = { locale: tenant?.locale ?? 'pt-BR', currency: tenant?.currency ?? 'BRL' };
    const config = await this.resolveConfig(tenantId, lang);
    if (!config.enabled) return;

    const text = (conv.messages[0]?.body ?? '').trim();
    const lower = text.toLowerCase();
    const ctxState = (conv.botContext as BotContext | null) ?? {};

    // Já encaminhado a um humano: o bot fica EM SILÊNCIO (a conversa está na
    // fila esperando atendente) — evita o loop de re-saudar a cada mensagem.
    // Só volta a agir se o cliente pedir o menu explicitamente.
    if (ctxState.node === 'handed_off') {
      if (MENU_WORDS.includes(lower)) {
        await this.setContext(conv.id, { node: 'menu' }, true);
        await this.send(tenantId, conv.id, `${config.greeting}\n\n${this.renderMenu(config, lang)}`);
      }
      return;
    }

    // Pedido explícito de humano em qualquer ponto.
    if (HANDOFF_WORDS.some((w) => lower.includes(w))) {
      await this.handoff(tenantId, conv.id, config);
      return;
    }

    // Conversa nova/reaberta → saúda e mostra o menu.
    if (!conv.botActive) {
      await this.setContext(conv.id, { node: 'menu' }, true);
      await this.send(tenantId, conv.id, `${config.greeting}\n\n${this.renderMenu(config, lang)}`);
      return;
    }

    // Aguardando descrição de chamado.
    if (ctxState.node === 'await_ticket') {
      await this.runTicket(tenantId, conv, config, lang, fmt, text);
      return;
    }

    // Modo IA livre: tudo vai pra IA até pedir menu/humano.
    if (ctxState.node === 'ai') {
      if (MENU_WORDS.includes(lower)) {
        await this.setContext(conv.id, { node: 'menu' });
        await this.send(tenantId, conv.id, this.renderMenu(config, lang));
        return;
      }
      await this.routeToAi(tenantId, conv, config, lang, fmt, text);
      return;
    }

    // Modo menu: tenta casar a opção.
    if (MENU_WORDS.includes(lower)) {
      await this.send(tenantId, conv.id, this.renderMenu(config, lang));
      return;
    }
    const opt = config.options.find(
      (o) => o.key.toLowerCase() === lower || (text.length > 2 && o.label.toLowerCase() === lower),
    );
    if (opt) {
      await this.runOption(tenantId, conv, config, lang, fmt, opt);
      return;
    }

    // Sem casar: IA (se ligada) ou fallback.
    if (config.aiEnabled) {
      await this.routeToAi(tenantId, conv, config, lang, fmt, text);
      return;
    }
    await this.send(tenantId, conv.id, `${config.fallbackText}\n\n${this.renderMenu(config, lang)}`);
  }

  // -------- handlers --------

  private async runOption(
    tenantId: string,
    conv: { id: string; contact: { customerId: string | null } },
    config: BotConfigDto,
    lang: BotLang,
    fmt: { locale: string; currency: string },
    opt: BotMenuOption,
  ): Promise<void> {
    if (opt.action === 'handoff') return this.handoff(tenantId, conv.id, config);
    if (opt.action === 'reply') {
      await this.send(tenantId, conv.id, `${opt.reply ?? ''}\n\n${this.renderMenu(config, lang)}`);
      return;
    }
    if (opt.action === 'ai') {
      await this.setContext(conv.id, { node: 'ai' });
      await this.send(tenantId, conv.id, STR[lang].aiAsk);
      return;
    }
    // action = tool
    if (!conv.contact.customerId) {
      await this.handoff(tenantId, conv.id, config, config.unknownText);
      return;
    }
    if (opt.tool === 'abrir_chamado') {
      await this.setContext(conv.id, { node: 'await_ticket' });
      await this.send(tenantId, conv.id, STR[lang].ticketAsk);
      return;
    }
    await this.runTool(tenantId, conv.id, conv.contact.customerId, opt.tool ?? '', config, lang, fmt);
  }

  private async runTool(
    tenantId: string,
    conversationId: string,
    customerId: string,
    tool: string,
    config: BotConfigDto,
    lang: BotLang,
    fmt: { locale: string; currency: string },
  ): Promise<void> {
    const ctx: BotActionCtx = { tenantId, customerId, locale: fmt.locale, currency: fmt.currency };
    const s = STR[lang];
    let msg: string;
    switch (tool) {
      case 'minhas_faturas': {
        const fats = await listOpenInvoices(this.deps(), ctx);
        const header = { pt: 'Suas faturas em aberto:', es: 'Tus facturas pendientes:', en: 'Your open invoices:' }[lang];
        msg = fats.length
          ? `${header}\n` + fats.map((f) => `• ${f.valorFmt} — ${f.vencimento} (${f.status})`).join('\n')
          : s.noInvoices;
        break;
      }
      case 'segunda_via': {
        const r = await generateSegundaVia(this.deps(), ctx, undefined);
        if (r.ok && r.pix) {
          msg = `${s.pixIntro(r.valorFmt ?? '', r.vencimento ?? '')}\n\n${r.pix}\n\n${s.pixCopy}`;
          if (r.paymentLink) msg += `\n\n${s.payLink(r.paymentLink)}`;
        } else if (r.reason === 'nenhuma fatura em aberto') {
          msg = s.noInvoices;
        } else if (r.reason === 'gateway manual') {
          msg = s.segManual(r.valorFmt ?? '', r.vencimento ?? '');
          await this.send(tenantId, conversationId, msg);
          return this.handoff(tenantId, conversationId, config);
        } else {
          msg = s.segError;
          await this.send(tenantId, conversationId, msg);
          return this.handoff(tenantId, conversationId, config);
        }
        break;
      }
      case 'status_conexao': {
        const cs = await connectionStatus(this.deps(), ctx);
        const contractWord = { pt: 'Contrato', es: 'Contrato', en: 'Contract' }[lang];
        msg = cs.length
          ? cs
              .map((c) => {
                const dot = c.online === null ? '⚪' : c.online ? s.online : s.offline;
                const ip = c.ip ? ` (IP ${c.ip})` : '';
                return `${contractWord} ${c.contrato}: ${dot}${ip} — ${c.statusContrato}`;
              })
              .join('\n')
          : s.noContracts;
        break;
      }
      case 'desbloqueio_confianca': {
        const r = await trustUnblock(this.deps(), ctx);
        msg = r.ok
          ? s.trustOk(r.ate ?? '')
          : r.reason === 'nenhum contrato bloqueado por dívida'
            ? s.trustNoBlock
            : s.trustError;
        if (!r.ok && r.reason !== 'nenhum contrato bloqueado por dívida') {
          await this.send(tenantId, conversationId, msg);
          return this.handoff(tenantId, conversationId, config);
        }
        break;
      }
      default:
        msg = config.fallbackText;
    }
    await this.send(tenantId, conversationId, `${msg}\n\n${this.renderMenu(config, lang)}`);
  }

  private async runTicket(
    tenantId: string,
    conv: { id: string; contact: { customerId: string | null } },
    config: BotConfigDto,
    lang: BotLang,
    fmt: { locale: string; currency: string },
    description: string,
  ): Promise<void> {
    await this.setContext(conv.id, { node: 'menu' });
    if (!conv.contact.customerId) {
      return this.handoff(tenantId, conv.id, config, config.unknownText);
    }
    const ctx: BotActionCtx = {
      tenantId,
      customerId: conv.contact.customerId,
      locale: fmt.locale,
      currency: fmt.currency,
    };
    const r = await openTicket(this.deps(), ctx, description);
    if (r.ok) {
      await this.send(tenantId, conv.id, `${STR[lang].ticketOk(r.code ?? '')}\n\n${this.renderMenu(config, lang)}`);
    } else {
      await this.send(tenantId, conv.id, STR[lang].ticketError);
      await this.handoff(tenantId, conv.id, config);
    }
  }

  private async routeToAi(
    tenantId: string,
    conv: { id: string; contact: { customerId: string | null } },
    config: BotConfigDto,
    lang: BotLang,
    fmt: { locale: string; currency: string },
    text: string,
  ): Promise<void> {
    if (!conv.contact.customerId) {
      return this.handoff(tenantId, conv.id, config, config.unknownText);
    }
    const engine = await this.ai.getEngine(tenantId);
    if (!engine.supportsTools()) {
      // IA sem suporte a ferramentas (ex.: só Ollama) → não tenta, cai no menu.
      await this.send(tenantId, conv.id, `${config.fallbackText}\n\n${this.renderMenu(config, lang)}`);
      return;
    }
    await this.setContext(conv.id, { node: 'ai' });
    const state = { handoff: false };
    const executor = buildBotExecutor(
      this.deps(),
      { tenantId, customerId: conv.contact.customerId, locale: fmt.locale, currency: fmt.currency },
      state,
    );
    const r = await engine.agent(
      [{ role: 'user', content: text }],
      BOT_TOOLS,
      executor,
      { system: botSystem(lang), maxTokens: 700, maxSteps: 5 },
      'whatsapp.bot',
    );
    if (r.text?.trim()) await this.send(tenantId, conv.id, r.text.trim());
    if (state.handoff) await this.handoff(tenantId, conv.id, config);
  }

  // -------- util --------

  private renderMenu(config: BotConfigDto, lang: BotLang): string {
    const lines = config.options.map((o) => `${o.key} - ${o.label}`).join('\n');
    return `${lines}\n\n${STR[lang].menuFooter}`;
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
    // Marca handed_off: o bot fica em silêncio (não re-saúda) enquanto a conversa
    // espera um humano. botActive=false → cai na fila "Espera". O node handed_off
    // é checado no início do handle(); é limpo ao reabrir (whatsapp-messages.service).
    await this.prisma.whatsappConversation.update({
      where: { id: conversationId },
      data: { botActive: false, botContext: { node: 'handed_off' } as object },
    });
    // Avisa o inbox: a conversa (não atribuída) está esperando um humano.
    this.events.emit({
      type: 'conversation.updated',
      tenantId,
      payload: { id: conversationId, botActive: false },
    });
  }
}

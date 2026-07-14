import { Injectable, Logger } from '@nestjs/common';

import { CopilotService } from '../../copilot/copilot.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappConversationsService } from '../whatsapp-conversations.service';
import { NexusOperatorsService } from './nexus-operators.service';

/** Quantas mensagens recentes entram no contexto do copiloto (custo/latência). */
const HISTORY_LIMIT = 12;

type NexusLang = 'pt' | 'es' | 'en';

function langForPhone(phoneE164: string | null | undefined, tenantLocale: string): NexusLang {
  const d = (phoneE164 ?? '').replace(/\D/g, '');
  if (d.startsWith('595')) return 'es'; // Paraguai
  if (d.startsWith('55')) return 'pt'; // Brasil
  const l = (tenantLocale ?? '').toLowerCase();
  if (l.startsWith('es')) return 'es';
  if (l.startsWith('en')) return 'en';
  return 'pt';
}

const STR: Record<NexusLang, {
  welcome: (name: string) => string;
  denied: string;
  error: string;
}> = {
  pt: {
    welcome: (name) =>
      `✅ Pareado! Olá${name ? ', ' + name : ''}. Sou a *Nexus*, o copiloto do NetX. ` +
      `Pode me perguntar sobre a operação: “como está a rede?”, “diagnostique o cliente Fulano”, ` +
      `“saúde financeira do mês”, “inadimplência”, etc. Sou read-only: analiso e recomendo, não altero nada.`,
    denied:
      'Este número não está autorizado a falar com a Nexus. Se você é da equipe, peça ao admin para ' +
      'cadastrar seu usuário e envie aqui o código de pareamento (ex.: NEXUS-123456).',
    error: 'Tive um problema para responder agora. Tente de novo em instantes. 🙏',
  },
  es: {
    welcome: (name) =>
      `✅ ¡Emparejado! Hola${name ? ', ' + name : ''}. Soy *Nexus*, el copiloto de NetX. ` +
      `Preguntame sobre la operación: “¿cómo está la red?”, “diagnosticá al cliente Fulano”, ` +
      `“salud financiera del mes”, “morosidad”, etc. Soy de solo lectura: analizo y recomiendo, no cambio nada.`,
    denied:
      'Este número no está autorizado a hablar con Nexus. Si sos del equipo, pedí al admin que ' +
      'registre tu usuario y enviá acá el código de emparejamiento (ej.: NEXUS-123456).',
    error: 'Tuve un problema para responder ahora. Probá de nuevo en unos instantes. 🙏',
  },
  en: {
    welcome: (name) =>
      `✅ Paired! Hi${name ? ', ' + name : ''}. I'm *Nexus*, the NetX copilot. ` +
      `Ask me about operations: “how's the network?”, “diagnose customer X”, “financial health this month”, ` +
      `“overdue”, etc. I'm read-only: I analyze and advise, I don't change anything.`,
    denied:
      'This number is not authorized to talk to Nexus. If you are staff, ask the admin to register ' +
      'your user and send the pairing code here (e.g. NEXUS-123456).',
    error: 'I had trouble answering just now. Please try again in a moment. 🙏',
  },
};

interface NexusCtx {
  nexusDenied?: boolean;
}

/**
 * NexusWhatsappService — motor da linha NEXUS. Trata a mensagem inbound de um
 * OPERADOR e responde com o copiloto Nexus (read-only, agêntico). Fronteira de
 * segurança: só operadores ACTIVE (pareados) recebem resposta; desconhecidos
 * recebem uma nota de "não autorizado" (uma vez) ou podem parear enviando o
 * código. Best-effort — NUNCA lança (não pode quebrar o webhook).
 */
@Injectable()
export class NexusWhatsappService {
  private readonly logger = new Logger(NexusWhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: WhatsappConversationsService,
    private readonly operators: NexusOperatorsService,
    private readonly copilot: CopilotService,
  ) {}

  async onInbound(tenantId: string, conversationId: string): Promise<void> {
    try {
      await this.handle(tenantId, conversationId);
    } catch (e) {
      this.logger.warn(`nexus onInbound falhou: ${(e as Error).message}`);
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
    if (conv.contact.isGroup) return; // linha Nexus é 1:1
    // Instância WAHA offline → não dá pra responder; sai sem ruído.
    if (conv.instance.channel === 'WAHA' && conv.instance.status !== 'CONNECTED') return;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { locale: true },
    });
    const lang = langForPhone(conv.contact.phoneE164, tenant?.locale ?? 'pt-BR');
    const text = (conv.messages[0]?.body ?? '').trim();
    if (!text) return;

    const operator = await this.operators.resolveActiveByPhone(tenantId, conv.contact.phoneE164);

    // Não autorizado: tenta parear pelo código; senão, nota de acesso (1x).
    if (!operator) {
      const paired = await this.operators.tryPair(tenantId, conv.contact.phoneE164, text);
      if (paired) {
        await this.clearDenied(conv.id);
        await this.send(tenantId, conv.id, STR[lang].welcome(paired.user.firstName));
        return;
      }
      const ctx = (conv.botContext as NexusCtx | null) ?? {};
      if (!ctx.nexusDenied) {
        await this.send(tenantId, conv.id, STR[lang].denied);
        await this.setContext(conv.id, { nexusDenied: true });
      }
      return;
    }

    // Operador autorizado → copiloto agêntico com o histórico recente.
    const messages = await this.history(conv.id);
    if (messages.length === 0) messages.push({ role: 'user', content: text });

    try {
      // authToken null: as tools de LEITURA (Prisma) funcionam; as de teste ativo
      // de rede (NMS) exigem token e retornam erro tratado pelo próprio copiloto.
      const r = await this.copilot.askAgent(tenantId, messages, null);
      await this.send(tenantId, conv.id, r.answer);
      await this.operators.touchLastSeen(operator.id);
    } catch (e) {
      this.logger.warn(`nexus copilot falhou: ${(e as Error).message}`);
      await this.send(tenantId, conv.id, STR[lang].error);
    }
  }

  /** Histórico recente → mensagens do copiloto (IN=user, OUT=assistant). */
  private async history(
    conversationId: string,
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    const rows = await this.prisma.whatsappMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
      select: { direction: true, type: true, body: true },
    });
    return rows
      .reverse()
      .map((m) => {
        const content = m.body?.trim() || `[${m.type.toLowerCase()}]`;
        return { role: (m.direction === 'IN' ? 'user' : 'assistant') as 'user' | 'assistant', content };
      })
      .filter((m) => m.content.length > 0);
  }

  private async send(tenantId: string, conversationId: string, text: string): Promise<void> {
    await this.conversations.sendAsBot(tenantId, conversationId, text);
  }

  private async setContext(conversationId: string, ctx: NexusCtx): Promise<void> {
    await this.prisma.whatsappConversation.update({
      where: { id: conversationId },
      data: { botContext: ctx as object },
    });
  }

  private async clearDenied(conversationId: string): Promise<void> {
    await this.prisma.whatsappConversation
      .update({ where: { id: conversationId }, data: { botContext: {} as object } })
      .catch(() => undefined);
  }
}

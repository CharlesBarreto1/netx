/**
 * WhatsappAiService — camada de IA CONSELHEIRA do atendimento (F4).
 *
 * Lê uma conversa do banco e devolve ajuda ao operador: resposta sugerida,
 * resumo, intenção, sentimento e urgência. NUNCA envia mensagem nem altera a
 * conversa — quem responde é o humano. Totalmente desacoplada do Evolution:
 * opera sobre as mensagens já persistidas (não depende do WhatsApp estar online).
 *
 * Usa o motor central @netx/ai (Ollama self-hosted + fallback de nuvem).
 */
import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';

import type { WaAiInsightsResponse, WaAiSuggestResponse } from '@netx/shared';

import { AiService } from '../ai/ai.service';
import { PrismaService } from '../prisma/prisma.service';

/** Quantas mensagens recentes entram no contexto (limita custo/latência). */
const HISTORY_LIMIT = 20;

// Idioma da sugestão/insights = idioma do cliente (DDI), fallback no provedor.
type AiLang = 'pt' | 'es' | 'en';
function langFromLocale(locale?: string | null): AiLang {
  const l = (locale ?? '').toLowerCase();
  if (l.startsWith('es')) return 'es';
  if (l.startsWith('en')) return 'en';
  return 'pt';
}
function langForPhone(phone?: string | null, tenantLocale?: string | null): AiLang {
  const d = (phone ?? '').replace(/\D/g, '');
  if (d.startsWith('595')) return 'es';
  if (d.startsWith('55')) return 'pt';
  return langFromLocale(tenantLocale);
}
const LANG_NAME: Record<AiLang, string> = { pt: 'português (pt-BR)', es: 'español', en: 'English' };

function suggestSystem(lang: AiLang): string {
  return [
    'Você é um assistente de atendimento ao cliente de um provedor de internet (ISP), via WhatsApp.',
    'Leia o histórico e sugira UMA resposta para o ATENDENTE enviar ao cliente.',
    `Tom profissional, cordial e objetivo. Escreva a resposta sugerida em ${LANG_NAME[lang]} (o MESMO idioma do cliente). No máximo 2 frases.`,
    'Baseie-se só no histórico; não invente dados (planos, valores, prazos) que não apareçam.',
    'Responda APENAS com o texto da resposta sugerida, sem aspas nem explicações.',
  ].join(' ');
}
function insightsSystem(lang: AiLang): string {
  return [
    'Você analisa uma conversa de atendimento (ISP, WhatsApp) e extrai insights para o atendente.',
    `Escreva summary e intent em ${LANG_NAME[lang]} (o idioma do cliente), com base SOMENTE no histórico.`,
    'Os campos sentiment e urgency DEVEM usar exatamente os valores do enum (em português).',
  ].join(' ');
}

const INSIGHTS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    intent: { type: 'string' },
    sentiment: { type: 'string', enum: ['positivo', 'neutro', 'insatisfeito'] },
    urgency: { type: 'string', enum: ['baixa', 'media', 'alta'] },
  },
  required: ['summary', 'intent', 'sentiment', 'urgency'],
  additionalProperties: false,
} as const;

interface InsightsRaw {
  summary: string;
  intent: string;
  sentiment: WaAiInsightsResponse['sentiment'];
  urgency: WaAiInsightsResponse['urgency'];
}

@Injectable()
export class WhatsappAiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  /** Sugere uma resposta para o atendente revisar e enviar. */
  async suggestReply(tenantId: string, conversationId: string): Promise<WaAiSuggestResponse> {
    const lang = await this.convLang(tenantId, conversationId);
    const transcript = await this.transcript(tenantId, conversationId);
    const r = await this.ai.chat(
      tenantId,
      [{ role: 'user', content: `Histórico da conversa:\n${transcript}\n\nResposta sugerida:` }],
      { system: suggestSystem(lang), maxTokens: 200 },
      'chat.suggest_reply',
    );
    return {
      suggestion: r.text.trim(),
      provider: r.provider,
      usedFallback: r.usedFallback,
    };
  }

  /** Resumo + intenção + sentimento + urgência da conversa. */
  async insights(tenantId: string, conversationId: string): Promise<WaAiInsightsResponse> {
    const lang = await this.convLang(tenantId, conversationId);
    const transcript = await this.transcript(tenantId, conversationId);
    // Usa chat (não json) para também obter provider/usedFallback no retorno.
    const r = await this.ai.chat(
      tenantId,
      [
        {
          role: 'user',
          content:
            `Conversa:\n${transcript}\n\n` +
            `Extraia: summary (2-3 frases), intent (assunto principal em poucas palavras), ` +
            `sentiment (positivo|neutro|insatisfeito), urgency (baixa|media|alta).`,
        },
      ],
      { system: insightsSystem(lang), maxTokens: 400, schema: INSIGHTS_SCHEMA },
      'chat.insights',
    );
    let out: InsightsRaw;
    try {
      out = JSON.parse(r.text) as InsightsRaw;
    } catch {
      throw new InternalServerErrorException('IA devolveu insights em formato inválido');
    }
    return {
      summary: out.summary,
      intent: out.intent,
      sentiment: out.sentiment,
      urgency: out.urgency,
      provider: r.provider,
      usedFallback: r.usedFallback,
    };
  }

  /** Idioma da conversa: DDI do contato, com fallback no locale do provedor. */
  private async convLang(tenantId: string, conversationId: string): Promise<AiLang> {
    const conv = await this.prisma.whatsappConversation.findFirst({
      where: { id: conversationId, tenantId },
      select: { contact: { select: { phoneE164: true } } },
    });
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { locale: true },
    });
    return langForPhone(conv?.contact?.phoneE164, tenant?.locale);
  }

  /**
   * Monta a transcrição das últimas mensagens (sem efeito colateral — não
   * registra "view" nem auditoria; é uso interno da IA).
   */
  private async transcript(tenantId: string, conversationId: string): Promise<string> {
    const conv = await this.prisma.whatsappConversation.findFirst({
      where: { id: conversationId, tenantId },
      select: { id: true },
    });
    if (!conv) throw new NotFoundException('Conversa não encontrada');

    const messages = await this.prisma.whatsappMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
      select: { direction: true, type: true, body: true },
    });
    if (messages.length === 0) return '(sem mensagens)';

    return messages
      .reverse()
      .map((m) => {
        const who = m.direction === 'IN' ? 'Cliente' : 'Atendente';
        const text = m.body?.trim() || `[${m.type.toLowerCase()}]`;
        return `${who}: ${text}`;
      })
      .join('\n');
  }
}

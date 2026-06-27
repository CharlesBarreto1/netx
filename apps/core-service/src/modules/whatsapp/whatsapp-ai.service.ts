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

const SUGGEST_SYSTEM = [
  'Você é um assistente de atendimento ao cliente de um provedor de internet (ISP), via WhatsApp.',
  'Leia o histórico e sugira UMA resposta para o ATENDENTE enviar ao cliente.',
  'Tom profissional, cordial e objetivo, em português (pt-BR). No máximo 2 frases.',
  'Baseie-se só no histórico; não invente dados (planos, valores, prazos) que não apareçam.',
  'Responda APENAS com o texto da resposta sugerida, sem aspas nem explicações.',
].join(' ');

const INSIGHTS_SYSTEM = [
  'Você analisa uma conversa de atendimento (ISP, WhatsApp) e extrai insights para o atendente.',
  'Responda em português (pt-BR), com base SOMENTE no histórico.',
].join(' ');

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
    const transcript = await this.transcript(tenantId, conversationId);
    const r = await this.ai.chat(
      tenantId,
      [{ role: 'user', content: `Histórico da conversa:\n${transcript}\n\nResposta sugerida:` }],
      { system: SUGGEST_SYSTEM, maxTokens: 200 },
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
      { system: INSIGHTS_SYSTEM, maxTokens: 400, schema: INSIGHTS_SCHEMA },
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

/**
 * IncidentAiService — camada de IA (Fase 4) da Central de Alarmes.
 *
 * Enriquece um Incident já aberto pela correlação determinística com um resumo
 * humano (aiSummary) e um rótulo de causa-raiz (aiRootCause). É ASSÍNCRONO e
 * best-effort — nunca no caminho crítico do alarme. A correlação já decidiu o
 * "o quê"; a IA escreve o "porquê" legível e ajuda a desambiguar.
 *
 * Sem dependência de SDK: chama a API Anthropic via fetch (Node 20+), com
 * saída estruturada (output_config.format). Desligada sem ANTHROPIC_API_KEY.
 *
 * Env:
 *   ANTHROPIC_API_KEY        — liga a camada (ausente = no-op)
 *   NETX_ALARM_AI_MODEL      — default claude-haiku-4-5 (barato p/ volume)
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

interface AiResult {
  summary: string;
  rootCause: string;
}

@Injectable()
export class IncidentAiService {
  private readonly logger = new Logger(IncidentAiService.name);

  constructor(private readonly prisma: PrismaService) {}

  get enabled(): boolean {
    return !!process.env.ANTHROPIC_API_KEY?.trim();
  }

  /** Enriquece um incident (fire-and-forget). Silencioso se IA desligada. */
  async enrich(incidentId: string): Promise<void> {
    if (!this.enabled) return;
    try {
      const inc = await this.prisma.incident.findUnique({ where: { id: incidentId } });
      if (!inc || inc.aiSummary) return; // já enriquecido ou sumiu

      // Contexto: contagem de reasons recentes nas ONTs deste incident.
      const events = await this.prisma.alarmEvent.findMany({
        where: { tenantId: inc.tenantId, incidentId, kind: 'DOWN' },
        select: { reason: true },
        take: 200,
      });
      const power = events.filter((e) => e.reason === 'POWER_LOSS').length;
      const link = events.filter((e) => e.reason === 'LINK_LOSS').length;

      const result = await this.callClaude({
        scope: inc.scope,
        scopeLabel: inc.scopeLabel,
        rootCause: inc.rootCause,
        affected: inc.affectedCount,
        total: inc.totalInScope,
        powerLoss: power,
        linkLoss: link,
      });
      if (!result) return;

      await this.prisma.incident.update({
        where: { id: incidentId },
        data: { aiSummary: result.summary.slice(0, 1000), aiRootCause: result.rootCause.slice(0, 120) },
      });
    } catch (err) {
      this.logger.warn(
        `[ai] enrich incident=${incidentId} falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async callClaude(ctx: {
    scope: string;
    scopeLabel: string;
    rootCause: string;
    affected: number;
    total: number;
    powerLoss: number;
    linkLoss: number;
  }): Promise<AiResult | null> {
    const model = process.env.NETX_ALARM_AI_MODEL?.trim() || 'claude-haiku-4-5';
    const prompt =
      `Você analisa alarmes de rede de um provedor de internet (ISP). Recebe um ` +
      `incidente JÁ correlacionado e escreve um resumo curto e técnico em português ` +
      `(pt-BR) para o NOC.\n\n` +
      `Incidente:\n` +
      `- escopo: ${ctx.scope} (${ctx.scopeLabel})\n` +
      `- causa provável (determinística): ${ctx.rootCause}\n` +
      `- clientes afetados: ${ctx.affected} de ${ctx.total}\n` +
      `- quedas com dying-gasp (energia): ${ctx.powerLoss}\n` +
      `- quedas com loss-of-signal (fibra/link): ${ctx.linkLoss}\n\n` +
      `Responda com: summary = 1-2 frases acionáveis ("o que houve + provável causa"); ` +
      `rootCause = rótulo curto (ex "Rompimento de cabo backbone", "Queda de energia no bairro", "Problema isolado do cliente").`;

    const body = {
      model,
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
              rootCause: { type: 'string' },
            },
            required: ['summary', 'rootCause'],
            additionalProperties: false,
          },
        },
      },
    };

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!resp.ok) {
      this.logger.warn(`[ai] Anthropic ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      return null;
    }
    const data = (await resp.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((b) => b.type === 'text')?.text;
    if (!text) return null;
    const parsed = JSON.parse(text) as AiResult;
    return parsed?.summary ? parsed : null;
  }
}

/**
 * IncidentAiService — camada de IA (Fase 4) da Central de Alarmes.
 *
 * Enriquece um Incident já aberto pela correlação determinística com um resumo
 * humano (aiSummary) e um rótulo de causa-raiz (aiRootCause). É ASSÍNCRONO e
 * best-effort — nunca no caminho crítico do alarme. A correlação já decidiu o
 * "o quê"; a IA escreve o "porquê" legível e ajuda a desambiguar.
 *
 * Usa o motor central @netx/ai (AiService): Ollama self-hosted por padrão, com
 * fallback de nuvem opcional. Desligado quando o tenant não tem backend
 * disponível. A IA é conselheira — só escreve texto, nunca aplica ação.
 */
import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

interface AiResult {
  summary: string;
  rootCause: string;
}

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    rootCause: { type: 'string' },
  },
  required: ['summary', 'rootCause'],
  additionalProperties: false,
} as const;

@Injectable()
export class IncidentAiService {
  private readonly logger = new Logger(IncidentAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  /** Enriquece um incident (fire-and-forget). Silencioso se IA indisponível. */
  async enrich(incidentId: string): Promise<void> {
    try {
      const inc = await this.prisma.incident.findUnique({ where: { id: incidentId } });
      if (!inc || inc.aiSummary) return; // já enriquecido ou sumiu
      if (!(await this.ai.available(inc.tenantId))) return; // motor desligado

      // Contexto: contagem de reasons recentes nas ONTs deste incident.
      const events = await this.prisma.alarmEvent.findMany({
        where: { tenantId: inc.tenantId, incidentId, kind: 'DOWN' },
        select: { reason: true },
        take: 200,
      });
      const power = events.filter((e) => e.reason === 'POWER_LOSS').length;
      const link = events.filter((e) => e.reason === 'LINK_LOSS').length;

      const result = await this.summarize(inc.tenantId, {
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

  private async summarize(
    tenantId: string,
    ctx: {
      scope: string;
      scopeLabel: string;
      rootCause: string;
      affected: number;
      total: number;
      powerLoss: number;
      linkLoss: number;
    },
  ): Promise<AiResult | null> {
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

    const parsed = await this.ai.json<AiResult>(
      tenantId,
      [{ role: 'user', content: prompt }],
      RESULT_SCHEMA,
      { maxTokens: 400 },
      'alarm.summary',
    );
    return parsed?.summary ? parsed : null;
  }
}

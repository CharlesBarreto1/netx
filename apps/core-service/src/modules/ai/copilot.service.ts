/**
 * CopilotService — copiloto grounded read-only (F3) do motor de IA.
 *
 * Responde perguntas operacionais do tenant ANCORADO num snapshot factual
 * coletado do próprio banco (contagens de clientes/contratos/incidentes). Nunca
 * inventa: se a evidência não cobre, manda dizer que não sabe. É conselheiro —
 * só texto, jamais executa ação.
 *
 * Em CPU local a inferência é lenta; uso interativo se beneficia do fallback de
 * nuvem (config do tenant).
 */
import { Injectable } from '@nestjs/common';

import type { AiAskResponse } from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AiService } from './ai.service';

const SYSTEM = [
  'Você é o copiloto do NetX, um sistema de gestão para provedores de internet (ISP).',
  'Responda em português (pt-BR), de forma concisa e técnica.',
  'Você é ESTRITAMENTE read-only: explica e resume, NUNCA executa nem instrui a',
  'plataforma a alterar dados ou configuração. Responda APENAS com base nas',
  'EVIDÊNCIAS fornecidas. Se os dados não permitirem concluir, diga isso',
  'claramente em vez de inventar.',
].join(' ');

@Injectable()
export class CopilotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async ask(tenantId: string, question: string): Promise<AiAskResponse> {
    const evidence = await this.snapshot(tenantId);
    const r = await this.ai.chat(
      tenantId,
      [{ role: 'user', content: `EVIDÊNCIAS (snapshot do tenant):\n${evidence}\n\nPERGUNTA: ${question}` }],
      { system: SYSTEM, maxTokens: 800 },
      'copilot.ask',
    );
    return {
      question,
      answer: r.text || '(sem resposta)',
      provider: r.provider,
      usedFallback: r.usedFallback,
    };
  }

  /** Snapshot operacional compacto e factual (read-only) pra ancorar a resposta. */
  private async snapshot(tenantId: string): Promise<string> {
    const [byContract, byCustomer, openIncidents] = await Promise.all([
      this.prisma.contract.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { _all: true },
      }),
      this.prisma.customer.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { _all: true },
      }),
      this.prisma.incident.count({ where: { tenantId, status: 'OPEN' } }),
    ]);

    const lines: string[] = [];
    lines.push('[Contratos por status]');
    for (const r of byContract) lines.push(`- ${r.status}: ${r._count._all}`);
    lines.push('\n[Clientes por status]');
    for (const r of byCustomer) lines.push(`- ${r.status}: ${r._count._all}`);
    lines.push(`\n[Incidentes de rede abertos]: ${openIncidents}`);
    return lines.join('\n');
  }
}

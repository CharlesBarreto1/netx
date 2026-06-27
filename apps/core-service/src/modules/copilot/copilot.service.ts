/**
 * CopilotService — copiloto agêntico (tool-using) do NetX.
 *
 * O modelo recebe um catálogo de ferramentas read-only (COPILOT_TOOLS) e decide
 * quais chamar para responder com DADO REAL do tenant. Conselheiro: só lê,
 * nunca executa ação. Exige um backend com tool-calling (Anthropic / OpenAI-
 * compat) — em CPU local (Ollama) o agêntico fica indisponível.
 */
import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import type { AiAskResponse } from '@netx/shared';

import { AiService } from '../ai/ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { RadacctService } from '../radius/radacct.service';
import { COPILOT_TOOLS, buildCopilotExecutor } from './copilot-tools';
import { NmsClient } from './nms-client';

const SYSTEM = [
  'Você é o copiloto do NetX, um sistema de gestão para provedores de internet (ISP).',
  'Responda em português (pt-BR), conciso e técnico.',
  'Você é ESTRITAMENTE read-only e CONSELHEIRO: explica, diagnostica e resume,',
  'mas NUNCA executa nem instrui a plataforma a alterar dados/configuração.',
  'Use as FERRAMENTAS para obter dados reais antes de responder — não invente',
  'números nem nomes. Para diagnóstico de cliente, busque o cliente, depois rode',
  'o diagnóstico e correlacione sessão + ONT + incidentes.',
  'Para rede, use dispositivos_rede para achar o equipamento e depois',
  'trafego_rede / optica_rede. O tráfego de rede é INSTANTÂNEO (~60min): NÃO há',
  'histórico nem "pico de ontem" — se pedirem pico/ontem, diga que ainda não é',
  'coletado. Se a pergunta exigir dado que NENHUMA ferramenta fornece (ex.: estado',
  'de sessões BGP, latência para destinos externos), diga claramente que o NetX',
  'não coleta esse dado hoje — não invente.',
].join(' ');

@Injectable()
export class CopilotService {
  constructor(
    private readonly ai: AiService,
    private readonly prisma: PrismaService,
    private readonly radacct: RadacctService,
    private readonly nms: NmsClient,
  ) {}

  async ask(tenantId: string, question: string, authToken: string | null): Promise<AiAskResponse> {
    const engine = await this.ai.getEngine(tenantId);
    if (!engine.supportsTools()) {
      throw new ServiceUnavailableException(
        'O copiloto precisa de um motor com suporte a ferramentas (Anthropic ou OpenAI-compat). ' +
          'Ative o fallback de nuvem em Configurações › Motor de IA.',
      );
    }
    const executor = buildCopilotExecutor({
      prisma: this.prisma,
      radacct: this.radacct,
      nms: this.nms,
      tenantId,
      authToken,
    });
    const r = await engine.agent(
      [{ role: 'user', content: question }],
      COPILOT_TOOLS,
      executor,
      { system: SYSTEM, maxTokens: 1024, maxSteps: 6 },
      'copilot.ask',
    );
    return {
      question,
      answer: r.text || '(sem resposta)',
      provider: r.provider,
      usedFallback: r.usedFallback,
    };
  }
}

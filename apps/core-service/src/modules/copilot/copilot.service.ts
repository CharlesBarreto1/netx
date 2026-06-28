/**
 * CopilotService — copiloto agêntico (tool-using) do NetX.
 *
 * O modelo recebe um catálogo de ferramentas read-only (COPILOT_TOOLS) e decide
 * quais chamar para responder com DADO REAL do tenant. Conselheiro: só lê,
 * nunca executa ação. Exige um backend com tool-calling (Anthropic / OpenAI-
 * compat) — em CPU local (Ollama) o agêntico fica indisponível.
 */
import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import type { AiAskResponse, AiPendingTest, AiTestStatusResponse } from '@netx/shared';

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
  'coletado. Para latência/caminho ATIVO (ping/traceroute), use executar_teste_rede:',
  'ele apenas DISPARA o teste; o resultado chega ao operador automaticamente em',
  'segundos. NUNCA invente o resultado do teste — só confirme que disparou.',
  'Se a ferramenta retornar um campo "erro", o teste NÃO foi disparado: relate o',
  'erro ao operador e NÃO prometa que o resultado chegará.',
  'Se a pergunta exigir dado que NENHUMA ferramenta fornece (ex.: estado de sessões',
  'BGP), diga claramente que o NetX não coleta esse dado hoje — não invente.',
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
    const context: { pendingTest?: AiPendingTest } = {};
    const executor = buildCopilotExecutor({
      prisma: this.prisma,
      radacct: this.radacct,
      nms: this.nms,
      tenantId,
      authToken,
      context,
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
      pendingTest: context.pendingTest,
    };
  }

  /**
   * Polling do resultado de um teste ativo. Mapeia o JobStatus do NMS pro
   * formato compacto do Nexus. NÃO toca o LLM (render determinístico).
   */
  async testStatus(jobId: string, authToken: string | null): Promise<AiTestStatusResponse> {
    const st = await this.nms.networkTestStatus(jobId, authToken);
    if (st.state === 'completed') {
      const d = st.result?.data;
      if (!st.result?.ok || !d) {
        return { state: 'failed', error: st.result?.error ?? 'teste falhou' };
      }
      return {
        state: 'completed',
        result: {
          testType: d.testType,
          target: d.target,
          source: d.source,
          reachable: d.reachable,
          summary: d.summary,
          hops: d.hops,
          rttMs: d.rttMs,
          lossPct: d.lossPct,
          raw: d.raw,
        },
      };
    }
    if (st.state === 'failed') return { state: 'failed', error: st.error ?? 'teste falhou' };
    if (st.state === 'not_found') return { state: 'not_found' };
    return { state: st.state === 'active' ? 'active' : 'waiting' };
  }
}

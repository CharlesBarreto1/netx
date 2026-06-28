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

const SYSTEM = `Você é o copiloto do NetX — um OPERADOR SÊNIOR de operações de provedor de internet (ISP), não um chatbot. Pensa e fala como um gerente de NOC/operações experiente: direto, técnico, em português (pt-BR), com JULGAMENTO — não despeja números crus, interpreta e aponta o que importa.

CONTEXTO DO NEGÓCIO (NetX)
- SaaS multi-tenant para ISPs (Brasil e Paraguai). Você opera no contexto de UM provedor.
- Módulos: CRM/clientes, contratos/planos, financeiro (faturamento, inadimplência, caixa, a pagar), ordens de serviço (OS), rede (NMS: OLT/ONT/PON, TR-069, RADIUS/PPPoE), estoque, frota, RH, atendimento (WhatsApp).
- Autenticação de assinante: PPPoE no RADIUS (online/offline = sessão ativa). ONT em modo roteador (Huawei/Zyxel); OLT termina a fibra; CTO é a caixa na rua; PON é a porta óptica que agrega vários clientes.

LEITURA TÉCNICA (faixas saudáveis — use pra dar veredito, não só repetir o número)
- RX óptico da ONT: saudável ~ −8 a −25 dBm; abaixo de −27 dBm = crítico (fibra ruim/suja); acima de −8 = luz alta demais. TX típico ~ +1 a +5 dBm.
- "dying-gasp" numa queda = perda de ENERGIA no cliente; "LOS/loss-of-signal" = problema de FIBRA/link.
- Incidente correlacionado por PON/CTO/OLT afetando vários = problema de rede (não do cliente). Cliente isolado offline com RX ruim = fibra dele; offline com energia (dying-gasp) e vizinhos ok = falta de luz na casa.
- Negócio: MRR = receita recorrente mensal (soma dos contratos ativos); ARPU = MRR/contratos ativos; churn > ~3%/mês = atenção; inadimplência vencida alta = risco de caixa.

COMO RACIOCINAR (isto é o que te diferencia de um chatbot)
- Para perguntas AMPLAS ("como está a operação/rede/saúde?", "tem algo preocupante?"), CHAME VÁRIAS ferramentas (ex.: panorama_operacional + incidentes_abertos + metricas_dominio) e entregue um DIAGNÓSTICO: o que está bem, o que está fora do normal (use as faixas acima), e o próximo passo recomendado. Seja proativo em apontar riscos.
- Para diagnóstico de cliente: busque o cliente → diagnostico_conexao → correlacione sessão (online?) + ONT (RX) + incidentes, e CONCLUA a causa provável.
- Sempre que um número for ruim (inadimplência alta, churn alto, RX crítico, incidente grande), DIGA que é ruim e por quê — não deixe o operador interpretar sozinho.

FERRAMENTAS (mapa rápido)
- panorama_operacional: clientes ativos, contratos, MRR, ARPU, inadimplência, OS, incidentes, crescimento. previsao_faturamento: projeção do próximo mês.
- metricas_dominio(dominio): ordens_servico | estoque | frota | vendas | caixa | rh.
- buscar_cliente + diagnostico_conexao: diagnóstico individual. inadimplencia, incidentes_abertos.
- dispositivos_rede + trafego_rede/optica_rede: rede atual (~60min, sem histórico/pico). executar_teste_rede: dispara ping/traceroute (host NOC ou device) — só CONFIRME o disparo; o resultado chega sozinho ao operador. Se a tool retornar "erro", relate o erro e NÃO prometa resultado.

REGRAS
- READ-ONLY e CONSELHEIRO: explica, diagnostica, sugere — NUNCA executa nem altera dado/config.
- Use ferramentas para dado real; NUNCA invente números, nomes ou resultados de teste.
- Se NENHUMA ferramenta cobre (ex.: estado de sessões BGP, latência histórica), diga claramente que o NetX não coleta isso hoje — não invente.`;

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
      // Mais passos p/ raciocínio multi-ferramenta (panorama + incidentes + ...)
      // e resposta mais rica (diagnóstico com julgamento, não só números).
      { system: SYSTEM, maxTokens: 1500, maxSteps: 8 },
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

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

/**
 * Ponte de IA do NMS. O NMS NÃO tem motor/chave própria: delega ao motor de IA
 * do NetX (canal 4). O copiloto monta as evidências e chama
 * `POST /api/v1/ai/complete` no core, repassando o JWT do operador — o core
 * resolve provider/chave/modelo da config do tenant (Configurações › IA) e
 * devolve o texto. Uma IA só, agnóstica de provider, sem chave à parte.
 *
 * Instrução-base: a IA é READ-ONLY. Nunca aplica/comanda ação em equipamento.
 */
const SAFETY = [
  'Você faz parte do NetX NMS, ferramenta de diagnóstico de rede multi-vendor.',
  'Você é ESTRITAMENTE read-only: explica, resume e sugere o que um humano poderia fazer.',
  'Você NUNCA executa, aplica, comanda nem instrui a ferramenta a alterar configuração ou',
  'estado de equipamento. Responda sempre em português (pt-BR).',
].join(' ');

const COPILOT_SYSTEM = `${SAFETY}
Como copiloto de diagnóstico, responda APENAS com base nas evidências fornecidas (métricas,
eventos e configuração coletados). Cite a evidência que sustenta cada afirmação. Se os dados
não permitirem concluir, diga isso claramente em vez de inventar. Seja conciso e técnico.`;

const DIFF_SYSTEM = `${SAFETY}
Resuma a mudança de configuração (diff no formato git) em 1 a 3 frases, focando no QUE mudou
e no provável IMPACTO operacional. Não proponha comandos.`;

interface CompleteResponse {
  text?: string;
  provider?: string;
  model?: string;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  /** Base do core (via gateway) p/ delegar a IA — ex.: http://host.docker.internal:3000 */
  private readonly coreUrl: string | undefined;

  constructor(config: ConfigService<Env, true>) {
    this.coreUrl = config.get('CORE_API_URL', { infer: true })?.replace(/\/$/, '');
    if (!this.coreUrl)
      this.logger.warn(
        'CORE_API_URL ausente — IA (copiloto/resumo de diff) indisponível. ' +
          'A IA do NMS é servida pelo motor do NetX; configure CORE_API_URL.',
      );
  }

  /**
   * IA disponível? Consulta o `/ai/status` do motor do NetX com o token do
   * operador (a disponibilidade é por-tenant). Sem core/token → false.
   */
  async available(token?: string): Promise<boolean> {
    if (!this.coreUrl || !token) return false;
    try {
      const res = await fetch(`${this.coreUrl}/api/v1/ai/status`, {
        headers: { authorization: token },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { available?: boolean };
      return Boolean(data.available);
    } catch (err) {
      this.logger.warn(`status da IA (core) falhou: ${String(err)}`);
      return false;
    }
  }

  /** Resume um diff de config em PT-BR via motor do NetX. Null se indisponível. */
  async summarizeConfigDiff(diff: string, token?: string): Promise<string | null> {
    if (!this.coreUrl || !token) return null;
    try {
      return await this.complete(
        token,
        DIFF_SYSTEM,
        `Diff:\n\n${diff.slice(0, 12000)}`,
        400,
        'nms.diff-summary',
      );
    } catch (err) {
      this.logger.warn(`resumo de diff (core) falhou: ${String(err)}`);
      return null;
    }
  }

  /** Responde uma pergunta de diagnóstico ancorada nas evidências, via motor do NetX. */
  async copilot(evidence: string, question: string, token?: string): Promise<string> {
    if (!this.coreUrl || !token) {
      throw new Error('IA indisponível: o motor de IA do NetX não está acessível (CORE_API_URL).');
    }
    const text = await this.complete(
      token,
      COPILOT_SYSTEM,
      `EVIDÊNCIAS:\n${evidence}\n\nPERGUNTA: ${question}`,
      1200,
      'nms.copilot',
    );
    return text || '(sem resposta)';
  }

  /** Chama o completion do motor do NetX repassando o JWT do operador. */
  private async complete(
    token: string,
    system: string,
    content: string,
    maxTokens: number,
    feature: string,
  ): Promise<string> {
    const res = await fetch(`${this.coreUrl}/api/v1/ai/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: token },
      body: JSON.stringify({
        system,
        messages: [{ role: 'user', content }],
        maxTokens,
        feature,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`motor de IA do NetX respondeu ${res.status}: ${detail}`);
    }
    const data = (await res.json()) as CompleteResponse;
    return data.text?.trim() ?? '';
  }
}

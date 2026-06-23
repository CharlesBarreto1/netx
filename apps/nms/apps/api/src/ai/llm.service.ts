import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../config/env.js';

/** Instrução-base: a IA é READ-ONLY. Nunca aplica/comanda ação em equipamento (AGENTS.md §1). */
const SAFETY = [
  'Você faz parte do NetX NMS, ferramenta de diagnóstico de rede Juniper.',
  'Você é ESTRITAMENTE read-only: explica, resume e sugere o que um humano poderia fazer.',
  'Você NUNCA executa, aplica, comanda nem instrui a ferramenta a alterar configuração ou',
  'estado de equipamento. Responda sempre em português (pt-BR).',
].join(' ');

const COPILOT_SYSTEM = `${SAFETY}
Como copiloto de diagnóstico, responda APENAS com base nas evidências fornecidas (métricas,
eventos e configuração coletados). Cite a evidência que sustenta cada afirmação. Se os dados
não permitirem concluir, diga isso claramente em vez de inventar. Seja conciso e técnico.`;

const DIFF_SYSTEM = `${SAFETY}
Resuma a mudança de configuração (diff no formato git de comandos 'set' do Junos) em 1 a 3
frases, focando no QUE mudou e no provável IMPACTO operacional. Não proponha comandos.`;

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly client: Anthropic | null;
  private readonly summaryModel: string;
  private readonly copilotModel: string;

  constructor(config: ConfigService<Env, true>) {
    const key = config.get('ANTHROPIC_API_KEY', { infer: true });
    this.client = key ? new Anthropic({ apiKey: key }) : null;
    this.summaryModel = config.get('LLM_MODEL_SUMMARY', { infer: true });
    this.copilotModel = config.get('LLM_MODEL_COPILOT', { infer: true });
    if (!this.client)
      this.logger.warn('ANTHROPIC_API_KEY ausente — recursos de IA (4.2/4.3) desativados');
  }

  get available(): boolean {
    return this.client !== null;
  }

  /** Resume um diff de config em PT-BR. Retorna null se a IA estiver indisponível. */
  async summarizeConfigDiff(diff: string): Promise<string | null> {
    if (!this.client) return null;
    try {
      const r = await this.client.messages.create({
        model: this.summaryModel,
        max_tokens: 400,
        system: DIFF_SYSTEM,
        messages: [{ role: 'user', content: `Diff:\n\n${diff.slice(0, 12000)}` }],
      });
      return textOf(r);
    } catch (err) {
      this.logger.warn(`resumo de diff falhou: ${String(err)}`);
      return null;
    }
  }

  /** Responde uma pergunta de diagnóstico ancorada nas evidências fornecidas. */
  async copilot(evidence: string, question: string): Promise<string> {
    if (!this.client) {
      throw new Error('IA indisponível: configure ANTHROPIC_API_KEY');
    }
    const r = await this.client.messages.create({
      model: this.copilotModel,
      max_tokens: 1200,
      system: COPILOT_SYSTEM,
      messages: [{ role: 'user', content: `EVIDÊNCIAS:\n${evidence}\n\nPERGUNTA: ${question}` }],
    });
    return textOf(r) ?? '(sem resposta)';
  }
}

function textOf(message: Anthropic.Message): string | null {
  const parts = message.content.filter((b) => b.type === 'text').map((b) => b.text);
  return parts.length ? parts.join('\n').trim() : null;
}

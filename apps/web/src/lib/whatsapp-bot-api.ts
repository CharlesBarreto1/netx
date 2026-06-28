/**
 * Cliente do chatbot de atendimento (config por tenant).
 *   GET /v1/whatsapp/bot — lê config (com defaults)
 *   PUT /v1/whatsapp/bot — salva config
 */
import { api } from './api';

export type BotMenuAction = 'tool' | 'reply' | 'handoff' | 'ai';

export interface BotMenuOption {
  key: string;
  label: string;
  action: BotMenuAction;
  tool?: string;
  reply?: string;
}

export interface BotConfig {
  enabled: boolean;
  aiEnabled: boolean;
  greeting: string;
  fallbackText: string;
  handoffText: string;
  unknownText: string;
  options: BotMenuOption[];
}

/** Ferramentas de ação disponíveis para uma opção de menu do tipo "tool". */
export const BOT_TOOLS = [
  'segunda_via',
  'minhas_faturas',
  'status_conexao',
  'desbloqueio_confianca',
  'abrir_chamado',
] as const;

export async function getBotConfig() {
  return api.get<BotConfig>('/v1/whatsapp/bot');
}

export async function updateBotConfig(input: BotConfig) {
  return api.put<BotConfig>('/v1/whatsapp/bot', input);
}

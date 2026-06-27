import type { ChatMessage } from './types';

/**
 * Mascaramento de PII antes de enviar a um backend de NUVEM. Defensivo, não
 * criptográfico: reduz vazamento de dado pessoal de cliente quando o fallback
 * sai da infra do tenant. Endereços IP são PRESERVADOS de propósito —
 * diagnóstico de rede depende deles e não são PII de cliente por si só.
 *
 * Cobre os formatos BR/PY mais comuns: CPF, CNPJ, e-mail e telefone.
 */

// CNPJ antes de CPF (CNPJ é superset numérico mais longo).
const CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
// Telefone BR/PY: opcional +55/+595, DDD, 8-9 dígitos com separadores soltos.
const PHONE = /(?:\+?\d{2,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,5}[\s.-]?\d{4}\b/g;

/** Substitui PII por rótulos estáveis. Idempotente. */
export function redact(text: string): string {
  return text
    .replace(CNPJ, '[CNPJ]')
    .replace(CPF, '[CPF]')
    .replace(EMAIL, '[EMAIL]')
    .replace(PHONE, '[TELEFONE]');
}

/** Aplica {@link redact} ao conteúdo de todas as mensagens. */
export function redactMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => ({ ...m, content: redact(m.content) }));
}

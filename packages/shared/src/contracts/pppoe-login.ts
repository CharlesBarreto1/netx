/**
 * Geração de login PPPoE a partir do nome do cliente.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Padrão (decisão 2026-05-22): login = nome + sobrenome, lowercase, sem
 * acento nem espaço. Variações pra contornar colisão:
 *
 *   "Charles Barreto Macedo" →
 *     opção 1: charlesbarreto   (primeiro + segundo)
 *     opção 2: charlesmacedo    (primeiro + último)
 *     opção 3: barretomacedo    (segundo + último)
 *     fallback: sufixo numérico — charlesbarreto2, charlesbarreto3, ...
 *
 * Mesmo algoritmo roda no frontend (preview/chips) e no backend (geração
 * canônica + resolução de unicidade). Por isso vive em @netx/shared.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */

/** Partículas de nome ignoradas (não entram no login). */
const NAME_PARTICLES = new Set([
  'de', 'da', 'do', 'dos', 'das', 'e', 'del', 'la', 'las', 'los', 'di', 'van', 'von',
]);

const PPPOE_MIN = 3;
const PPPOE_MAX = 32;

/** Combining diacritical marks (U+0300–U+036F) — removidos após NFD. */
const DIACRITICS = /[̀-ͯ]/g;

/**
 * Normaliza um token de nome: remove acento, lowercase, e tudo que não for
 * [a-z0-9]. "Barréto" → "barreto".
 */
export function normalizeNameToken(s: string): string {
  return s
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Trunca + valida tamanho mínimo. Retorna null se ficar curto demais. */
function clamp(s: string): string | null {
  const t = s.slice(0, PPPOE_MAX);
  return t.length >= PPPOE_MIN ? t : null;
}

/**
 * Gera a lista ordenada de candidatos de login (sem sufixo numérico).
 * O backend itera essa lista e, se todos colidirem, anexa sufixo via
 * `pppoeLoginWithSuffix`.
 *
 * Retorna [] se o nome não produz nenhum token utilizável.
 */
export function pppoeLoginCandidates(fullName: string): string[] {
  const tokens = (fullName ?? '')
    .trim()
    .split(/\s+/)
    .map(normalizeNameToken)
    .filter((t) => t.length > 0 && !NAME_PARTICLES.has(t));

  const out: string[] = [];
  const push = (raw: string): void => {
    const c = clamp(raw);
    if (c && !out.includes(c)) out.push(c);
  };

  if (tokens.length === 0) return out;
  if (tokens.length === 1) {
    push(tokens[0]);
    return out;
  }

  const first = tokens[0];
  const second = tokens[1];
  const last = tokens[tokens.length - 1];

  // Ordem de preferência idêntica ao exemplo do padrão.
  push(first + second);                      // charlesbarreto
  push(first + last);                        // charlesmacedo
  if (second !== last) push(second + last);  // barretomacedo
  // extras de segurança (raro precisar)
  push(first);
  push(second);

  return out;
}

/** Anexa sufixo numérico a um login base (charlesbarreto + 2 → charlesbarreto2). */
export function pppoeLoginWithSuffix(base: string, n: number): string {
  const suffix = String(n);
  const root = base.slice(0, PPPOE_MAX - suffix.length);
  return `${root}${suffix}`;
}

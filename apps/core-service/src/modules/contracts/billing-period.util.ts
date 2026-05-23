import { Prisma } from '@prisma/client';

/**
 * Helpers puros de cálculo de período/cobrança (sem dependência de DB).
 * Centraliza a aritmética de datas e prorate usada por InvoiceGenerator,
 * ContractsService.changePlan e OverdueScan. Trabalha em UTC pra evitar
 * surpresa de timezone — todas as datas devolvidas têm hora 00:00:00 UTC.
 */

/** Cria Date UTC normalizado (hora 00:00:00). */
function utcDate(year: number, monthZeroBased: number, day: number): Date {
  return new Date(Date.UTC(year, monthZeroBased, day));
}

/** Dias no mês (1-31) de uma data UTC. */
export function daysInUtcMonth(d: Date): number {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * Clampa um `dueDay` (1..31) pro último dia do mês alvo. Ex.: pedir dia 31
 * em fevereiro devolve 28 (ou 29). Evita Date overflow (ex. new Date(2026,1,31)
 * vira 3 de março, surpresa).
 */
function clampDayToMonth(year: number, monthZeroBased: number, day: number): number {
  const last = new Date(Date.UTC(year, monthZeroBased + 1, 0)).getUTCDate();
  return Math.min(day, last);
}

/**
 * Próximo dueDate para POSTPAID:
 *  - Se hoje <= dueDay do mês atual, vence este mês.
 *  - Senão, vence no próximo mês.
 * `dueDay` é validado 1..28 nos DTOs, então clamp é defensivo.
 */
export function nextDueDateFor(dueDay: number, from: Date = new Date()): Date {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  const todayDay = from.getUTCDate();
  if (todayDay <= dueDay) {
    return utcDate(y, m, clampDayToMonth(y, m, dueDay));
  }
  return utcDate(y, m + 1, clampDayToMonth(y, m + 1, dueDay));
}

/**
 * dueDate IMEDIATAMENTE ANTERIOR a `from` para um dado `dueDay`.
 * Usado para descobrir o início do ciclo atual em troca de plano:
 *   cycleStart = previousDueDateFor(dueDay, today)
 *   cycleEnd   = nextDueDateFor(dueDay, today)
 *   totalDays  = cycleEnd - cycleStart
 */
export function previousDueDateFor(dueDay: number, from: Date = new Date()): Date {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  const todayDay = from.getUTCDate();
  if (todayDay > dueDay) {
    return utcDate(y, m, clampDayToMonth(y, m, dueDay));
  }
  return utcDate(y, m - 1, clampDayToMonth(y, m - 1, dueDay));
}

/** Avança 1 mês mantendo o dia (com clamp pro último dia do mês alvo). */
export function advanceOneMonth(current: Date): Date {
  const y = current.getUTCFullYear();
  const m = current.getUTCMonth();
  const d = current.getUTCDate();
  return utcDate(y, m + 1, clampDayToMonth(y, m + 1, d));
}

/** Diferença em dias inteiros entre duas datas UTC (b - a). */
export function daysBetween(a: Date, b: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const aMid = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const bMid = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((bMid - aMid) / MS_PER_DAY);
}

/**
 * Calcula valor proporcional: monthlyValue * (days / totalDays).
 * Arredonda a 2 casas (HALF_UP). Trabalha em Prisma.Decimal pra preservar
 * precisão financeira — nunca em Number.
 *
 * Edge cases:
 *  - `days >= totalDays` → devolve o valor cheio (sem ajuste).
 *  - `days <= 0` → devolve 0.
 */
export function prorate(
  monthlyValue: Prisma.Decimal | string | number,
  days: number,
  totalDays: number,
): Prisma.Decimal {
  const value = new Prisma.Decimal(monthlyValue);
  if (totalDays <= 0 || days <= 0) return new Prisma.Decimal(0);
  if (days >= totalDays) return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return value
    .mul(days)
    .div(totalDays)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Próximo vencimento PREPAID: avança 1 mês desde uma data âncora, clampando
 * pro último dia do mês curto (ex.: ativado dia 31, fevereiro paga dia 28).
 * `monthsAhead` permite passar 2, 3 etc se precisar.
 */
export function nextPrepaidDate(
  anchor: Date,
  monthsAhead: number = 1,
): Date {
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth();
  const d = anchor.getUTCDate();
  return utcDate(y, m + monthsAhead, clampDayToMonth(y, m + monthsAhead, d));
}

/**
 * Resolve quantos dias o sistema dá de tolerância pra suspender contrato
 * inadimplente. Override por contrato > default do plano > fallback 5.
 */
export function resolveBlockAfterDays(
  contract: { blockAfterDays: number | null },
  plan: { blockAfterDays: number } | null | undefined,
): number {
  if (contract.blockAfterDays !== null && contract.blockAfterDays !== undefined) {
    return contract.blockAfterDays;
  }
  if (plan && typeof plan.blockAfterDays === 'number') {
    return plan.blockAfterDays;
  }
  return 5;
}

/** Referência textual canônica de fatura — por tipo e mês de vencimento. */
export const InvoiceReference = {
  regular: (due: Date): string =>
    `Mensalidade ${pad2(due.getUTCMonth() + 1)}/${due.getUTCFullYear()}`,
  initialPostpaid: (due: Date): string =>
    `Mensalidade inicial ${pad2(due.getUTCMonth() + 1)}/${due.getUTCFullYear()}`,
  initialPrepaid: (due: Date): string =>
    `Pré-pago ${pad2(due.getUTCDate())}/${pad2(due.getUTCMonth() + 1)}/${due.getUTCFullYear()}`,
  proration: (today: Date): string =>
    `Ajuste de plano ${pad2(today.getUTCDate())}/${pad2(today.getUTCMonth() + 1)}/${today.getUTCFullYear()}`,
  credit: (today: Date): string =>
    `Crédito de plano ${pad2(today.getUTCDate())}/${pad2(today.getUTCMonth() + 1)}/${today.getUTCFullYear()}`,
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

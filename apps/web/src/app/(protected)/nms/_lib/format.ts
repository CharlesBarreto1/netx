/**
 * Formatação/cores dos painéis do NMS. Porta os helpers de
 * `apps/nms/apps/web/src/format.ts`, trocando as CSS vars do SPA standalone
 * por classes Tailwind do design system do NetX (claro/escuro).
 */

/** Formata bits/s em b/k/M/G. */
export function bps(v: number | string | null): string {
  if (v == null) return '—';
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
  let n = Number(v);
  if (!Number.isFinite(n)) return '—';
  let u = 0;
  while (n >= 1000 && u < units.length - 1) {
    n /= 1000;
    u++;
  }
  return `${n.toFixed(n < 10 && u > 0 ? 1 : 0)} ${units[u]}`;
}

/** Formata speed em G/M. */
export function speed(v: number | null): string {
  if (v == null) return '—';
  if (v >= 1e9) return `${Math.round(v / 1e9)}G`;
  if (v >= 1e6) return `${Math.round(v / 1e6)}M`;
  return `${v}`;
}

const OK = 'text-emerald-600 dark:text-emerald-400';
const WARN = 'text-amber-600 dark:text-amber-400';
const DANGER = 'text-red-600 dark:text-red-400';
const MUTED = 'text-slate-400 dark:text-slate-500';

/** Cor de saúde para luz óptica RX/TX (dBm): verde ok, amarelo limítrofe, vermelho crítico. */
export function opticalClass(dbm: number | string | null): string {
  if (dbm == null) return MUTED;
  const v = Number(dbm);
  if (!Number.isFinite(v)) return MUTED;
  if (v < -28 || v > 1) return DANGER;
  if (v < -20 || v > -1) return WARN;
  return OK;
}

/** Cor de temperatura de componente (°C). */
export function tempClass(c: number | null): string {
  if (c == null) return MUTED;
  if (c >= 70) return DANGER;
  if (c >= 55) return WARN;
  return OK;
}

/** Classe de background pro "dot" de status oper de interface. */
export function statusDotClass(s: string): string {
  if (s === 'up') return 'bg-emerald-500';
  if (s === 'down') return 'bg-red-500';
  return 'bg-slate-400';
}

/** Classe de background pro "dot" de severidade de evento. */
export function severityDotClass(s: string): string {
  if (s === 'critical' || s === 'error') return 'bg-red-500';
  if (s === 'warning') return 'bg-amber-500';
  return 'bg-sky-500';
}

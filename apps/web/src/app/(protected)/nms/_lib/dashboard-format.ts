/**
 * Formatação do painel do NOC. Separado de `format.ts` (que serve as abas de
 * device) porque aqui o assunto é agregado — variações contra baseline,
 * contagens e faixas — e não leitura de interface.
 */

import type { DashboardAlarmSeverity } from '@/lib/nms-dashboard-api';

/** Inteiro com separador de milhar pt-BR. `—` quando desconhecido. */
export function count(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString('pt-BR');
}

/**
 * Variação percentual assinada. Devolve `null` quando não há baseline — a UI
 * então omite o delta em vez de exibir "0%", que afirmaria estabilidade que
 * ninguém mediu.
 */
export function deltaLabel(pct: number | null): string | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

/**
 * Cor do delta. `upIsGood` inverte a leitura: mais sessões PPPoE é bom, mais
 * ONTs em LOS é ruim — a mesma seta pra cima significa coisas opostas.
 * Variação pequena fica neutra pra não pintar ruído de vermelho.
 *
 * `'neutral'` é um terceiro caso, não um sinônimo de `true`: em tráfego
 * agregado nenhuma direção é boa — um pico de 60% é tão suspeito quanto uma
 * queda de 60%. Pintar a subida de verde diria ao operador que está tudo bem
 * exatamente quando o alarme TRAFFIC_SPIKE está disparando.
 */
export function deltaClass(pct: number | null, upIsGood: boolean | 'neutral' = true): string {
  if (pct == null || Math.abs(pct) < 1) return 'text-text-subtle';
  if (upIsGood === 'neutral') return 'text-text';
  const good = pct > 0 === upIsGood;
  return good ? 'text-success' : 'text-danger';
}

/** Classes (fundo + texto) da pílula de severidade. */
export function severityPillClass(s: DashboardAlarmSeverity): string {
  if (s === 'CRITICAL') return 'bg-danger-muted text-danger';
  if (s === 'WARNING') return 'bg-warning-muted text-warning';
  return 'bg-accent-muted text-accent';
}

/** Cor de texto para RX óptico (dBm) segundo os limiares do tenant. */
export function rxClass(dbm: number | null, low: number, high: number): string {
  if (dbm == null) return 'text-text-subtle';
  if (dbm < low || dbm > high) return 'text-danger';
  // Margem de 2 dB antes do limiar — a faixa "ainda ok, mas de olho".
  if (dbm < low + 2 || dbm > high - 2) return 'text-warning';
  return 'text-success';
}

/** "há 3 min" — idade legível de um instante ISO. */
export function ago(iso: string | null): string {
  if (!iso) return 'nunca';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

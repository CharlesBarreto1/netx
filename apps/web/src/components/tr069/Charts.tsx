'use client';

/**
 * Chart kit do módulo TR-069 — SVG/CSS na mão (o NetX não usa lib de gráficos;
 * segue a convenção de ContractUsageChart/RxSparkline). Reproduz os gráficos do
 * handoff "Gerenciador de CPEs": sparkline, line chart, gauge semicircular,
 * heatmap de barras, mini bar chart, grade de status e barras de RSSI.
 *
 * Cores seguem os tokens do design (status verde/âmbar/vermelho + azul accent).
 */
import { useId } from 'react';

export const TR069_COLORS = {
  ok: '#12b886',
  warn: '#f59f00',
  crit: '#fa5252',
  blue: '#1565ff',
  blueChart: '#3b82f6',
  purple: '#7c3aed',
} as const;

export type Severity = 'ok' | 'warn' | 'crit';

export function sevColor(s: Severity): string {
  return s === 'crit' ? TR069_COLORS.crit : s === 'warn' ? TR069_COLORS.warn : TR069_COLORS.ok;
}

// ── Sparkline (linha + área com gradiente) ───────────────────────────────────
export function Sparkline({
  data,
  color = TR069_COLORS.blueChart,
  width = 66,
  height = 22,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const gid = useId();
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const rng = max - min || 1;
  const pts = data.map(
    (v, i) => [(i / (data.length - 1)) * width, height - 2 - ((v - min) / rng) * (height - 4)] as const,
  );
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${d} L ${width} ${height} L 0 ${height} Z`;
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Line chart (multi-série, grid, área com gradiente, dot no último ponto) ──
export interface LineSeries {
  data: number[];
  color: string;
  fill?: boolean;
}
export function LineChart({
  series,
  width = 320,
  height = 120,
  min,
  max,
  className,
}: {
  series: LineSeries[];
  width?: number;
  height?: number;
  min?: number;
  max?: number;
  className?: string;
}) {
  const gid = useId();
  const pad = { t: 8, r: 6, b: 16, l: 6 };
  const all = series.flatMap((s) => s.data);
  const hi = max ?? (all.length ? Math.max(...all) : 1);
  const lo = min ?? (all.length ? Math.min(...all) : 0);
  const rng = hi - lo || 1;
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const x = (i: number, len: number) => pad.l + (len > 1 ? (i / (len - 1)) * iw : 0);
  const y = (v: number) => pad.t + ih - ((v - lo) / rng) * ih;
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ display: 'block' }}
      className={className}
    >
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <line
          key={f}
          x1={pad.l}
          x2={width - pad.r}
          y1={pad.t + ih * f}
          y2={pad.t + ih * f}
          stroke="rgba(255,255,255,.07)"
          strokeWidth={1}
        />
      ))}
      {series.map((s, si) => {
        const d = s.data.map((v, i) => `${i ? 'L' : 'M'}${x(i, s.data.length).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
        const area = `${d} L ${x(s.data.length - 1, s.data.length)} ${pad.t + ih} L ${pad.l} ${pad.t + ih} Z`;
        const id = `${gid}-${si}`;
        return (
          <g key={si}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            {s.fill !== false && <path d={area} fill={`url(#${id})`} />}
            <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {s.data.length > 0 && (
              <circle cx={x(s.data.length - 1, s.data.length)} cy={y(s.data[s.data.length - 1])} r={3} fill={s.color} />
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Gauge semicircular (track + arco colorido + valor central) ───────────────
export function Gauge({
  value,
  min,
  max,
  color = TR069_COLORS.blue,
  display,
  size = 104,
}: {
  value: number;
  min: number;
  max: number;
  color?: string;
  display: string;
  size?: number;
}) {
  const cx = size / 2;
  const cy = size * 0.86;
  const r = size * 0.4;
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const polar = (deg: number): [number, number] => {
    const a = ((deg - 180) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const arc = (a: number, b: number) => {
    const [x1, y1] = polar(a);
    const [x2, y2] = polar(b);
    const lg = b - a > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${lg} 1 ${x2} ${y2}`;
  };
  return (
    <svg
      width={size}
      height={size * 0.74}
      viewBox={`0 0 ${size} ${size * 0.74}`}
      style={{ display: 'block', margin: '0 auto' }}
    >
      <path d={arc(0, 180)} fill="none" stroke="#eef1f6" strokeWidth={9} strokeLinecap="round" />
      <path d={arc(0, 180 * frac || 0.001)} fill="none" stroke={color} strokeWidth={9} strokeLinecap="round" />
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        style={{ font: "600 19px 'IBM Plex Mono', ui-monospace, monospace", fill: '#1f2733' }}
      >
        {display}
      </text>
    </svg>
  );
}

// ── Heatmap de barras (ocupação de canais WiFi) ──────────────────────────────
export function BarHeatmap({
  bars,
  height = 90,
}: {
  bars: Array<{ label: string; value: number; active?: boolean }>;
  height?: number;
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {bars.map((b) => {
        const h = Math.max(4, (b.value / max) * (height - 18));
        const color = b.active ? TR069_COLORS.crit : b.value / max > 0.66 ? TR069_COLORS.warn : TR069_COLORS.blueChart;
        return (
          <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
            <div className="w-full rounded-t" style={{ height: h, background: color, opacity: b.active ? 1 : 0.8 }} />
            <span className="font-mono text-[10px] text-slate-400">{b.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Mini bar chart (reboots por dia) ─────────────────────────────────────────
export function MiniBars({
  data,
  color = TR069_COLORS.blue,
  height = 56,
}: {
  data: number[];
  color?: string;
  height?: number;
}) {
  const max = Math.max(1, ...data);
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-t"
          style={{ height: Math.max(2, (v / max) * height), background: color, opacity: v === 0 ? 0.25 : 1 }}
          title={String(v)}
        />
      ))}
    </div>
  );
}

// ── Grade de status (disponibilidade 30 dias) ────────────────────────────────
export function StatusGrid({ days }: { days: Severity[] }) {
  return (
    <div className="grid grid-cols-10 gap-1">
      {days.map((s, i) => (
        <div key={i} className="aspect-square rounded-[3px]" style={{ background: sevColor(s) }} title={`Dia ${i + 1}`} />
      ))}
    </div>
  );
}

// ── Barras de RSSI (4 níveis por dispositivo) ────────────────────────────────
export function RssiBars({ rssi }: { rssi: number | null }) {
  if (rssi === null) return <span className="text-slate-400">—</span>;
  const level = rssi >= -55 ? 4 : rssi >= -65 ? 3 : rssi >= -72 ? 2 : 1;
  const col = level >= 3 ? TR069_COLORS.ok : level === 2 ? TR069_COLORS.warn : TR069_COLORS.crit;
  return (
    <span className="inline-flex items-end gap-0.5" style={{ height: 14 }}>
      {[6, 9, 12, 15].map((hh, i) => (
        <span
          key={i}
          style={{ width: 3, height: hh, borderRadius: 1, background: i < level ? col : '#dfe4ec' }}
        />
      ))}
    </span>
  );
}

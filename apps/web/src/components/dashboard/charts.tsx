'use client';

/**
 * Primitivos de gráfico do dashboard cockpit (design_handoff_netx_shell §5-7).
 * Tudo SVG/CSS, sem lib externa, e TOKENIZADO: a cor vem por classe Tailwind
 * (`text-accent`, `text-success`…) e o SVG pinta com `currentColor`. Assim
 * respeita o tema (dark/light) automaticamente — diferente do chart-kit antigo
 * em tr069/Charts.tsx, que tem hex hardcoded.
 */

import { useId } from 'react';

import { cn } from '@/lib/cn';

// ── Donut (conic-gradient) — saúde da rede ────────────────────────────────
export interface DonutSegment {
  value: number; // proporção (0-100)
  className: string; // classe de cor de texto (vira a cor do segmento)
}

export function HealthDonut({
  segments,
  centerValue,
  centerSub,
  size = 128,
}: {
  segments: DonutSegment[];
  centerValue: string;
  centerSub?: string;
  size?: number;
}) {
  // Cada fatia tem a própria cor → camadas conic sobrepostas (uma por segmento).
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {segments.map((seg, i) => {
        const before = segments.slice(0, i).reduce((s, x) => s + x.value, 0);
        const start = (before / total) * 100;
        const end = ((before + seg.value) / total) * 100;
        return (
          <div
            key={i}
            className={cn('absolute inset-0 rounded-full', seg.className)}
            style={{
              background: `conic-gradient(transparent 0 ${start}%, currentColor ${start}% ${end}%, transparent ${end}% 100%)`,
            }}
          />
        );
      })}
      {/* furo central */}
      <div
        className="absolute rounded-full bg-card"
        style={{ inset: size * 0.11 }}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-xl font-semibold text-text-strong">{centerValue}</span>
        {centerSub && <span className="text-2xs text-text-subtle">{centerSub}</span>}
      </div>
    </div>
  );
}

// ── Sparkline de área ─────────────────────────────────────────────────────
export function Sparkline({
  data,
  className = 'text-accent',
  height = 56,
}: {
  data: number[];
  className?: string;
  height?: number;
}) {
  const id = useId();
  const w = 240;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = height - ((v - min) / range) * (height - 6) - 3;
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${w} ${height} L0 ${height} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className={cn('w-full', className)}
      style={{ height }}
    >
      <defs>
        <linearGradient id={`spk-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spk-${id})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ── Gráfico de linhas (1-2 séries) ────────────────────────────────────────
export interface LineSeries {
  data: number[];
  className: string;
  dashed?: boolean;
}

export function LineChart({ series, height = 120 }: { series: LineSeries[]; height?: number }) {
  const w = 320;
  const all = series.flatMap((s) => s.data);
  const max = Math.max(...all);
  const min = Math.min(...all);
  const range = max - min || 1;
  const toPath = (data: number[]) =>
    data
      .map((v, i) => {
        const x = (i / (data.length - 1)) * w;
        const y = height - ((v - min) / range) * (height - 8) - 4;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
    >
      {series.map((s, i) => (
        <path
          key={i}
          d={toPath(s.data)}
          fill="none"
          className={s.className}
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray={s.dashed ? '3 3' : undefined}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

// ── Barras verticais ──────────────────────────────────────────────────────
export function BarChart({
  data,
  labels,
  highlightLast = true,
}: {
  data: number[];
  labels?: string[];
  highlightLast?: boolean;
}) {
  const max = Math.max(...data) || 1;
  return (
    <div className="flex items-end gap-1" style={{ height: 96 }}>
      {data.map((v, i) => {
        const last = i === data.length - 1;
        return (
          <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
            <div
              className={cn(
                'w-full rounded-t-sm',
                highlightLast && last ? 'bg-accent' : 'bg-accent/40',
              )}
              style={{ height: `${(v / max) * 80}px` }}
            />
            {labels && <span className="font-mono text-[9px] text-text-subtle">{labels[i]}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── Barra de progresso horizontal ─────────────────────────────────────────
export function Progress({
  value,
  className = 'text-success',
}: {
  value: number; // 0-100
  className?: string;
}) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
      <div
        className={cn('h-full rounded-full bg-current', className)}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

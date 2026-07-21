'use client';

/**
 * Peças de leitura do painel do NOC.
 *
 * Formas escolhidas pelo trabalho do dado, não por gosto: número de destaque
 * (com delta contra baseline) quando a resposta É um número; barra empilhada
 * quando é composição de um todo; sparkline quando é tendência. Nada de
 * gráfico de uma barra só nem pizza de duas fatias.
 *
 * Cor vem por token (`text-success`, `text-danger`…) e o SVG pinta com
 * `currentColor`, então claro/escuro funcionam sozinhos — mesmo padrão de
 * `components/dashboard/charts.tsx`.
 */
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { count, deltaClass, deltaLabel } from '../_lib/dashboard-format';

/**
 * Número de destaque com delta opcional.
 *
 * `value` null significa DESCONHECIDO (ex.: NMS fora do ar) e rende "—" com a
 * nota de indisponibilidade — nunca 0, que se leria como "rede parada".
 */
export function StatTile({
  label,
  value,
  unit,
  deltaPct,
  upIsGood = true,
  baselineNote,
  tone = 'default',
  children,
}: {
  label: string;
  value: string | number | null;
  unit?: string;
  deltaPct?: number | null;
  /** `'neutral'` quando nenhuma direção é boa (ver `deltaClass`). */
  upIsGood?: boolean | 'neutral';
  baselineNote?: string;
  tone?: 'default' | 'danger' | 'warning' | 'success';
  children?: ReactNode;
}) {
  const delta = deltaLabel(deltaPct ?? null);
  const toneClass =
    tone === 'danger'
      ? 'text-danger'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'success'
          ? 'text-success'
          : 'text-text-strong';

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4">
      <span className="text-xs font-medium text-text-muted">{label}</span>
      <div className="flex items-baseline gap-2">
        {/* Figuras proporcionais (sem tabular-nums): número grande com
            largura de dígito fixa fica frouxo. */}
        <span className={cn('text-2xl font-semibold', toneClass)}>
          {value === null ? '—' : typeof value === 'number' ? count(value) : value}
        </span>
        {unit && <span className="text-xs text-text-subtle">{unit}</span>}
        {delta && (
          <span className={cn('text-xs font-medium', deltaClass(deltaPct ?? null, upIsGood))}>
            {delta}
          </span>
        )}
      </div>
      {baselineNote && <span className="text-2xs text-text-subtle">{baselineNote}</span>}
      {children}
    </div>
  );
}

/**
 * Sparkline de área — tendência, sem eixo.
 *
 * Série de valor único: sem legenda (o título do card já diz o que é) e sem
 * rótulo por ponto. O valor exato mora no número de destaque acima e na
 * tabela do bloco; aqui a forma é o recado.
 */
export function Sparkline({
  data,
  className = 'text-accent',
  height = 48,
}: {
  data: number[];
  className?: string;
  height?: number;
}) {
  if (data.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded-md bg-surface-muted text-2xs text-text-subtle"
        style={{ height }}
      >
        coletando histórico…
      </div>
    );
  }
  const w = 240;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = height - ((v - min) / range) * (height - 6) - 3;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  const line = pts.join(' ');
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className={cn('w-full', className)}
      style={{ height }}
      role="img"
      aria-label="Tendência da última janela coletada"
    >
      <path d={`${line} L${w} ${height} L0 ${height} Z`} fill="currentColor" fillOpacity="0.1" />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export interface StackSegment {
  label: string;
  value: number;
  /** Classe de COR DE FUNDO do segmento (ex.: `bg-success`). */
  className: string;
}

/**
 * Barra empilhada horizontal — composição de um todo (faixas de RX, estados
 * de ONT). Segmentos separados por 2px da cor da superfície: o vão é o que
 * separa, não uma borda desenhada em volta.
 *
 * A legenda está SEMPRE presente (≥2 séries) e carrega o valor — assim a
 * identidade nunca depende só da cor.
 */
export function StackedBar({ segments }: { segments: StackSegment[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total === 0) {
    return <p className="text-xs text-text-subtle">Sem leituras no período.</p>;
  }
  const visible = segments.filter((s) => s.value > 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-muted">
        {visible.map((s, i) => (
          <div
            key={s.label}
            className={cn('h-full', s.className)}
            style={{
              width: `${(s.value / total) * 100}%`,
              marginLeft: i === 0 ? undefined : 2,
            }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5 text-2xs text-text-muted">
            <span className={cn('size-2 rounded-full', s.className)} aria-hidden />
            {s.label}
            <span className="font-medium text-text tabular-nums">{count(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Medidor de razão contra um limite (ex.: online/total). */
export function Meter({ value, total, className = 'bg-success' }: { value: number; total: number; className?: string }) {
  const pct = total === 0 ? 0 : (value / total) * 100;
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
      role="meter"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={cn('h-full rounded-full', className)} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

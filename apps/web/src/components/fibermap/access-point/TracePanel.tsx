'use client';

/**
 * TracePanel — painel lateral do trace de capilar (FM-4, spec §8.4).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Lista de eventos com distância/perda acumuladas (formato do tooltip do
 * print 3 do Tomodat), ramificação de splitter aninhada (downstream) ou
 * "via OUT n" (caminho normalizado), seletor de λ e botão "Ver no mapa"
 * (highlight MultiLineString no estúdio).
 */
import { MapPinned, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { InlineLoader } from '@/components/ui/Spinner';
import {
  FIBERMAP_COLOR_HEX,
  type FibermapColorCode,
  type FibermapTraceEvent,
  type FibermapTraceResponse,
  type FibermapTraceWavelength,
} from '@/lib/fibermap-api';

const WAVELENGTHS: FibermapTraceWavelength[] = [1310, 1490, 1550];

const fmtM = (v: number) => `${v.toFixed(2)} m`;
const fmtDb = (v: number) => `${v.toFixed(2)} dB`;

function colorDot(color?: string) {
  if (!color) return null;
  const hex =
    color in FIBERMAP_COLOR_HEX
      ? FIBERMAP_COLOR_HEX[color as FibermapColorCode]
      : '#64748b';
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-border"
      style={{ backgroundColor: hex }}
    />
  );
}

function EventRow({ ev }: { ev: FibermapTraceEvent }) {
  const t = useTranslations('fibermap');

  let main: ReactNode;
  switch (ev.kind) {
    case 'PORT':
      main = (
        <span className="truncate">
          <span className="font-medium">{ev.deviceName}</span>
          {ev.portLabel ? ` · ${ev.portLabel}` : ''}
        </span>
      );
      break;
    case 'CONNECTOR':
    case 'FUSION':
      main = (
        <span className="truncate">
          {ev.kind === 'FUSION' ? t('ap.trace.fusion') : t('ap.trace.connector')}
          {ev.lossDb !== undefined ? ` · ${fmtDb(ev.lossDb)}` : ''}
        </span>
      );
      break;
    case 'FIBER':
      main = (
        <span className="flex min-w-0 items-center gap-1.5">
          {colorDot(ev.fiberColor)}
          <span className="truncate">
            {t('ap.trace.fiberLine', {
              cable: ev.cableName ?? '?',
              n: ev.fiberNumber ?? 0,
              tube: ev.tubeNumber ?? 0,
            })}
            {ev.lengthM !== undefined ? ` · ${fmtM(ev.lengthM)}` : ''}
          </span>
        </span>
      );
      break;
    case 'SPLITTER':
      main = (
        <span className="truncate">
          <span className="font-medium">{ev.deviceName}</span>
          {ev.ratio ? ` ${ev.ratio}` : ''}
          {ev.lossDb !== undefined ? ` · ${fmtDb(ev.lossDb)}` : ''}
          {ev.branchTaken !== undefined
            ? ` · ${t('ap.trace.splitterVia', { n: ev.branchTaken, total: ev.branchCount ?? 0 })}`
            : ''}
        </span>
      );
      break;
    case 'END':
      main = (
        <span className="italic text-text-muted">
          {ev.endReason === 'LOOP' ? t('ap.trace.loop') : t('ap.trace.end')}
        </span>
      );
      break;
  }

  return (
    <li className="flex flex-col gap-0.5 border-b border-border/60 px-3 py-2 text-xs last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        {main}
        <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-text-muted">
          {fmtM(ev.cumDistanceM)} · {fmtDb(ev.cumLossDb)}
        </span>
      </div>
      {ev.elementName && (
        <span className="text-[11px] text-text-muted">{ev.elementName}</span>
      )}
      {ev.branches && ev.branches.length > 0 && (
        <div className="mt-1 flex flex-col gap-1.5">
          {ev.branches.map((b) => (
            <div
              key={b.outPortNumber}
              className="rounded-md border border-border/70 bg-surface-muted/60"
            >
              <div className="border-b border-border/60 px-3 py-1 text-[11px] font-semibold text-text-muted">
                {b.outPortLabel ?? t('ap.trace.branch', { n: b.outPortNumber })}
              </div>
              <ul>
                {b.events.map((be, i) => (
                  <EventRow key={i} ev={be} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

export interface TracePanelProps {
  trace: FibermapTraceResponse | null;
  loading: boolean;
  wavelength: FibermapTraceWavelength;
  onChangeWavelength: (w: FibermapTraceWavelength) => void;
  onViewOnMap: () => void;
  onClose: () => void;
}

export function TracePanel({
  trace,
  loading,
  wavelength,
  onChangeWavelength,
  onViewOnMap,
  onClose,
}: TracePanelProps) {
  const t = useTranslations('fibermap');
  const tc = useTranslations('common');

  return (
    <aside className="absolute inset-y-0 right-0 z-[600] flex w-[360px] max-w-full flex-col border-l border-border bg-surface shadow-xl print:hidden">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-text">
          {t('ap.trace.title')}
        </h2>
        <label className="flex items-center gap-1 text-[11px] text-text-muted">
          {t('ap.trace.wavelength')}
          <select
            className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs text-text outline-none focus:border-accent"
            value={wavelength}
            onChange={(e) =>
              onChangeWavelength(Number(e.target.value) as FibermapTraceWavelength)
            }
            disabled={loading}
          >
            {WAVELENGTHS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <Button size="xs" variant="ghost" onClick={onClose} title={tc('close')}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-24 items-center justify-center">
            <InlineLoader label={t('ap.trace.loading')} />
          </div>
        ) : !trace || trace.path.length === 0 ? (
          <p className="px-3 py-4 text-xs text-text-muted">{t('ap.trace.empty')}</p>
        ) : (
          <ul>
            {trace.path.map((ev, i) => (
              <EventRow key={i} ev={ev} />
            ))}
          </ul>
        )}
      </div>

      {trace && !loading && (
        <footer className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
          <span className="text-xs font-medium text-text">
            {t('ap.trace.total', {
              distance: fmtM(trace.maxDistanceM),
              loss: fmtDb(trace.maxLossDb),
            })}
          </span>
          <Button
            size="xs"
            variant="outline"
            onClick={onViewOnMap}
            disabled={trace.mapGeometry.coordinates.length === 0}
          >
            <MapPinned className="mr-1 h-3.5 w-3.5" />
            {t('ap.trace.viewOnMap')}
          </Button>
        </footer>
      )}
    </aside>
  );
}

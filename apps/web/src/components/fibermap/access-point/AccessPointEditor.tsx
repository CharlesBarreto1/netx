'use client';

/**
 * AccessPointEditor — editor de emendas SVG (Tela 2 · FM-3, spec §8).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Réplica funcional dos prints 2/3 do Tomodat:
 *   - cabos como blocos com casca na cor do cabo, FAIXAS DE TUBO com número
 *     sempre visível (tubos brancos são ambíguos — spec §2) e uma pílula
 *     numerada por ponta de fibra, na cor real (BRANCA com contorno);
 *   - splitter como trapézio com IN verde e OUTs numerados; DIO/OLT retângulo;
 *   - fusões como Béziers com GRADIENTE entre as cores das fibras e ícone de
 *     tesoura no meio (clique → editar perda / desfazer);
 *   - fibra EXPRESSA (passa sem corte) esmaecida com botão de tesoura (corte);
 *   - fundir: clique na ponta A (pulsa) → clique na B (PORT+PORT vira
 *     CONNECTOR, senão FUSION);
 *   - pan (drag) + zoom (wheel), export PNG, imprimir, fusão em sequência.
 *
 * Toda mutação → mutate() do SWR (payload é a fonte única — spec §6).
 */
import { Printer, ImageDown, Layers2, PlusSquare, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { InlineLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  FIBERMAP_COLOR_HEX,
  fibermapApi,
  type FibermapAccessPoint,
  type FibermapApConnection,
  type FibermapApConnectionSide,
  type FibermapColorCode,
  type FibermapEndpointRef,
} from '@/lib/fibermap-api';

import { StudioConfirm, StudioModal } from '../studio/StudioModal';
import { BulkFuseModal } from './BulkFuseModal';
import { DeviceCreateModal } from './DeviceCreateModal';
import {
  buildLayout,
  connectionPath,
  fiberAnchorId,
  HEADER_H,
  pathMidpoint,
  portAnchorId,
  ROW_H,
} from './layout';

const PILL_R = 9;

function hexOf(color: string | undefined): string {
  return color && color in FIBERMAP_COLOR_HEX
    ? FIBERMAP_COLOR_HEX[color as FibermapColorCode]
    : '#64748b';
}
const isWhite = (c?: string) => c === 'BRANCA';

function sideAnchorId(s: FibermapApConnectionSide): string {
  return s.type === 'PORT' ? portAnchorId(s.portId!) : fiberAnchorId(s.fiberId!, s.side!);
}

export function AccessPointEditor({ elementId }: { elementId: string }) {
  const t = useTranslations('fibermap');
  const tc = useTranslations('common');
  const {
    data: ap,
    error,
    mutate,
    isValidating,
  } = useSWR<FibermapAccessPoint>(`/v1/fibermap/elements/${elementId}/access-point`);

  const layout = useMemo(() => (ap ? buildLayout(ap) : null), [ap]);

  // ── Pan/zoom ────────────────────────────────────────────────────────────
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const dragRef = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // ── Interação ───────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<FibermapEndpointRef | null>(null);
  const [connMenu, setConnMenu] = useState<FibermapApConnection | null>(null);
  const [lossDraft, setLossDraft] = useState('');
  const [undoConn, setUndoConn] = useState<FibermapApConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [deviceModal, setDeviceModal] = useState(false);
  const [bulkModal, setBulkModal] = useState(false);
  const [deviceDeleting, setDeviceDeleting] = useState<{ id: string; name: string } | null>(null);

  const friendly = useCallback(
    (err: unknown) => (err instanceof ApiError ? err.friendlyMessage : tc('error')),
    [tc],
  );

  const refresh = useCallback(() => void mutate(), [mutate]);

  // Clique numa ponta livre: seleciona / conecta (spec §8.1).
  async function clickEndpoint(ref: FibermapEndpointRef) {
    if (!selected) {
      setSelected(ref);
      return;
    }
    const sameFiberEnd =
      selected.type === 'FIBER_END' &&
      ref.type === 'FIBER_END' &&
      selected.fiberId === ref.fiberId &&
      selected.side === ref.side;
    const samePort =
      selected.type === 'PORT' && ref.type === 'PORT' && selected.portId === ref.portId;
    if (sameFiberEnd || samePort) {
      setSelected(null);
      return;
    }
    const kind = selected.type === 'PORT' && ref.type === 'PORT' ? 'CONNECTOR' : 'FUSION';
    setBusy(true);
    try {
      await fibermapApi.createConnection({
        elementId,
        kind,
        a: selected,
        b: ref,
      });
      toast.success(t('ap.fused'));
      setSelected(null);
      refresh();
    } catch (err) {
      toast.error(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  async function cutFiber(fiberId: string) {
    setBusy(true);
    try {
      await fibermapApi.cutFiber(fiberId, elementId);
      toast.success(t('ap.cutDone'));
      refresh();
    } catch (err) {
      toast.error(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  async function undoCut(cutId: string) {
    setBusy(true);
    try {
      await fibermapApi.deleteCut(cutId);
      toast.success(t('ap.cutUndone'));
      refresh();
    } catch (err) {
      toast.error(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveLoss() {
    if (!connMenu) return;
    const v = lossDraft.trim();
    const loss = v === '' ? null : Number(v.replace(',', '.'));
    if (loss !== null && !(loss >= 0 && loss <= 60)) {
      toast.error(t('ap.lossInvalid'));
      return;
    }
    setBusy(true);
    try {
      await fibermapApi.updateConnection(connMenu.id, { lossDb: loss });
      toast.success(t('ap.lossSaved'));
      setConnMenu(null);
      refresh();
    } catch (err) {
      toast.error(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmUndo() {
    if (!undoConn) return;
    setBusy(true);
    try {
      await fibermapApi.deleteConnection(undoConn.id);
      toast.success(t('ap.undone'));
      setUndoConn(null);
      setConnMenu(null);
      refresh();
    } catch (err) {
      toast.error(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteDevice() {
    if (!deviceDeleting) return;
    setBusy(true);
    try {
      await fibermapApi.deleteDevice(deviceDeleting.id);
      toast.success(t('ap.deviceDeleted'));
      setDeviceDeleting(null);
      refresh();
    } catch (err) {
      toast.error(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  // ── Export PNG (spec §8.5) ──────────────────────────────────────────────
  function exportPng() {
    const svg = svgRef.current;
    if (!svg || !layout) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
    clone.setAttribute('width', String(layout.width));
    clone.setAttribute('height', String(layout.height));
    const inner = clone.querySelector('g[data-viewport]');
    inner?.setAttribute('transform', '');
    const xml = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = layout.width * 2;
      canvas.height = layout.height * 2;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `ponto-de-acesso-${ap?.element.name ?? 'fibermap'}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
    };
    img.src = url;
  }

  // ── Render ──────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-danger">{friendly(error)}</p>
      </div>
    );
  }
  if (!ap || !layout) {
    return (
      <div className="flex h-full items-center justify-center">
        <InlineLoader label={tc('loading')} />
      </div>
    );
  }

  const selectedId = selected
    ? selected.type === 'PORT'
      ? portAnchorId(selected.portId!)
      : fiberAnchorId(selected.fiberId!, selected.side!)
    : null;

  const connLossLabel = (c: FibermapApConnection) =>
    c.lossDb !== null
      ? `${c.lossDb.toFixed(2)}dB`
      : `${(c.kind === 'CONNECTOR' ? ap.defaultConnectorLossDb : ap.defaultFusionLossDb).toFixed(2)}dB*`;

  const connTooltip = (c: FibermapApConnection) => {
    const sideLabel = (s: FibermapApConnectionSide) =>
      s.type === 'PORT'
        ? `${s.deviceName ?? ''} [${s.portLabel ?? ''}]`
        : `${s.cableName ?? ''} [${t('ap.fiberN', { n: s.fiberNumber ?? 0 })}]`;
    return t('ap.connTooltip', {
      kind: c.kind === 'CONNECTOR' ? t('ap.kindConnector') : t('ap.kindFusion'),
      a: sideLabel(c.a),
      b: sideLabel(c.b),
      loss: connLossLabel(c),
    });
  };

  return (
    <div className="relative flex h-full flex-col">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-surface px-2 py-1.5 print:hidden">
        <Button size="xs" variant="outline" onClick={() => setDeviceModal(true)}>
          <PlusSquare className="mr-1 h-3.5 w-3.5" />
          {t('ap.newDevice')}
        </Button>
        <Button size="xs" variant="outline" onClick={() => setBulkModal(true)}>
          <Layers2 className="mr-1 h-3.5 w-3.5" />
          {t('ap.bulkFuse')}
        </Button>
        <div className="mx-1 h-5 w-px bg-border" />
        <Button size="xs" variant="ghost" onClick={exportPng} title={t('ap.exportPng')}>
          <ImageDown className="h-3.5 w-3.5" />
        </Button>
        <Button size="xs" variant="ghost" onClick={() => window.print()} title={t('ap.print')}>
          <Printer className="h-3.5 w-3.5" />
        </Button>
        <Button size="xs" variant="ghost" onClick={refresh} title={tc('loading')} loading={isValidating}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <span className="ml-auto text-xs text-text-muted">
          {selected ? t('ap.hintPickTarget') : t('ap.hintPickFree')}
        </span>
      </div>

      {/* ── Canvas SVG ──────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-hidden bg-surface-muted">
        <svg
          ref={svgRef}
          className="h-full w-full touch-none select-none"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          preserveAspectRatio="xMidYMin meet"
          onWheel={(e) => {
            const factor = e.deltaY < 0 ? 1.12 : 0.9;
            setView((v) => ({ ...v, k: Math.min(3, Math.max(0.35, v.k * factor)) }));
          }}
          onPointerDown={(e) => {
            if ((e.target as Element).closest('[data-hit]')) return;
            dragRef.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y };
            (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (!d) return;
            setView((v) => ({
              ...v,
              x: d.vx + (e.clientX - d.px),
              y: d.vy + (e.clientY - d.py),
            }));
          }}
          onPointerUp={() => (dragRef.current = null)}
        >
          <defs>
            {ap.connections.map((c) => {
              const a = layout.anchors.get(sideAnchorId(c.a));
              const b = layout.anchors.get(sideAnchorId(c.b));
              if (!a || !b) return null;
              return (
                <linearGradient
                  key={c.id}
                  id={`grad-${c.id}`}
                  gradientUnits="userSpaceOnUse"
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                >
                  <stop offset="0%" stopColor={hexOf(c.a.fiberColor)} />
                  <stop offset="100%" stopColor={hexOf(c.b.fiberColor)} />
                </linearGradient>
              );
            })}
            <style>{`
              @keyframes ap-pulse { 0%,100% { stroke-opacity:.9; stroke-width:2.5 } 50% { stroke-opacity:.2; stroke-width:5 } }
              .ap-selected { animation: ap-pulse 1s ease-in-out infinite; }
            `}</style>
          </defs>

          <g data-viewport transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {/* ── Conexões (por baixo dos blocos não — por cima do fundo) ── */}
            {ap.connections.map((c) => {
              const a = layout.anchors.get(sideAnchorId(c.a));
              const b = layout.anchors.get(sideAnchorId(c.b));
              if (!a || !b) return null;
              const mid = pathMidpoint(a, b);
              return (
                <g key={c.id}>
                  <path
                    d={connectionPath(a, b)}
                    fill="none"
                    stroke={`url(#grad-${c.id})`}
                    strokeWidth={4}
                    strokeDasharray="10 6"
                    strokeLinecap="round"
                    opacity={0.95}
                  >
                    <title>{connTooltip(c)}</title>
                  </path>
                  {/* Tesoura no ponto médio (spec §8: menu editar/desfazer) */}
                  <g
                    data-hit
                    transform={`translate(${mid.x} ${mid.y})`}
                    className="cursor-pointer"
                    onClick={() => {
                      setLossDraft(c.lossDb !== null ? String(c.lossDb) : '');
                      setConnMenu(c);
                    }}
                  >
                    <circle r={10} fill="#ffffff" stroke="#94a3b8" strokeWidth={1.2} />
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={11}
                    >
                      ✂
                    </text>
                    <text
                      y={-14}
                      textAnchor="middle"
                      fontSize={9}
                      fontWeight={600}
                      fill="#1d4ed8"
                    >
                      {connLossLabel(c)}
                    </text>
                  </g>
                </g>
              );
            })}

            {/* ── Devices (trapézio splitter / retângulo DIO-OLT) ────────── */}
            {layout.devices.map((d) => {
              const inner = d.col === 'L' ? d.x + d.width : d.x;
              const meta = d.device.metadata as { ratio?: string };
              return (
                <g key={d.device.id}>
                  {d.device.type === 'SPLITTER' ? (
                    <path
                      d={
                        d.col === 'L'
                          ? `M ${d.x} ${d.y + d.height / 2 - 14} L ${inner} ${d.y + HEADER_H} L ${inner} ${d.y + d.height} L ${d.x} ${d.y + d.height / 2 + 14} Z`
                          : `M ${inner} ${d.y + HEADER_H} L ${d.x + d.width} ${d.y + d.height / 2 - 14} L ${d.x + d.width} ${d.y + d.height / 2 + 14} L ${inner} ${d.y + d.height} Z`
                      }
                      fill="#f8fafc"
                      stroke="#94a3b8"
                      strokeWidth={1.2}
                    />
                  ) : (
                    <rect
                      x={d.x}
                      y={d.y + HEADER_H}
                      width={d.width}
                      height={d.height - HEADER_H}
                      rx={6}
                      fill="#f8fafc"
                      stroke="#94a3b8"
                      strokeWidth={1.2}
                    />
                  )}
                  {/* Header */}
                  <rect x={d.x} y={d.y} width={d.width} height={HEADER_H - 6} rx={4} fill="#334155" />
                  <text x={d.x + 8} y={d.y + 16} fontSize={11} fontWeight={600} fill="#ffffff">
                    {d.device.name}
                    {meta.ratio ? ` ${meta.ratio}` : ''}
                  </text>
                  <g
                    data-hit
                    className="cursor-pointer"
                    onClick={() => setDeviceDeleting({ id: d.device.id, name: d.device.name })}
                  >
                    <text x={d.x + d.width - 16} y={d.y + 16} fontSize={11} fill="#fca5a5">
                      🗑
                    </text>
                    <title>{tc('delete')}</title>
                  </g>

                  {/* Portas */}
                  {d.rows.map(({ port, y }) => {
                    const anchor = layout.anchors.get(portAnchorId(port.id))!;
                    const occupied = Boolean(port.faces.C || port.faces.F);
                    const isSel = selectedId === portAnchorId(port.id);
                    const fill = port.role === 'IN' ? '#16a34a' : occupied ? '#e2e8f0' : '#ffffff';
                    return (
                      <g key={port.id}>
                        <text
                          x={d.col === 'L' ? inner - 14 : inner + 14}
                          y={y + 3.5}
                          fontSize={10}
                          fill="#475569"
                          textAnchor={d.col === 'L' ? 'end' : 'start'}
                        >
                          {port.label ?? `#${port.portNumber}`}
                        </text>
                        <g
                          data-hit
                          className="cursor-pointer"
                          onClick={() => void clickEndpoint({ type: 'PORT', portId: port.id })}
                        >
                          <circle
                            cx={anchor.x}
                            cy={y}
                            r={PILL_R}
                            fill={fill}
                            stroke={isSel ? '#f59e0b' : occupied ? '#64748b' : '#94a3b8'}
                            strokeWidth={isSel ? 2.5 : 1.4}
                            className={isSel ? 'ap-selected' : undefined}
                          />
                          <text
                            x={anchor.x}
                            y={y + 3.2}
                            fontSize={8.5}
                            fontWeight={700}
                            textAnchor="middle"
                            fill={port.role === 'IN' ? '#ffffff' : '#334155'}
                          >
                            {port.role === 'IN' ? 'IN' : port.portNumber}
                          </text>
                          <title>
                            {occupied ? t('ap.portOccupied') : t('ap.portFree')}
                          </title>
                        </g>
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {/* ── Cabos ──────────────────────────────────────────────────── */}
            {layout.cables.map((cb) => {
              const inner = cb.col === 'L' ? cb.x + cb.width : cb.x;
              const shellX = cb.col === 'L' ? cb.x : cb.x + cb.width - 26;
              const tubeX = cb.col === 'L' ? cb.x + 26 : cb.x + cb.width - 26 - 28;
              return (
                <g key={cb.cable.id}>
                  {/* Header */}
                  <rect x={cb.x} y={cb.y} width={cb.width} height={HEADER_H - 6} rx={4} fill="#334155" />
                  <text x={cb.x + 8} y={cb.y + 16} fontSize={11} fontWeight={600} fill="#ffffff">
                    {cb.cable.name} · {cb.cable.fiberCount}FO{' '}
                    {cb.cable.relation === 'PASSES' ? '⇄' : cb.cable.relation === 'STARTS' ? '→' : '←'}
                  </text>
                  {/* Casca do cabo */}
                  <rect
                    x={shellX}
                    y={cb.y + HEADER_H}
                    width={26}
                    height={cb.height - HEADER_H}
                    rx={10}
                    fill={cb.cable.displayColor ?? '#f97316'}
                    opacity={0.9}
                  />
                  {/* Faixas de tubo (número SEMPRE visível — spec §2) */}
                  {cb.tubeBands.map((tb) => (
                    <g key={tb.tubeNumber}>
                      <rect
                        x={tubeX}
                        y={tb.y0}
                        width={28}
                        height={tb.y1 - tb.y0}
                        fill={hexOf(tb.color)}
                        stroke={isWhite(tb.color) ? '#94a3b8' : 'none'}
                        strokeWidth={1}
                        rx={4}
                        opacity={0.95}
                      />
                      <text
                        x={tubeX + 14}
                        y={(tb.y0 + tb.y1) / 2 + 3.5}
                        fontSize={10}
                        fontWeight={700}
                        textAnchor="middle"
                        fill={isWhite(tb.color) || tb.color === 'AMARELA' ? '#334155' : '#ffffff'}
                      >
                        {tb.tubeNumber}
                      </text>
                    </g>
                  ))}
                  {/* Fibras (linhas + pílulas) */}
                  {cb.rows.map((row) => {
                    const fx = cb.col === 'L' ? tubeX + 28 : tubeX;
                    const px = inner;
                    const fiberHex = hexOf(row.fiber.color);
                    if (!row.end) {
                      // EXPRESSA — esmaecida com tesoura (spec §8: cortar)
                      return (
                        <g key={`${row.fiber.id}-x`} opacity={0.45}>
                          <line
                            x1={fx}
                            y1={row.y}
                            x2={cb.col === 'L' ? px - 26 : px + 26}
                            y2={row.y}
                            stroke={fiberHex}
                            strokeWidth={2.5}
                            strokeDasharray="6 4"
                          />
                          <g
                            data-hit
                            className="cursor-pointer"
                            opacity={1}
                            onClick={() => void cutFiber(row.fiber.id)}
                          >
                            <circle
                              cx={cb.col === 'L' ? px - 12 : px + 12}
                              cy={row.y}
                              r={PILL_R}
                              fill="#ffffff"
                              stroke="#94a3b8"
                              strokeWidth={1.2}
                            />
                            <text
                              x={cb.col === 'L' ? px - 12 : px + 12}
                              y={row.y + 3.5}
                              fontSize={10}
                              textAnchor="middle"
                            >
                              ✂
                            </text>
                            <title>
                              {t('ap.cutTooltip', { n: row.fiber.fiberNumber })}
                            </title>
                          </g>
                        </g>
                      );
                    }
                    const end = row.end;
                    const aid = fiberAnchorId(row.fiber.id, end.side);
                    const isSel = selectedId === aid;
                    const connected = end.state === 'CONNECTED';
                    return (
                      <g key={`${row.fiber.id}-${end.side}`}>
                        <line
                          x1={fx}
                          y1={row.y}
                          x2={cb.col === 'L' ? px - PILL_R : px + PILL_R}
                          y2={row.y}
                          stroke={fiberHex}
                          strokeWidth={2.5}
                          strokeDasharray="6 4"
                          opacity={isWhite(row.fiber.color) ? 1 : 0.9}
                        />
                        {(end.side === 'U' || end.side === 'D') && (
                          <text
                            x={cb.col === 'L' ? px - 26 : px + 26}
                            y={row.y + 3}
                            fontSize={8}
                            fill="#64748b"
                            textAnchor="middle"
                          >
                            {end.side === 'U' ? '↑' : '↓'}
                          </text>
                        )}
                        <g
                          data-hit
                          className="cursor-pointer"
                          onClick={() => {
                            if (connected) return;
                            void clickEndpoint({
                              type: 'FIBER_END',
                              fiberId: row.fiber.id,
                              side: end.side,
                              ...(end.cutId ? { cutId: end.cutId } : {}),
                            });
                          }}
                        >
                          <circle
                            cx={px}
                            cy={row.y}
                            r={PILL_R}
                            fill={connected ? fiberHex : '#ffffff'}
                            stroke={
                              isSel ? '#f59e0b' : connected ? '#334155' : fiberHex
                            }
                            strokeWidth={isSel ? 2.5 : isWhite(row.fiber.color) ? 1.6 : 1.4}
                            className={isSel ? 'ap-selected' : undefined}
                          />
                          <text
                            x={px}
                            y={row.y + 3.2}
                            fontSize={8.5}
                            fontWeight={700}
                            textAnchor="middle"
                            fill={connected && !isWhite(row.fiber.color) ? '#ffffff' : '#334155'}
                          >
                            {row.fiber.fiberNumber}
                          </text>
                          <title>
                            {t('ap.fiberTooltip', {
                              n: row.fiber.fiberNumber,
                              tube: row.fiber.tubeNumber,
                              state: connected ? t('ap.stateConnected') : t('ap.stateFree'),
                            })}
                          </title>
                        </g>
                        {/* Desfazer corte quando as DUAS pontas estão livres */}
                        {end.side === 'U' && end.cutId && end.state === 'FREE' && (
                          <g
                            data-hit
                            className="cursor-pointer"
                            onClick={() => void undoCut(end.cutId!)}
                          >
                            <text
                              x={cb.col === 'L' ? px + 14 : px - 14}
                              y={row.y + ROW_H / 2 + 3}
                              fontSize={9}
                              fill="#94a3b8"
                              textAnchor="middle"
                            >
                              ⨯✂
                            </text>
                            <title>{t('ap.undoCut')}</title>
                          </g>
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* ── Menu da conexão (perda / desfazer) ──────────────────────────── */}
      {connMenu && (
        <StudioModal
          title={connTooltip(connMenu)}
          onClose={() => {
            if (!busy) setConnMenu(null);
          }}
          footer={
            <>
              <Button
                variant="ghost"
                className="mr-auto text-danger"
                onClick={() => setUndoConn(connMenu)}
                disabled={busy}
              >
                {t('ap.undo')}
              </Button>
              <Button variant="ghost" onClick={() => setConnMenu(null)} disabled={busy}>
                {tc('cancel')}
              </Button>
              <Button onClick={() => void saveLoss()} loading={busy}>
                {tc('save')}
              </Button>
            </>
          }
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-text">{t('ap.lossLabel')}</span>
            <input
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
              value={lossDraft}
              onChange={(e) => setLossDraft(e.target.value)}
              placeholder={t('ap.lossPlaceholder', {
                value: (connMenu.kind === 'CONNECTOR'
                  ? ap.defaultConnectorLossDb
                  : ap.defaultFusionLossDb
                ).toFixed(2),
              })}
              inputMode="decimal"
              autoFocus
            />
          </label>
        </StudioModal>
      )}

      {undoConn && (
        <StudioConfirm
          title={t('ap.undoTitle')}
          message={connTooltip(undoConn)}
          confirmLabel={t('ap.undo')}
          danger
          loading={busy}
          onClose={() => {
            if (!busy) setUndoConn(null);
          }}
          onConfirm={confirmUndo}
        />
      )}

      {deviceDeleting && (
        <StudioConfirm
          title={t('ap.deviceDeleteTitle', { name: deviceDeleting.name })}
          message={t('ap.deviceDeleteMessage')}
          confirmLabel={tc('delete')}
          danger
          loading={busy}
          onClose={() => {
            if (!busy) setDeviceDeleting(null);
          }}
          onConfirm={confirmDeleteDevice}
        />
      )}

      {deviceModal && (
        <DeviceCreateModal
          elementId={elementId}
          onClose={() => setDeviceModal(false)}
          onCreated={() => {
            setDeviceModal(false);
            refresh();
          }}
        />
      )}

      {bulkModal && ap && (
        <BulkFuseModal
          elementId={elementId}
          cables={ap.cables}
          onClose={() => setBulkModal(false)}
          onDone={() => {
            setBulkModal(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

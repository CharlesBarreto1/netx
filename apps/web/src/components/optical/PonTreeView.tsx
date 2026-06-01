'use client';

/**
 * PonTreeView — diagrama lógico (não-geográfico) da árvore PON (R7 OSP).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Doc: docs/architecture/osp-network.md
 *
 * Layout top-down: raiz no topo, filhos abaixo, cabos como linhas
 * conectando. Mesma filosofia visual do EnclosureSchematic (SVG puro, sem
 * deps). Mostra:
 *   - Nó = caixa (cor por tipo, badge de ocupação)
 *   - Aresta = cabo (cor por tipo, label com código + km + fibras)
 *   - Badge vermelho ⚠ quando há evento OTDR ativo
 *   - "(loop → X)" quando o destino já foi visitado (ciclo)
 */
import { useTranslations } from 'next-intl';

import type { PonTreeNode } from '@/lib/pon-tree-api';

// ─── Constantes de layout ───────────────────────────────────────────────────
const NODE_W = 160;
const NODE_H = 70;
const H_GAP = 24; // horizontal entre nós irmãos
const V_GAP = 70; // vertical entre níveis (espaço pra label do cabo)
const PADDING = 30;

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  data: PonTreeNode;
  parentCableLabel?: string;
  parentCable?: {
    type: 'BACKBONE' | 'DISTRIBUTION' | 'DROP';
    activeEventsCount: number;
  };
  parentXMid?: number; // X do meio do pai pra desenhar curva
  parentY?: number;
  cycleTarget?: string;
}

/**
 * Calcula posições x,y em algoritmo simples (Reingold-Tilford simplificado):
 *   - subtreeWidth de cada nó = max(sum(subtreeWidth filhos), NODE_W)
 *   - posiciona pai centralizado sobre filhos
 */
function layout(root: PonTreeNode): {
  nodes: LayoutNode[];
  width: number;
  height: number;
} {
  const out: LayoutNode[] = [];

  function subtreeWidth(node: PonTreeNode): number {
    const realChildren = node.outgoingCables.filter((c) => c.destination);
    if (realChildren.length === 0) return NODE_W;
    const childrenSum =
      realChildren.reduce(
        (acc, c) => acc + subtreeWidth(c.destination!),
        0,
      ) +
      (realChildren.length - 1) * H_GAP;
    return Math.max(NODE_W, childrenSum);
  }

  function place(
    node: PonTreeNode,
    leftX: number,
    y: number,
    parentXMid?: number,
    parentY?: number,
    parentCable?: LayoutNode['parentCable'],
    parentCableLabel?: string,
  ): number {
    const w = subtreeWidth(node);
    const nodeX = leftX + (w - NODE_W) / 2;
    const layoutNode: LayoutNode = {
      id: node.enclosure.id,
      x: nodeX,
      y,
      width: NODE_W,
      height: NODE_H,
      data: node,
      parentCableLabel,
      parentCable,
      parentXMid,
      parentY,
    };
    out.push(layoutNode);

    let cursor = leftX;
    for (const cable of node.outgoingCables) {
      if (!cable.destination) {
        // Cabo termina sem destino (drop pra ONT futura ou ciclo cortado).
        // Renderizamos como "nó folha virtual" pra mostrar o cabo.
        const stubX = cursor + (NODE_W - NODE_W) / 2; // mesmo NODE_W
        // Mas só se houver cycleTarget — senão vira um leaf sem nada.
        if (cable.cycleToEnclosureId) {
          out.push({
            id: `cycle-${cable.id}`,
            x: cursor,
            y: y + NODE_H + V_GAP,
            width: NODE_W,
            height: NODE_H,
            data: {
              enclosure: {
                id: cable.cycleToEnclosureId,
                code: '(loop ↺)',
                type: 'CTO',
                splitterRatio: null,
                capacity: 0,
                portsUsed: 0,
                portsTotal: 0,
              },
              outgoingCables: [],
            },
            parentXMid: nodeX + NODE_W / 2,
            parentY: y + NODE_H,
            parentCable: {
              type: cable.type,
              activeEventsCount: cable.activeEventsCount,
            },
            parentCableLabel: cable.code,
            cycleTarget: cable.cycleToEnclosureId,
          });
          cursor += NODE_W + H_GAP;
        }
        continue;
      }
      const childW = subtreeWidth(cable.destination);
      place(
        cable.destination,
        cursor,
        y + NODE_H + V_GAP,
        nodeX + NODE_W / 2,
        y + NODE_H,
        {
          type: cable.type,
          activeEventsCount: cable.activeEventsCount,
        },
        `${cable.code} · ${formatLen(cable.lengthMeters)}`,
      );
      cursor += childW + H_GAP;
    }

    return w;
  }

  place(root, PADDING, PADDING);
  const width =
    Math.max(...out.map((n) => n.x + n.width), NODE_W) + PADDING;
  const height = Math.max(...out.map((n) => n.y + n.height), NODE_H) + PADDING;
  return { nodes: out, width, height };
}

function formatLen(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${meters.toFixed(0)} m`;
}

const TYPE_FILL: Record<PonTreeNode['enclosure']['type'], string> = {
  CTO: '#dbeafe',
  NAP: '#fde68a',
  SPLITTER: '#fef3c7',
  EMENDA: '#e5e7eb',
};
const TYPE_BORDER: Record<PonTreeNode['enclosure']['type'], string> = {
  CTO: '#1e40af',
  NAP: '#b45309',
  SPLITTER: '#a16207',
  EMENDA: '#475569',
};

const CABLE_COLOR: Record<'BACKBONE' | 'DISTRIBUTION' | 'DROP', string> = {
  BACKBONE: '#1d4ed8',
  DISTRIBUTION: '#9333ea',
  DROP: '#0d9488',
};

interface Props {
  root: PonTreeNode;
  onNodeClick?: (enclosureId: string) => void;
}

export function PonTreeView({ root, onNodeClick }: Props) {
  const t = useTranslations('opticalComponents');
  const { nodes, width, height } = layout(root);

  return (
    <div className="w-full overflow-auto rounded-md border border-border bg-slate-50 dark:bg-slate-900/40">
      <svg
        width={width}
        height={height}
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: 'block' }}
      >
        {/* Arestas (cabos) primeiro pra ficarem ABAIXO dos nós. */}
        {nodes.map((n) => {
          if (n.parentXMid == null || n.parentY == null || !n.parentCable)
            return null;
          const childMidX = n.x + n.width / 2;
          const childY = n.y;
          const stroke = CABLE_COLOR[n.parentCable.type];
          const dash = n.parentCable.type === 'DROP' ? '4 3' : undefined;
          // Bezier vertical: sai pra baixo do pai, faz S, entra por cima do filho.
          const path = `M ${n.parentXMid} ${n.parentY}
            C ${n.parentXMid} ${(n.parentY + childY) / 2},
              ${childMidX} ${(n.parentY + childY) / 2},
              ${childMidX} ${childY}`;
          return (
            <g key={`edge-${n.id}`}>
              <path
                d={path}
                stroke={stroke}
                strokeWidth={n.parentCable.type === 'BACKBONE' ? 3 : 2}
                strokeDasharray={dash}
                fill="none"
              />
              {n.parentCableLabel && (
                <g
                  transform={`translate(${(n.parentXMid + childMidX) / 2}, ${(n.parentY + childY) / 2})`}
                >
                  <rect
                    x={-60}
                    y={-8}
                    width={120}
                    height={16}
                    rx={3}
                    fill="white"
                    stroke={stroke}
                    strokeWidth={0.8}
                  />
                  <text
                    textAnchor="middle"
                    y={4}
                    fontSize={10}
                    fontFamily="ui-monospace, monospace"
                    fill="#0f172a"
                  >
                    {n.parentCableLabel}
                  </text>
                </g>
              )}
              {n.parentCable.activeEventsCount > 0 && (
                <g
                  transform={`translate(${(n.parentXMid + childMidX) / 2 + 56}, ${(n.parentY + childY) / 2 - 14})`}
                >
                  <circle r={9} fill="#dc2626" stroke="white" strokeWidth={1.5} />
                  <text
                    textAnchor="middle"
                    y={3}
                    fontSize={10}
                    fontWeight={700}
                    fill="white"
                  >
                    !
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* Nós */}
        {nodes.map((n) => {
          const e = n.data.enclosure;
          const isCycle = !!n.cycleTarget;
          const fill = isCycle ? '#fce7f3' : TYPE_FILL[e.type];
          const border = isCycle ? '#be185d' : TYPE_BORDER[e.type];
          const occupancyPct =
            e.portsTotal > 0 ? Math.round((e.portsUsed / e.portsTotal) * 100) : 0;
          const occColor =
            occupancyPct >= 80
              ? '#dc2626'
              : occupancyPct >= 50
                ? '#f59e0b'
                : '#059669';
          return (
            <g
              key={`node-${n.id}`}
              transform={`translate(${n.x}, ${n.y})`}
              style={{ cursor: onNodeClick && !isCycle ? 'pointer' : 'default' }}
              onClick={() => {
                if (onNodeClick && !isCycle) onNodeClick(e.id);
              }}
            >
              <rect
                width={n.width}
                height={n.height}
                rx={5}
                fill={fill}
                stroke={border}
                strokeWidth={1.5}
              />
              <text
                x={n.width / 2}
                y={20}
                textAnchor="middle"
                fontSize={13}
                fontWeight={700}
                fontFamily="ui-monospace, monospace"
                fill="#0f172a"
              >
                {isCycle ? t('ponTreeView.loopMarker') : e.code}
              </text>
              <text
                x={n.width / 2}
                y={36}
                textAnchor="middle"
                fontSize={10}
                fill="#475569"
              >
                {isCycle
                  ? t('ponTreeView.cycleDetected')
                  : `${e.type}${e.splitterRatio ? ` · 1:${splitterCount(e.splitterRatio)}` : ''}`}
              </text>
              {!isCycle && e.portsTotal > 0 && (
                <>
                  <rect
                    x={10}
                    y={48}
                    width={n.width - 20}
                    height={6}
                    rx={3}
                    fill="#e5e7eb"
                  />
                  <rect
                    x={10}
                    y={48}
                    width={((n.width - 20) * occupancyPct) / 100}
                    height={6}
                    rx={3}
                    fill={occColor}
                  />
                  <text
                    x={n.width / 2}
                    y={64}
                    textAnchor="middle"
                    fontSize={9}
                    fill="#475569"
                  >
                    {e.portsUsed}/{e.portsTotal} · {occupancyPct}%
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function splitterCount(
  ratio: PonTreeNode['enclosure']['splitterRatio'],
): number | string {
  if (!ratio) return '?';
  return ratio.replace('ONE_TO_', '');
}

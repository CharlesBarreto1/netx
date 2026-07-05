/**
 * Layout do editor de emendas (FM-3, spec §8) — cálculo PURO de posições.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Duas colunas (padrão Tomodat): devices (splitters/DIO/OLT) à ESQUERDA com a
 * ponta voltada pro centro, cabos à DIREITA com as pílulas voltadas pro
 * centro. Sem devices, os cabos alternam L/R pra reduzir cruzamento. Cada
 * ponta conectável vira uma ÂNCORA (id estável → x/y) que as Béziers usam.
 *
 * Ids de âncora:  F:{fiberId}:{side}   ·   P:{portId}
 */
import type {
  FibermapAccessPoint,
  FibermapApCable,
  FibermapApDevice,
} from '@/lib/fibermap-api';

export const ROW_H = 26;
export const CABLE_W = 168;
export const DEVICE_W = 148;
export const HEADER_H = 30;
export const BLOCK_GAP = 36;
export const COL_PAD = 28;
export const CANVAS_W = 960;

export interface Anchor {
  x: number;
  y: number;
  /** 'L' = bloco na coluna esquerda (curva sai pra direita) e vice-versa. */
  col: 'L' | 'R';
}

export interface FiberRow {
  fiber: FibermapApCable['fibers'][number];
  /** Ponta desta linha (fibra cortada ocupa 2 linhas: U e D). */
  end: FibermapApCable['fibers'][number]['ends'][number] | null;
  y: number;
}

export interface CableBlock {
  kind: 'cable';
  cable: FibermapApCable;
  col: 'L' | 'R';
  x: number;
  y: number;
  width: number;
  height: number;
  rows: FiberRow[];
  /** Faixas de tubo (y0..y1 do grupo de fibras do tubo). */
  tubeBands: Array<{ tubeNumber: number; color: string; y0: number; y1: number }>;
}

export interface PortRow {
  port: FibermapApDevice['ports'][number];
  y: number;
}

export interface DeviceBlock {
  kind: 'device';
  device: FibermapApDevice;
  col: 'L' | 'R';
  x: number;
  y: number;
  width: number;
  height: number;
  rows: PortRow[];
}

export interface ApLayout {
  cables: CableBlock[];
  devices: DeviceBlock[];
  anchors: Map<string, Anchor>;
  width: number;
  height: number;
}

export function fiberAnchorId(fiberId: string, side: string): string {
  return `F:${fiberId}:${side}`;
}
export function portAnchorId(portId: string): string {
  return `P:${portId}`;
}

function cableRows(cable: FibermapApCable): Array<FiberRow['end']>[] {
  // por fibra: lista de "linhas" (1 pra extremidade/expressa, 2 pro corte U+D)
  return cable.fibers.map((f) => (f.ends.length === 2 ? [f.ends[0], f.ends[1]] : [f.ends[0] ?? null]));
}

export function buildLayout(ap: FibermapAccessPoint): ApLayout {
  const anchors = new Map<string, Anchor>();
  const deviceBlocks: DeviceBlock[] = [];
  const cableBlocks: CableBlock[] = [];

  // ── Distribuição em colunas ────────────────────────────────────────────
  const leftItems: Array<FibermapApDevice | FibermapApCable> = [...ap.devices];
  const rightItems: Array<FibermapApDevice | FibermapApCable> = [];
  ap.cables.forEach((c, i) => {
    if (ap.devices.length === 0 && i % 2 === 1) leftItems.push(c);
    else rightItems.push(c);
  });

  const isDevice = (it: FibermapApDevice | FibermapApCable): it is FibermapApDevice =>
    'ports' in it;

  function place(items: Array<FibermapApDevice | FibermapApCable>, col: 'L' | 'R') {
    let y = COL_PAD;
    for (const item of items) {
      if (isDevice(item)) {
        const rows: PortRow[] = item.ports.map((p, i) => ({
          port: p,
          y: y + HEADER_H + 10 + i * ROW_H + ROW_H / 2,
        }));
        const height = HEADER_H + 20 + item.ports.length * ROW_H;
        const x = col === 'L' ? COL_PAD : CANVAS_W - COL_PAD - DEVICE_W;
        const block: DeviceBlock = { kind: 'device', device: item, col, x, y, width: DEVICE_W, height, rows };
        deviceBlocks.push(block);
        for (const r of rows) {
          anchors.set(portAnchorId(r.port.id), {
            x: col === 'L' ? x + DEVICE_W : x,
            y: r.y,
            col,
          });
        }
        y += height + BLOCK_GAP;
      } else {
        const perFiber = cableRows(item);
        const rows: FiberRow[] = [];
        const tubeBands: CableBlock['tubeBands'] = [];
        let rowIdx = 0;
        let curTube = -1;
        item.fibers.forEach((f, fi) => {
          if (f.tubeNumber !== curTube) {
            curTube = f.tubeNumber;
            const color = item.tubes.find((t) => t.tubeNumber === curTube)?.color ?? 'BRANCA';
            tubeBands.push({ tubeNumber: curTube, color, y0: 0, y1: 0 });
          }
          const band = tubeBands[tubeBands.length - 1];
          for (const end of perFiber[fi]) {
            const ry = y + HEADER_H + 10 + rowIdx * ROW_H + ROW_H / 2;
            rows.push({ fiber: f, end, y: ry });
            if (band.y0 === 0) band.y0 = ry - ROW_H / 2;
            band.y1 = ry + ROW_H / 2;
            rowIdx++;
          }
        });
        const height = HEADER_H + 20 + rowIdx * ROW_H;
        const x = col === 'L' ? COL_PAD : CANVAS_W - COL_PAD - CABLE_W;
        const block: CableBlock = { kind: 'cable', cable: item, col, x, y, width: CABLE_W, height, rows, tubeBands };
        cableBlocks.push(block);
        for (const r of rows) {
          if (!r.end) continue;
          anchors.set(fiberAnchorId(r.fiber.id, r.end.side), {
            x: col === 'L' ? x + CABLE_W : x,
            y: r.y,
            col,
          });
        }
        y += height + BLOCK_GAP;
      }
    }
    return y;
  }

  const hL = place(leftItems, 'L');
  const hR = place(rightItems, 'R');

  return {
    cables: cableBlocks,
    devices: deviceBlocks,
    anchors,
    width: CANVAS_W,
    height: Math.max(hL, hR, 300) + COL_PAD,
  };
}

/** Bézier entre duas âncoras — controle horizontal na direção da outra. */
export function connectionPath(a: Anchor, b: Anchor): string {
  const dxA = a.col === 'L' ? 1 : -1;
  const dxB = b.col === 'L' ? 1 : -1;
  const spread = Math.min(Math.max(Math.abs(b.x - a.x) * 0.45, 50), 180);
  return `M ${a.x} ${a.y} C ${a.x + dxA * spread} ${a.y}, ${b.x + dxB * spread} ${b.y}, ${b.x} ${b.y}`;
}

export function pathMidpoint(a: Anchor, b: Anchor): { x: number; y: number } {
  // t=0.5 da cúbica com os mesmos controles do connectionPath
  const dxA = a.col === 'L' ? 1 : -1;
  const dxB = b.col === 'L' ? 1 : -1;
  const spread = Math.min(Math.max(Math.abs(b.x - a.x) * 0.45, 50), 180);
  const c1x = a.x + dxA * spread;
  const c2x = b.x + dxB * spread;
  return {
    x: (a.x + 3 * c1x + 3 * c2x + b.x) / 8,
    y: (a.y + 3 * a.y + 3 * b.y + b.y) / 8,
  };
}

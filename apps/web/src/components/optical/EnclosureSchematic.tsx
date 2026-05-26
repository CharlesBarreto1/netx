'use client';

/**
 * EnclosureSchematic — vista esquemática Tomodat-like de uma caixa óptica.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Doc: docs/architecture/osp-network.md
 *
 * Renderiza SVG full-canvas com:
 *   - Cilindros (cabos terminando) em colunas esquerda (entrando) e
 *     direita (saindo). Convenção: cabo com endpointB=enclosure = entrando;
 *     endpointA=enclosure = saindo. Naïve mas funciona pra v1 — operador
 *     pode inverter editando o cabo se necessário.
 *   - Splitters internos (parentId=enclosure) ao centro.
 *   - Cada cilindro tem N portas numeradas com swatch da cor TIA-598.
 *   - Linhas pretas conectando portas via fusão; tesoura ✂ no meio.
 *   - Chips de loss (dB) ao lado de cada porta envolvida em fusão.
 *
 * Interações:
 *   - Click numa porta → seleciona (highlight + estado). Click numa segunda
 *     porta livre → abre modal de "criar fusão" pré-preenchido.
 *   - Click numa tesoura → confirma deletar fusão.
 *   - Click numa fusão (linha) → abre modal de editar (loss, foto, notes).
 *
 * Layout responsivo: SVG cresce com o container; portas ficam empilhadas
 * verticalmente com PORT_HEIGHT fixo. Cilindro mais longo determina altura.
 */
import { useMemo, useRef, useState } from 'react';

import { fiberColorClient } from '@/lib/fiber-api';
import type {
  EnclosureTopology,
  TopologyCable,
  TopologyChildSplitter,
  TopologySplice,
} from '@/lib/fiber-api';

// ─── Constantes de layout ───────────────────────────────────────────────────
const PORT_HEIGHT = 22;
const CYLINDER_WIDTH = 220;
const CYLINDER_HEADER = 28;
const COL_GAP = 280; // espaço horizontal entre colunas
const SIDE_PADDING = 40;
const TOP_PADDING = 20;
const SWATCH_SIZE = 14;
const CHIP_WIDTH = 60;

// Cores
const CYL_FILL = '#dbeafe'; // blue-100 (claro)
const CYL_STROKE = '#1e293b'; // slate-800 (borda preta)
const CYL_HEADER_FILL = '#94a3b8'; // slate-400
const PORT_BORDER = '#64748b'; // slate-500
const PORT_BG = '#0f172a'; // slate-900 (chip "01" preto)
const SPLITTER_ACCENT = '#16a34a'; // green-600 (borda verde dos prints)
const SELECTED_OUTLINE = '#f59e0b'; // amber-500

// Identidade única pra cada porta no DOM/state. Cabo: `cable:${id}:${index}`.
// Splitter: `splitter:${id}:${index}`.
type PortKey = string;

interface PortPosition {
  key: PortKey;
  x: number; // ponto de saída da fibra (ponta do swatch)
  y: number; // centro vertical da porta
  side: 'left' | 'right' | 'center';
  /** Identidade da fonte pra resolver clicks em criar fusão. */
  source: { kind: 'cable' | 'splitter'; id: string; index: number; color: string };
}

interface Props {
  topology: EnclosureTopology;
  /** Chamado quando usuário escolhe criar fusão entre 2 portas livres. */
  onCreateSplice: (a: PortPosition['source'], b: PortPosition['source']) => void;
  /** Chamado ao clicar numa fusão existente (linha ou tesoura). */
  onEditSplice: (spliceId: string) => void;
  /** Chamado ao confirmar delete (tesoura). */
  onDeleteSplice: (spliceId: string) => void;
}

export function EnclosureSchematic({
  topology,
  onCreateSplice,
  onEditSplice,
  onDeleteSplice,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  // ─── Particiona cabos por convenção endpointA/endpointB ───────────────────
  const incomingCables = topology.incomingCables.filter(
    (c) => c.endpointRole === 'B',
  );
  const outgoingCables = topology.incomingCables.filter(
    (c) => c.endpointRole === 'A',
  );

  // Calcula posições de todas as portas. Faz dimensionamento dinâmico do SVG.
  const { ports, width, height } = useMemo(
    () =>
      computeLayout(
        incomingCables,
        outgoingCables,
        topology.childSplitters,
      ),
    [incomingCables, outgoingCables, topology.childSplitters],
  );

  // Estado: porta selecionada (1ª click); 2ª click numa porta livre cria splice.
  const [selectedPort, setSelectedPort] = useState<PortPosition | null>(null);

  // Map de porta → fusão (se houver). Permite saber rapidamente se uma porta
  // já está fundida (e qual fusão).
  const portToSplice = useMemo(() => {
    const m = new Map<PortKey, TopologySplice>();
    for (const s of topology.splices) {
      m.set(`cable:${s.cableAId}:${s.fiberAIndex}`, s);
      m.set(`cable:${s.cableBId}:${s.fiberBIndex}`, s);
    }
    return m;
  }, [topology.splices]);

  function handlePortClick(p: PortPosition) {
    const splice = portToSplice.get(p.key);
    if (splice) {
      // Porta já fundida — abre detalhe da fusão.
      onEditSplice(splice.id);
      return;
    }
    if (!selectedPort) {
      setSelectedPort(p);
      return;
    }
    if (selectedPort.key === p.key) {
      // Clicar de novo na mesma deseleciona.
      setSelectedPort(null);
      return;
    }
    // 2 portas selecionadas, ambas livres → criar fusão.
    onCreateSplice(selectedPort.source, p.source);
    setSelectedPort(null);
  }

  return (
    <div className="w-full overflow-auto rounded-md border border-border bg-slate-100 dark:bg-slate-900/40">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: 'block' }}
      >
        {/* Fundo */}
        <rect width="100%" height="100%" fill="transparent" />

        {/* Cilindros — cabos entrando (esquerda) */}
        {incomingCables.map((c, i) =>
          renderCable(c, ports, i, 'left'),
        )}

        {/* Splitters ao centro */}
        {topology.childSplitters.map((s, i) =>
          renderSplitter(s, ports, i),
        )}

        {/* Cabos saindo (direita) */}
        {outgoingCables.map((c, i) =>
          renderCable(c, ports, i, 'right'),
        )}

        {/* Linhas de fusões */}
        {topology.splices.map((s) => (
          <SpliceLine
            key={s.id}
            splice={s}
            ports={ports}
            onEdit={() => onEditSplice(s.id)}
            onDelete={() => {
              if (confirm('Cortar esta fusão?')) onDeleteSplice(s.id);
            }}
          />
        ))}

        {/* Portas clicáveis (overlay) — desenhadas POR ÚLTIMO pra ficar
            por cima das linhas e capturar clicks. */}
        {ports.map((p) => (
          <PortHotzone
            key={p.key}
            port={p}
            isSelected={selectedPort?.key === p.key}
            isSpliced={portToSplice.has(p.key)}
            onClick={() => handlePortClick(p)}
          />
        ))}

        {selectedPort && (
          <SelectedHint port={selectedPort} />
        )}
      </svg>
    </div>
  );
}

// ─── Layout algorithm ───────────────────────────────────────────────────────
interface LayoutResult {
  ports: PortPosition[];
  width: number;
  height: number;
}

function computeLayout(
  incoming: TopologyCable[],
  outgoing: TopologyCable[],
  splitters: TopologyChildSplitter[],
): LayoutResult {
  const ports: PortPosition[] = [];

  // 3 colunas: esquerda (incoming), centro (splitters), direita (outgoing).
  const colX = {
    left: SIDE_PADDING + CYLINDER_WIDTH,
    center: SIDE_PADDING + CYLINDER_WIDTH + COL_GAP + CYLINDER_WIDTH / 2,
    right: SIDE_PADDING + CYLINDER_WIDTH + COL_GAP + COL_GAP + CYLINDER_WIDTH,
  };

  // Helper: empilha cilindros verticalmente, retornando Y final.
  function placeColumn(
    items: { fiberCount: number; id: string; kind: 'cable' | 'splitter'; color: (i: number) => string }[],
    x: number,
    side: 'left' | 'right' | 'center',
  ): number {
    let y = TOP_PADDING;
    for (const item of items) {
      y += CYLINDER_HEADER;
      for (let i = 1; i <= item.fiberCount; i++) {
        const portY = y + PORT_HEIGHT / 2;
        const portX =
          side === 'left'
            ? x // ponta direita do cilindro
            : side === 'right'
              ? x - CYLINDER_WIDTH // ponta esquerda
              : x; // centro (splitter), usa porta lateral
        ports.push({
          key: `${item.kind}:${item.id}:${i}`,
          x: portX,
          y: portY,
          side,
          source: {
            kind: item.kind,
            id: item.id,
            index: i,
            color: item.color(i),
          },
        });
        y += PORT_HEIGHT;
      }
      y += 16; // gap entre cilindros
    }
    return y;
  }

  const leftItems = incoming.map((c) => ({
    fiberCount: c.fiberCount,
    id: c.id,
    kind: 'cable' as const,
    color: (i: number) => fiberColorClient(i).hex,
  }));
  const rightItems = outgoing.map((c) => ({
    fiberCount: c.fiberCount,
    id: c.id,
    kind: 'cable' as const,
    color: (i: number) => fiberColorClient(i).hex,
  }));
  const centerItems = splitters.map((s) => ({
    fiberCount: s.capacity,
    id: s.id,
    kind: 'splitter' as const,
    // Splitter divide o mesmo sinal — todas as saídas têm a mesma cor base.
    color: () => '#475569', // slate-600
  }));

  const yLeft = placeColumn(leftItems, colX.left, 'left');
  const yCenter = placeColumn(centerItems, colX.center, 'center');
  const yRight = placeColumn(rightItems, colX.right, 'right');

  const height = Math.max(yLeft, yCenter, yRight) + TOP_PADDING;
  const width = colX.right + SIDE_PADDING;

  return { ports, width, height };
}

// ─── Render: cilindro de cabo ───────────────────────────────────────────────
function renderCable(
  cable: TopologyCable,
  ports: PortPosition[],
  index: number,
  side: 'left' | 'right',
): React.ReactNode {
  const cablePorts = ports.filter(
    (p) => p.source.kind === 'cable' && p.source.id === cable.id,
  );
  if (cablePorts.length === 0) return null;

  const yTop = cablePorts[0].y - PORT_HEIGHT / 2 - CYLINDER_HEADER;
  const yBottom = cablePorts[cablePorts.length - 1].y + PORT_HEIGHT / 2;
  const x = side === 'left' ? cablePorts[0].x - CYLINDER_WIDTH : cablePorts[0].x;

  return (
    <g key={`cable-${cable.id}-${index}`}>
      {/* Corpo do cilindro */}
      <rect
        x={x}
        y={yTop}
        width={CYLINDER_WIDTH}
        height={yBottom - yTop}
        rx={4}
        fill={CYL_FILL}
        stroke={CYL_STROKE}
        strokeWidth={1.5}
      />
      {/* Header com nome do cabo */}
      <rect
        x={x}
        y={yTop}
        width={CYLINDER_WIDTH}
        height={CYLINDER_HEADER}
        rx={4}
        fill={CYL_HEADER_FILL}
      />
      <text
        x={x + 10}
        y={yTop + 18}
        fontSize={12}
        fontWeight={600}
        fontFamily="ui-monospace, monospace"
        fill="#0f172a"
      >
        {cable.code}
      </text>
      <text
        x={x + CYLINDER_WIDTH - 10}
        y={yTop + 18}
        fontSize={10}
        textAnchor="end"
        fill="#0f172a"
      >
        {cable.fiberCount}f · {cable.type[0]}
      </text>

      {/* Borda verde lateral do lado da "saída" (TomoDAT style) */}
      <rect
        x={side === 'left' ? x + CYLINDER_WIDTH - 4 : x}
        y={yTop + CYLINDER_HEADER}
        width={4}
        height={yBottom - yTop - CYLINDER_HEADER}
        fill={SPLITTER_ACCENT}
      />

      {/* Portas — swatch + número + fibra colorida saindo */}
      {cablePorts.map((p) => {
        const color = p.source.color;
        const isLight = ['#f3f4f6', '#facc15', '#06b6d4'].includes(color);
        const portXEdge = side === 'left' ? x + CYLINDER_WIDTH : x;
        const numberX = side === 'left' ? portXEdge - 30 : portXEdge + 14;
        const swatchX = side === 'left' ? portXEdge - 18 : portXEdge + 30;
        return (
          <g key={p.key}>
            {/* Linha colorida da fibra "saindo" da porta */}
            <line
              x1={portXEdge}
              y1={p.y}
              x2={side === 'left' ? portXEdge + 30 : portXEdge - 30}
              y2={p.y}
              stroke={color}
              strokeWidth={2.5}
              strokeDasharray={p.source.index % 2 === 0 ? undefined : '4 3'}
            />
            {/* Número da porta em chip preto */}
            <circle cx={numberX} cy={p.y} r={9} fill={PORT_BG} />
            <text
              x={numberX}
              y={p.y + 3}
              fontSize={9}
              textAnchor="middle"
              fill="white"
              fontWeight={600}
              fontFamily="ui-monospace, monospace"
            >
              {String(p.source.index).padStart(2, '0')}
            </text>
            {/* Swatch da cor TIA (pequeno) */}
            <rect
              x={swatchX - SWATCH_SIZE / 2}
              y={p.y - SWATCH_SIZE / 2}
              width={SWATCH_SIZE}
              height={SWATCH_SIZE}
              fill={color}
              stroke={isLight ? PORT_BORDER : 'transparent'}
              strokeWidth={1}
            />
          </g>
        );
      })}
    </g>
  );
}

// ─── Render: cilindro de splitter ──────────────────────────────────────────
function renderSplitter(
  splitter: TopologyChildSplitter,
  ports: PortPosition[],
  index: number,
): React.ReactNode {
  const splitterPorts = ports.filter(
    (p) => p.source.kind === 'splitter' && p.source.id === splitter.id,
  );
  if (splitterPorts.length === 0) return null;

  const yTop = splitterPorts[0].y - PORT_HEIGHT / 2 - CYLINDER_HEADER;
  const yBottom =
    splitterPorts[splitterPorts.length - 1].y + PORT_HEIGHT / 2;
  const x = splitterPorts[0].x - CYLINDER_WIDTH / 2;
  const ratio = splitter.splitterRatio
    ? splitter.splitterRatio.replace('ONE_TO_', '1:')
    : '?';

  return (
    <g key={`splitter-${splitter.id}-${index}`}>
      <rect
        x={x}
        y={yTop}
        width={CYLINDER_WIDTH}
        height={yBottom - yTop}
        rx={4}
        fill="#fef3c7"
        stroke={CYL_STROKE}
        strokeWidth={1.5}
      />
      <rect
        x={x}
        y={yTop}
        width={CYLINDER_WIDTH}
        height={CYLINDER_HEADER}
        rx={4}
        fill="#fbbf24"
      />
      <text
        x={x + 10}
        y={yTop + 18}
        fontSize={12}
        fontWeight={600}
        fontFamily="ui-monospace, monospace"
        fill="#0f172a"
      >
        {splitter.code}
      </text>
      <text
        x={x + CYLINDER_WIDTH - 10}
        y={yTop + 18}
        fontSize={10}
        textAnchor="end"
        fill="#0f172a"
      >
        SP {ratio} · {splitter.portsUsed}/{splitter.portsTotal}
      </text>

      {/* Portas do splitter — saem dos 2 lados pra permitir conexão visual
          tanto com cabos da esquerda quanto da direita. Pra v1 saem só pra
          direita (saída do sinal); entrada do splitter assumida em porta 0. */}
      {splitterPorts.map((p) => {
        const color = p.source.color;
        const portXEdge = x + CYLINDER_WIDTH;
        return (
          <g key={p.key}>
            <line
              x1={portXEdge}
              y1={p.y}
              x2={portXEdge - 28}
              y2={p.y}
              stroke={color}
              strokeWidth={2.5}
            />
            <circle cx={portXEdge - 36} cy={p.y} r={9} fill={PORT_BG} />
            <text
              x={portXEdge - 36}
              y={p.y + 3}
              fontSize={9}
              textAnchor="middle"
              fill="white"
              fontWeight={600}
              fontFamily="ui-monospace, monospace"
            >
              {String(p.source.index).padStart(2, '0')}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// ─── Render: linha de fusão (ligando 2 portas) ──────────────────────────────
function SpliceLine({
  splice,
  ports,
  onEdit,
  onDelete,
}: {
  splice: TopologySplice;
  ports: PortPosition[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const a = ports.find(
    (p) =>
      p.source.kind === 'cable' &&
      p.source.id === splice.cableAId &&
      p.source.index === splice.fiberAIndex,
  );
  const b = ports.find(
    (p) =>
      p.source.kind === 'cable' &&
      p.source.id === splice.cableBId &&
      p.source.index === splice.fiberBIndex,
  );
  if (!a || !b) return null;

  // Pontos externos das portas (após o "rabicho" colorido de 30px).
  const ax = a.side === 'left' ? a.x + 30 : a.side === 'right' ? a.x - 30 : a.x;
  const bx = b.side === 'left' ? b.x + 30 : b.side === 'right' ? b.x - 30 : b.x;

  const midX = (ax + bx) / 2;
  const midY = (a.y + b.y) / 2;

  // Curva bezier suave entre as 2 pontas pro visual ficar Tomodat-like.
  const cp1x = (ax + midX) / 2;
  const cp2x = (midX + bx) / 2;
  const path = `M ${ax} ${a.y} C ${cp1x} ${a.y}, ${cp2x} ${b.y}, ${bx} ${b.y}`;

  // Cor de borda baseada na classe de perda.
  const strokeColor =
    splice.lossClass === 'bad'
      ? '#dc2626'
      : splice.lossClass === 'warning'
        ? '#f59e0b'
        : splice.lossClass === 'good'
          ? '#0f172a'
          : '#94a3b8';

  return (
    <g style={{ cursor: 'pointer' }} onClick={onEdit}>
      <path d={path} stroke={strokeColor} strokeWidth={2} fill="none" />
      {/* Tesoura clicável no meio */}
      <g
        transform={`translate(${midX}, ${midY})`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        style={{ cursor: 'pointer' }}
      >
        <circle r={11} fill="white" stroke={CYL_STROKE} strokeWidth={1.5} />
        <text
          textAnchor="middle"
          y={4}
          fontSize={13}
          fontWeight={700}
          fill={CYL_STROKE}
        >
          ✂
        </text>
      </g>
      {/* Chip de loss */}
      {splice.lossDb != null && (
        <g transform={`translate(${midX}, ${midY - 22})`}>
          <rect
            x={-CHIP_WIDTH / 2}
            y={-9}
            width={CHIP_WIDTH}
            height={18}
            rx={4}
            fill="white"
            stroke={CYL_STROKE}
            strokeWidth={0.8}
          />
          <text
            textAnchor="middle"
            y={4}
            fontSize={10}
            fontFamily="ui-monospace, monospace"
            fill={CYL_STROKE}
          >
            {splice.lossDb.toFixed(2)} dB
          </text>
        </g>
      )}
    </g>
  );
}

// ─── Hotzone: área clicável invisível em cima de cada porta ────────────────
function PortHotzone({
  port,
  isSelected,
  isSpliced,
  onClick,
}: {
  port: PortPosition;
  isSelected: boolean;
  isSpliced: boolean;
  onClick: () => void;
}) {
  const w = 60;
  const h = PORT_HEIGHT;
  const xCenter = port.side === 'left' ? port.x + 15 : port.x - 15;
  return (
    <g
      onClick={onClick}
      style={{ cursor: isSpliced ? 'pointer' : 'crosshair' }}
    >
      <rect
        x={xCenter - w / 2}
        y={port.y - h / 2}
        width={w}
        height={h}
        fill="transparent"
        stroke={isSelected ? SELECTED_OUTLINE : 'transparent'}
        strokeWidth={2}
        strokeDasharray={isSelected ? '3 3' : undefined}
        rx={3}
      />
    </g>
  );
}

function SelectedHint({ port }: { port: PortPosition }) {
  // Pequena label flutuante avisando o operador o que fazer agora.
  const x = port.x + (port.side === 'left' ? 50 : -50);
  return (
    <g transform={`translate(${x}, ${port.y - 28})`}>
      <rect
        x={-90}
        y={-12}
        width={180}
        height={24}
        rx={4}
        fill="#fbbf24"
        stroke="#0f172a"
        strokeWidth={1}
      />
      <text textAnchor="middle" y={4} fontSize={11} fontWeight={600} fill="#0f172a">
        Clique outra porta livre →
      </text>
    </g>
  );
}

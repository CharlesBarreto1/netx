/**
 * FiberMap — grafo de conectividade óptica e caminhada de trace (FM-4, spec §4/§5).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Módulo PURO (sem Nest/Prisma) — mesmo padrão do instantiate-cable.ts: o
 * FibermapConnectivityGraphService carrega o componente conexo do banco e
 * delega aqui; os testes (trace-graph.spec.ts) exercitam com dados sintéticos
 * e cálculo manual documentado; o OTDR (FM-5) reusa opticalDistance/marcos.
 *
 * Modelo (spec §4):
 *   Nós    — pontas de fibra (FIBER:{id}:{A|B}), pontas de corte
 *            (CUT:{id}:{U|D} — U=lado A/upstream, D=lado B/downstream),
 *            portas (nó único por porta: as 2 faces C/F desembocam no mesmo
 *            nó, o que dá a passagem DIO de graça) e nó virtual por splitter.
 *   Arestas— fibra inteira A↔B ou sub-arestas entre cortes ordenados pela
 *            posição do elemento na cadeia de segmentos (peso = distância
 *            óptica §5.2, DEPENDENTE DA DIREÇÃO por causa das sobras);
 *            conexões (dist 0, perda = lossDb ?? default do kind);
 *            splitter IN↔DEV↔OUTs (perda no leg OUT, igual nos 2 sentidos;
 *            OUT→OUT proibido — luz não acopla entre saídas).
 *
 * Sobra técnica (§5.2): conta ao SAIR da caixa — soma as sobras do elemento
 * de partida e dos intermediários, exclui o de chegada. Por isso o peso da
 * aresta de fibra depende do sentido da caminhada.
 *
 * Splitter desbalanceado: OUT 1 = ramo TAP, demais = passante (convenção
 * documentada; tap_percent aproximado pra chave mais próxima 10/20/30/50).
 */
import {
  fibermapCutEndKey,
  fibermapFiberEndKey,
  type FibermapAttenuationKey,
  type FibermapTraceBranch,
  type FibermapTraceEvent,
  type FibermapTraceWavelength,
} from '@netx/shared';

// =============================================================================
// Tipos de entrada (componente conexo já carregado)
// =============================================================================
export interface TraceSegmentData {
  id: string;
  seq: number;
  fromElementId: string;
  toElementId: string;
  /** coalesce(medido, geográfico × excessFactor) — resolvido pelo chamador. */
  opticalLengthM: number;
  /** ST_Length::geography (trigger) — o OTDR converte ótico→fração geográfica. */
  geometricLengthM: number;
  /** Metragem de bobina/OTDR; null ⇒ ótico veio do geométrico (incerteza §5.5.6). */
  measuredLengthM: number | null;
  /** GeoJSON [[lng,lat],…] — vira o MultiLineString do highlight. */
  path: number[][];
}

export interface TraceCableData {
  id: string;
  name: string;
  /** Ordenados por seq; cadeia contígua (to do N = from do N+1, §14.4). */
  segments: TraceSegmentData[];
  slacks: Array<{ elementId: string; lengthM: number }>;
}

export interface TraceFiberData {
  id: string;
  cableId: string;
  fiberNumber: number;
  tubeNumber: number;
  color: string;
  cuts: Array<{ id: string; elementId: string }>;
}

export interface TracePortData {
  id: string;
  role: 'IN' | 'OUT' | 'BIDI';
  portNumber: number;
  label: string | null;
}

export interface TraceDeviceData {
  id: string;
  elementId: string;
  type: 'SPLITTER' | 'DIO' | 'OLT' | 'ONU_SHELF' | 'RACK';
  name: string;
  metadata: Record<string, unknown>;
  ports: TracePortData[];
}

export type TraceConnEndpoint =
  | { type: 'FIBER_END'; fiberId: string; side: 'A' | 'B' }
  | { type: 'CUT_END'; cutId: string; side: 'U' | 'D' }
  | { type: 'PORT'; portId: string };

export interface TraceConnectionData {
  id: string;
  elementId: string;
  kind: 'FUSION' | 'CONNECTOR' | 'SPLITTER_PATH';
  lossDb: number | null;
  a: TraceConnEndpoint;
  b: TraceConnEndpoint;
}

export interface TraceElementData {
  name: string;
  latitude: number;
  longitude: number;
}

export interface TraceGraphData {
  fibers: TraceFiberData[];
  cables: TraceCableData[];
  devices: TraceDeviceData[];
  connections: TraceConnectionData[];
  elements: Record<string, TraceElementData>;
  attenuation: Record<FibermapAttenuationKey, number>;
}

export type TraceOrigin =
  | { kind: 'FIBER_END'; fiberId: string; side: 'A' | 'B' }
  | { kind: 'CUT_END'; cutId: string; side: 'U' | 'D' }
  | { kind: 'PORT'; portId: string };

/** Erro de domínio — o service converte pra 400 amigável. */
export class TraceGraphError extends Error {}

const round2 = (v: number): number => Math.round(v * 100) / 100;

// =============================================================================
// Distância óptica (§5.2) — compartilhada com o OTDR (FM-5)
// =============================================================================
export interface OpticalHop {
  segment: TraceSegmentData;
  /** true = percorrido de to→from (OTDR usa ST_Reverse nesse caso, §5.5.4). */
  reversed: boolean;
  /** Sobra consumida ao SAIR do elemento de partida deste trecho. */
  slackBeforeM: number;
}

export interface OpticalDistanceResult {
  distanceM: number;
  /** Marcos {elemento, acumulado na CHEGADA} na ordem da caminhada. */
  milestones: Array<{ elementId: string; cumM: number }>;
  hops: OpticalHop[];
}

/** Cadeia de elementos do cabo: [from do seg 1, to do seg 1, to do seg 2, …]. */
export function cableElementChain(cable: TraceCableData): string[] {
  if (cable.segments.length === 0) return [];
  return [cable.segments[0].fromElementId, ...cable.segments.map((s) => s.toElementId)];
}

function slackAt(cable: TraceCableData, elementId: string): number {
  let sum = 0;
  for (const s of cable.slacks) if (s.elementId === elementId) sum += s.lengthM;
  return sum;
}

/**
 * Distância óptica entre duas posições da cadeia (índices em
 * cableElementChain). Regra §5.2: Σ optical_length dos segmentos + sobras do
 * elemento de partida e dos intermediários (chegada excluída).
 */
export function opticalDistanceByIndex(
  cable: TraceCableData,
  fromIdx: number,
  toIdx: number,
): OpticalDistanceResult {
  const chain = cableElementChain(cable);
  if (
    fromIdx < 0 ||
    toIdx < 0 ||
    fromIdx >= chain.length ||
    toIdx >= chain.length
  ) {
    throw new TraceGraphError(
      `índice fora da cadeia do cabo ${cable.name}: ${fromIdx}→${toIdx} (${chain.length} elementos)`,
    );
  }
  const milestones = [{ elementId: chain[fromIdx], cumM: 0 }];
  const hops: OpticalHop[] = [];
  let cum = 0;
  if (fromIdx <= toIdx) {
    for (let k = fromIdx; k < toIdx; k++) {
      const slack = slackAt(cable, chain[k]);
      cum += slack + cable.segments[k].opticalLengthM;
      hops.push({ segment: cable.segments[k], reversed: false, slackBeforeM: slack });
      milestones.push({ elementId: chain[k + 1], cumM: round2(cum) });
    }
  } else {
    for (let k = fromIdx - 1; k >= toIdx; k--) {
      const slack = slackAt(cable, chain[k + 1]);
      cum += slack + cable.segments[k].opticalLengthM;
      hops.push({ segment: cable.segments[k], reversed: true, slackBeforeM: slack });
      milestones.push({ elementId: chain[k], cumM: round2(cum) });
    }
  }
  return { distanceM: round2(cum), milestones, hops };
}

/** Variante por elemento (primeira ocorrência na cadeia) — conveniência FM-5. */
export function opticalDistance(
  cable: TraceCableData,
  fromElementId: string,
  toElementId: string,
): OpticalDistanceResult {
  const chain = cableElementChain(cable);
  const fromIdx = chain.indexOf(fromElementId);
  const toIdx = chain.indexOf(toElementId);
  if (fromIdx < 0 || toIdx < 0) {
    throw new TraceGraphError(
      `elemento fora da rota do cabo ${cable.name} (from=${fromElementId}, to=${toElementId})`,
    );
  }
  return opticalDistanceByIndex(cable, fromIdx, toIdx);
}

// =============================================================================
// Perda de splitter (§5.3)
// =============================================================================
function splitterOutCount(device: TraceDeviceData): number {
  const ratio = device.metadata?.ratio;
  if (typeof ratio === 'string') {
    const n = Number(ratio.split('x')[1]);
    if (Number.isFinite(n) && n >= 2) return n;
  }
  return Math.max(2, device.ports.filter((p) => p.role === 'OUT').length);
}

/**
 * Perda do ramo IN→OUT{n} do splitter. Balanceado: tabela SPLITTER_1_{N}.
 * Desbalanceado: OUT 1 = TAP, demais = passante (UNBALANCED_{p}_TAP/PASS com
 * p aproximado pra 10/20/30/50). Igual nos dois sentidos (§4).
 */
export function splitterBranchLossDb(
  device: TraceDeviceData,
  outPortNumber: number,
  attenuation: Record<FibermapAttenuationKey, number>,
): number {
  const outs = splitterOutCount(device);
  if (device.metadata?.topology === 'UNBALANCED') {
    const tapRaw = Number(device.metadata?.tap_percent ?? 10);
    const tap = [10, 20, 30, 50].reduce(
      (best, p) => (Math.abs(p - tapRaw) < Math.abs(best - tapRaw) ? p : best),
      10,
    );
    const key = `UNBALANCED_${tap}_${outPortNumber === 1 ? 'TAP' : 'PASS'}` as FibermapAttenuationKey;
    return attenuation[key] ?? 3.7;
  }
  const key = `SPLITTER_1_${outs}` as FibermapAttenuationKey;
  // Razão fora da tabela (produto exótico): aproximação 10·log10(N) + 1 dB.
  return attenuation[key] ?? round2(10 * Math.log10(outs) + 1);
}

// =============================================================================
// Pedaços de fibra (sub-arestas entre pontas e cortes) — OTDR (FM-5) reusa
// =============================================================================
export interface FiberPiece {
  /** Id determinístico da aresta no grafo: F:{fiberId}:{i}. */
  edgeId: string;
  /** Índices na cadeia de elementos do cabo (lo = lado A, hi = lado B). */
  loIdx: number;
  hiIdx: number;
  /** Chaves dos nós de fronteira (FIBER:{id}:{A|B} ou CUT:{id}:{U|D}). */
  loKey: string;
  hiKey: string;
}

/** Pedaços da fibra na ordem A→B: pontas + cortes interiores ordenados. */
export function fiberPieces(fiber: TraceFiberData, cable: TraceCableData): FiberPiece[] {
  const chain = cableElementChain(cable);
  if (chain.length === 0) return [];
  const cuts = fiber.cuts
    .map((cut) => ({ cut, idx: chain.indexOf(cut.elementId) }))
    .filter((c) => c.idx > 0 && c.idx < chain.length - 1)
    .sort((a, b) => a.idx - b.idx);
  const pieces: FiberPiece[] = [];
  let lo = { idx: 0, key: fibermapFiberEndKey(fiber.id, 'A') };
  for (const { cut, idx } of cuts) {
    pieces.push({
      edgeId: `F:${fiber.id}:${pieces.length}`,
      loIdx: lo.idx,
      hiIdx: idx,
      loKey: lo.key,
      hiKey: fibermapCutEndKey(cut.id, 'U'),
    });
    lo = { idx, key: fibermapCutEndKey(cut.id, 'D') };
  }
  pieces.push({
    edgeId: `F:${fiber.id}:${pieces.length}`,
    loIdx: lo.idx,
    hiIdx: chain.length - 1,
    loKey: lo.key,
    hiKey: fibermapFiberEndKey(fiber.id, 'B'),
  });
  return pieces;
}

// =============================================================================
// Construção do grafo
// =============================================================================
export type NodeType = 'FIBER_END' | 'CUT_END' | 'PORT' | 'DEV';

export interface GraphNode {
  key: string;
  type: NodeType;
  elementId: string | null;
  fiber?: TraceFiberData;
  port?: TracePortData;
  device?: TraceDeviceData;
}

export interface GraphEdge {
  id: string;
  kind: 'FIBER' | 'CONN' | 'SPL_IN' | 'SPL_OUT';
  a: string;
  b: string;
  // FIBER
  fiber?: TraceFiberData;
  cable?: TraceCableData;
  aChainIdx?: number;
  bChainIdx?: number;
  // CONN
  conn?: TraceConnectionData;
  // SPL_*
  device?: TraceDeviceData;
  outPort?: TracePortData;
}

export interface TraceGraph {
  nodes: Map<string, GraphNode>;
  adj: Map<string, GraphEdge[]>;
}

const portNodeKey = (portId: string): string => `PORTNODE:${portId}`;
const devNodeKey = (deviceId: string): string => `DEV:${deviceId}`;

export function buildTraceGraph(data: TraceGraphData): TraceGraph {
  const nodes = new Map<string, GraphNode>();
  const adj = new Map<string, GraphEdge[]>();
  const cablesById = new Map(data.cables.map((c) => [c.id, c]));

  const addNode = (n: GraphNode): void => {
    if (!nodes.has(n.key)) nodes.set(n.key, n);
  };
  const addEdge = (e: GraphEdge): void => {
    for (const key of [e.a, e.b]) {
      const list = adj.get(key);
      if (list) list.push(e);
      else adj.set(key, [e]);
    }
  };

  // ── Portas e splitters ────────────────────────────────────────────────────
  for (const device of data.devices) {
    for (const port of device.ports) {
      addNode({
        key: portNodeKey(port.id),
        type: 'PORT',
        elementId: device.elementId,
        port,
        device,
      });
    }
    if (device.type !== 'SPLITTER') continue;
    const dev: GraphNode = {
      key: devNodeKey(device.id),
      type: 'DEV',
      elementId: device.elementId,
      device,
    };
    addNode(dev);
    const inPort = device.ports.find((p) => p.role === 'IN');
    if (inPort) {
      addEdge({
        id: `S:${device.id}:IN`,
        kind: 'SPL_IN',
        a: portNodeKey(inPort.id),
        b: dev.key,
        device,
      });
    }
    for (const out of device.ports.filter((p) => p.role === 'OUT')) {
      addEdge({
        id: `S:${device.id}:OUT:${out.portNumber}`,
        kind: 'SPL_OUT',
        a: dev.key,
        b: portNodeKey(out.id),
        device,
        outPort: out,
      });
    }
  }

  // ── Fibras: sub-arestas entre pontas e cortes (fiberPieces — FM-5 reusa) ──
  for (const fiber of data.fibers) {
    const cable = cablesById.get(fiber.cableId);
    if (!cable || cable.segments.length === 0) continue;
    const chain = cableElementChain(cable);
    const ensureBoundary = (key: string, idx: number): void =>
      addNode({
        key,
        type: key.startsWith('CUT:') ? 'CUT_END' : 'FIBER_END',
        elementId: chain[idx],
        fiber,
      });
    for (const piece of fiberPieces(fiber, cable)) {
      ensureBoundary(piece.loKey, piece.loIdx);
      ensureBoundary(piece.hiKey, piece.hiIdx);
      addEdge({
        id: piece.edgeId,
        kind: 'FIBER',
        a: piece.loKey,
        b: piece.hiKey,
        fiber,
        cable,
        aChainIdx: piece.loIdx,
        bChainIdx: piece.hiIdx,
      });
    }
  }

  // ── Conexões ──────────────────────────────────────────────────────────────
  const endpointKeyOf = (e: TraceConnEndpoint): string =>
    e.type === 'PORT'
      ? portNodeKey(e.portId)
      : e.type === 'CUT_END'
        ? fibermapCutEndKey(e.cutId, e.side)
        : fibermapFiberEndKey(e.fiberId, e.side);

  for (const conn of data.connections) {
    const aKey = endpointKeyOf(conn.a);
    const bKey = endpointKeyOf(conn.b);
    // Endpoint fora do componente carregado (planta inconsistente) — ignora a
    // conexão em vez de quebrar o trace inteiro.
    if (!nodes.has(aKey) || !nodes.has(bKey)) continue;
    addEdge({ id: `C:${conn.id}`, kind: 'CONN', a: aKey, b: bKey, conn });
  }

  return { nodes, adj };
}

// =============================================================================
// Caminhada (trace)
// =============================================================================
export interface TraceWalkResult {
  path: FibermapTraceEvent[];
  maxDistanceM: number;
  maxLossDb: number;
  /** Segmentos percorridos, na ordem da visita, sem repetição. */
  traversedSegments: TraceSegmentData[];
}

export function originNodeKey(origin: TraceOrigin): string {
  return origin.kind === 'PORT'
    ? portNodeKey(origin.portId)
    : origin.kind === 'CUT_END'
      ? fibermapCutEndKey(origin.cutId, origin.side)
      : fibermapFiberEndKey(origin.fiberId, origin.side);
}

interface RootChoice {
  rootKey: string;
  /** Splitters atravessados OUT→IN na normalização: device → OUT a seguir. */
  restrictedOuts: Map<string, number>;
}

/**
 * Normalização da raiz: caminha cada braço a partir do endpoint pedido; um
 * braço é "de subida" quando é determinístico (splitter só OUT→IN, sem
 * fan-out) e termina num nó livre. Se algum termina em PORTA (preferência:
 * OLT), o trace é apresentado a partir dela; senão parte do próprio endpoint.
 */
function findRoot(graph: TraceGraph, originKey: string): RootChoice {
  interface ArmResult {
    terminalKey: string;
    isPort: boolean;
    isOltPort: boolean;
    restricted: Map<string, number>;
  }
  const viable: ArmResult[] = [];

  for (const arm of graph.adj.get(originKey) ?? []) {
    const restricted = new Map<string, number>();
    const seen = new Set<string>([originKey]);
    let cameEdge = arm;
    let cur = arm.a === originKey ? arm.b : arm.a;
    let result: ArmResult | null = null;

    for (let hops = 0; hops < 100_000; hops++) {
      if (seen.has(cur)) break; // laço — braço não viável
      seen.add(cur);
      const node = graph.nodes.get(cur);
      if (!node) break;
      if (node.type === 'DEV') {
        if (cameEdge.kind !== 'SPL_OUT') break; // entrou pelo IN → downstream
        restricted.set(node.device!.id, cameEdge.outPort!.portNumber);
        const inEdge = (graph.adj.get(cur) ?? []).find((e) => e.kind === 'SPL_IN');
        if (!inEdge) break; // splitter sem IN — planta quebrada
        cameEdge = inEdge;
        cur = inEdge.a === cur ? inEdge.b : inEdge.a;
        continue;
      }
      const nexts = (graph.adj.get(cur) ?? []).filter((e) => e !== cameEdge);
      if (nexts.length === 0) {
        result = {
          terminalKey: cur,
          isPort: node.type === 'PORT',
          isOltPort: node.type === 'PORT' && node.device?.type === 'OLT',
          restricted,
        };
        break;
      }
      if (nexts.length > 1) break; // ambíguo — não é subida
      cameEdge = nexts[0];
      cur = cameEdge.a === cur ? cameEdge.b : cameEdge.a;
    }
    if (result) viable.push(result);
  }

  const chosen =
    viable.find((v) => v.isOltPort) ?? viable.find((v) => v.isPort) ?? null;
  return chosen
    ? { rootKey: chosen.terminalKey, restrictedOuts: chosen.restricted }
    : { rootKey: originKey, restrictedOuts: new Map() };
}

export function walkTrace(
  data: TraceGraphData,
  origin: TraceOrigin,
  wavelengthNm: FibermapTraceWavelength,
): TraceWalkResult {
  const graph = buildTraceGraph(data);
  const originKey = originNodeKey(origin);
  if (!graph.nodes.has(originKey)) {
    throw new TraceGraphError(
      'Endpoint de origem fora do grafo — o cabo tem segmentos desenhados?',
    );
  }
  const { rootKey, restrictedOuts } = findRoot(graph, originKey);

  const attn = data.attenuation;
  const fiberAttnPerKm = attn[`FIBER_${wavelengthNm}` as FibermapAttenuationKey] ?? 0.28;
  const visitedEdges = new Set<string>();
  const traversedSegments: TraceSegmentData[] = [];
  const seenSegments = new Set<string>();
  const stats = { maxD: 0, maxL: 0 };

  const elementInfo = (
    elementId: string | null,
  ): Pick<FibermapTraceEvent, 'elementId' | 'elementName' | 'latitude' | 'longitude'> => {
    if (!elementId) return {};
    const el = data.elements[elementId];
    return el
      ? {
          elementId,
          elementName: el.name,
          latitude: el.latitude,
          longitude: el.longitude,
        }
      : { elementId };
  };

  const pushEnd = (
    out: FibermapTraceEvent[],
    elementId: string | null,
    endReason: 'FREE_END' | 'LOOP',
    cumD: number,
    cumL: number,
  ): void => {
    out.push({
      kind: 'END',
      endReason,
      ...elementInfo(elementId),
      cumDistanceM: round2(cumD),
      cumLossDb: round2(cumL),
    });
    if (cumD > stats.maxD) stats.maxD = cumD;
    if (cumL > stats.maxL) stats.maxL = cumL;
  };

  const splitterEventBase = (
    device: TraceDeviceData,
    outCount: number,
  ): Omit<FibermapTraceEvent, 'cumDistanceM' | 'cumLossDb'> => ({
    kind: 'SPLITTER',
    deviceId: device.id,
    deviceName: device.name,
    deviceType: device.type,
    ratio: String(device.metadata?.ratio ?? `1x${outCount}`),
    branchCount: outCount,
    ...elementInfo(device.elementId),
  });

  /** Emite o(s) evento(s) do nó atual e segue pelas arestas restantes. */
  const step = (
    nodeKey: string,
    cameEdge: GraphEdge | null,
    cumD: number,
    cumL: number,
    out: FibermapTraceEvent[],
    pendingLossDb: number | null,
  ): void => {
    const node = graph.nodes.get(nodeKey);
    if (!node) return;

    if (node.type === 'DEV') {
      const device = node.device!;
      const outEdges = (graph.adj.get(nodeKey) ?? [])
        .filter((e) => e.kind === 'SPL_OUT')
        .sort((x, y) => x.outPort!.portNumber - y.outPort!.portNumber);
      const inEdge = (graph.adj.get(nodeKey) ?? []).find((e) => e.kind === 'SPL_IN');

      if (cameEdge?.kind === 'SPL_OUT') {
        // Upstream: OUT→IN, mesma perda do ramo (§4) — nunca OUT→OUT.
        const n = cameEdge.outPort!.portNumber;
        const loss = splitterBranchLossDb(device, n, attn);
        const cumL2 = cumL + loss;
        out.push({
          ...splitterEventBase(device, outEdges.length),
          lossDb: round2(loss),
          branchTaken: n,
          cumDistanceM: round2(cumD),
          cumLossDb: round2(cumL2),
        });
        if (!inEdge || visitedEdges.has(inEdge.id)) {
          pushEnd(out, device.elementId, inEdge ? 'LOOP' : 'FREE_END', cumD, cumL2);
          return;
        }
        visitedEdges.add(inEdge.id);
        step(inEdge.a === nodeKey ? inEdge.b : inEdge.a, inEdge, cumD, cumL2, out, null);
        return;
      }

      // Downstream (entrou pelo IN): restrito na normalização ou fan-out.
      const usable = outEdges.filter((e) => !visitedEdges.has(e.id));
      const restricted = restrictedOuts.get(device.id);
      if (restricted != null) {
        const edge = usable.find((e) => e.outPort!.portNumber === restricted);
        const loss = splitterBranchLossDb(device, restricted, attn);
        const cumL2 = cumL + loss;
        out.push({
          ...splitterEventBase(device, outEdges.length),
          lossDb: round2(loss),
          branchTaken: restricted,
          cumDistanceM: round2(cumD),
          cumLossDb: round2(cumL2),
        });
        if (!edge) {
          pushEnd(out, device.elementId, 'LOOP', cumD, cumL2);
          return;
        }
        visitedEdges.add(edge.id);
        step(edge.a === nodeKey ? edge.b : edge.a, edge, cumD, cumL2, out, null);
        return;
      }

      const balanced = device.metadata?.topology !== 'UNBALANCED';
      const event: FibermapTraceEvent = {
        ...splitterEventBase(device, outEdges.length),
        ...(balanced && usable.length
          ? { lossDb: round2(splitterBranchLossDb(device, usable[0].outPort!.portNumber, attn)) }
          : {}),
        cumDistanceM: round2(cumD),
        cumLossDb: round2(cumL),
      };
      const branches: FibermapTraceBranch[] = [];
      for (const edge of usable) {
        const n = edge.outPort!.portNumber;
        const loss = splitterBranchLossDb(device, n, attn);
        visitedEdges.add(edge.id);
        const events: FibermapTraceEvent[] = [];
        step(edge.a === nodeKey ? edge.b : edge.a, edge, cumD, cumL + loss, events, loss);
        branches.push({ outPortNumber: n, outPortLabel: edge.outPort!.label, events });
      }
      event.branches = branches;
      out.push(event);
      if (usable.length === 0) pushEnd(out, device.elementId, 'LOOP', cumD, cumL);
      return;
    }

    if (node.type === 'PORT') {
      out.push({
        kind: 'PORT',
        deviceId: node.device!.id,
        deviceName: node.device!.name,
        deviceType: node.device!.type,
        portId: node.port!.id,
        portLabel: node.port!.label ?? `#${node.port!.portNumber}`,
        portRole: node.port!.role,
        ...(pendingLossDb != null ? { lossDb: round2(pendingLossDb) } : {}),
        ...elementInfo(node.elementId),
        cumDistanceM: round2(cumD),
        cumLossDb: round2(cumL),
      });
    }

    const others = (graph.adj.get(nodeKey) ?? []).filter((e) => e !== cameEdge);
    const conts = others.filter((e) => !visitedEdges.has(e.id));
    if (conts.length === 0) {
      pushEnd(out, node.elementId, others.length > 0 ? 'LOOP' : 'FREE_END', cumD, cumL);
      return;
    }
    // >1 continuação só acontece quando a raiz é o próprio endpoint com dois
    // braços não normalizáveis — DFS sequencial na lista plana (END separa).
    for (const edge of conts) {
      if (visitedEdges.has(edge.id)) continue;
      visitedEdges.add(edge.id);
      traverse(edge, nodeKey, cumD, cumL, out);
    }
  };

  /** Cruza uma aresta emitindo o evento dela e delega ao nó de destino. */
  const traverse = (
    edge: GraphEdge,
    fromKey: string,
    cumD: number,
    cumL: number,
    out: FibermapTraceEvent[],
  ): void => {
    const toKey = edge.a === fromKey ? edge.b : edge.a;
    if (edge.kind === 'CONN') {
      const conn = edge.conn!;
      const loss =
        conn.lossDb ??
        (conn.kind === 'FUSION'
          ? attn.FUSION
          : conn.kind === 'CONNECTOR'
            ? attn.CONNECTOR_PAIR
            : 0);
      const cumL2 = cumL + loss;
      out.push({
        kind: conn.kind === 'CONNECTOR' ? 'CONNECTOR' : 'FUSION',
        connectionId: conn.id,
        lossDb: round2(loss),
        ...elementInfo(conn.elementId),
        cumDistanceM: round2(cumD),
        cumLossDb: round2(cumL2),
      });
      step(toKey, edge, cumD, cumL2, out, null);
      return;
    }
    if (edge.kind === 'FIBER') {
      const entryIdx = fromKey === edge.a ? edge.aChainIdx! : edge.bChainIdx!;
      const exitIdx = fromKey === edge.a ? edge.bChainIdx! : edge.aChainIdx!;
      const od = opticalDistanceByIndex(edge.cable!, entryIdx, exitIdx);
      const loss = (od.distanceM / 1000) * fiberAttnPerKm;
      const cumD2 = cumD + od.distanceM;
      const cumL2 = cumL + loss;
      for (const hop of od.hops) {
        if (!seenSegments.has(hop.segment.id)) {
          seenSegments.add(hop.segment.id);
          traversedSegments.push(hop.segment);
        }
      }
      const exitNode = graph.nodes.get(toKey);
      out.push({
        kind: 'FIBER',
        cableId: edge.cable!.id,
        cableName: edge.cable!.name,
        fiberId: edge.fiber!.id,
        fiberNumber: edge.fiber!.fiberNumber,
        tubeNumber: edge.fiber!.tubeNumber,
        fiberColor: edge.fiber!.color,
        lengthM: od.distanceM,
        lossDb: round2(loss),
        ...elementInfo(exitNode?.elementId ?? null),
        cumDistanceM: round2(cumD2),
        cumLossDb: round2(cumL2),
      });
      step(toKey, edge, cumD2, cumL2, out, null);
      return;
    }
    // SPL_IN/SPL_OUT: sem evento próprio — o nó DEV decide (perda no ramo).
    step(toKey, edge, cumD, cumL, out, null);
  };

  const path: FibermapTraceEvent[] = [];
  step(rootKey, null, 0, 0, path, null);

  return {
    path,
    maxDistanceM: round2(stats.maxD),
    maxLossDb: round2(stats.maxL),
    traversedSegments,
  };
}

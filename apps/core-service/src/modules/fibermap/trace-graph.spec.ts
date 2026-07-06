/**
 * FiberMap — testes do grafo de conectividade e trace (FM-4, aceite spec §13).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Planta sintética ESPELHANDO a fixture FM-0 (seed-fibermap-fixture.ts), mas
 * com comprimentos determinísticos pro cálculo manual bater em ±0,01 m/dB:
 *
 *   POP ──s11── CEO11 ──s12── CEO12 ──s21── CEO13 ──s22── CTO01
 *   cabo1 BB-CPM-R1 (ASU 12FO): s11 ótico 510,00 (500 geo × 1,02),
 *     s12 ótico 1000,00 (medido) · sobra 30 m em CEO11
 *   cabo2 DIST-GUA-R2 (AS 36FO): s21 816,00 (800×1,02), s22 204,00 (200×1,02)
 *     · sobra 25 m em CEO13
 *   POP: OLT (PON 1) →conector→ DIO p1 →fusão 0,10→ cabo1 f1 (lado A)
 *   CEO12: cabo1 f1 B →fusão 0,05→ cabo2 f1 A
 *   CTO01: cabo2 f1 B →fusão 0,08→ splitter 1x8 IN
 *   cabo2 f2: cortada em CEO13 (sem fusões) — pontas U/D livres
 *
 * ── Cálculo manual (λ=1490 nm ⇒ 0,28 dB/km; conector 0,50; defaults §5.3) ──
 *   FIBRA cabo1 f1 (POP→CEO12): 510 + 1000 + sobra 30 (CEO11, intermediário)
 *     = 1540,00 m · perda 1,540 × 0,28 = 0,4312 dB
 *   FIBRA cabo2 f1 (CEO12→CTO01): 816 + 204 + sobra 25 (CEO13) = 1045,00 m
 *     · perda 1,045 × 0,28 = 0,2926 dB
 *
 *   evento                 dist(m)   perda(dB)   Σdist       ΣdB
 *   PORT OLT PON 1               0          —        0,00    0,00
 *   CONNECTOR (par)              0       0,50        0,00    0,50
 *   PORT DIO p1                  0          —        0,00    0,50
 *   FUSION (pigtail)             0       0,10        0,00    0,60
 *   FIBER cabo1 f1         1540,00     0,4312     1540,00    1,03  (1,0312)
 *   FUSION CEO12                 0       0,05     1540,00    1,08  (1,0812)
 *   FIBER cabo2 f1         1045,00     0,2926     2585,00    1,37  (1,3738)
 *   FUSION CTO01                 0       0,08     2585,00    1,45  (1,4538)
 *   PORT splitter IN             0          —     2585,00    1,45
 *   SPLITTER 1x8 (÷8)            0      10,50     2585,00   11,95  (11,9538)
 */
import { FIBERMAP_ATTENUATION_DEFAULTS } from '@netx/shared';

import {
  opticalDistance,
  splitterBranchLossDb,
  walkTrace,
  type TraceDeviceData,
  type TraceGraphData,
} from './trace-graph';

// ─────────────────────────────────────────────────────────────────────────────
// Planta sintética
// ─────────────────────────────────────────────────────────────────────────────
const EL = {
  pop: 'el-pop',
  ceo11: 'el-ceo11',
  ceo12: 'el-ceo12',
  ceo13: 'el-ceo13',
  cto01: 'el-cto01',
} as const;

const seg = (
  id: string,
  seq: number,
  from: string,
  to: string,
  opticalLengthM: number,
  opts: { geometricLengthM?: number; measuredLengthM?: number | null } = {},
) => ({
  id,
  seq,
  fromElementId: from,
  toElementId: to,
  opticalLengthM,
  // Default: ótico derivado do geométrico (sem medido) — os testes de OTDR
  // passam valores explícitos quando a distinção importa (§5.5.6).
  geometricLengthM: opts.geometricLengthM ?? opticalLengthM,
  measuredLengthM: opts.measuredLengthM ?? null,
  path: [[0, 0], [1, 1]] as number[][],
});

const port = (id: string, role: 'IN' | 'OUT' | 'BIDI', n: number, label: string) => ({
  id,
  role,
  portNumber: n,
  label,
});

function makeSplitter(overrides?: Partial<TraceDeviceData>): TraceDeviceData {
  return {
    id: 'dev-sp',
    elementId: EL.cto01,
    type: 'SPLITTER',
    name: 'SP-CPM 1x8',
    metadata: { ratio: '1x8', topology: 'BALANCED' },
    ports: [
      port('p-sp-in', 'IN', 1, 'IN'),
      ...Array.from({ length: 8 }, (_, i) =>
        port(`p-sp-out${i + 1}`, 'OUT' as const, i + 1, `OUT ${i + 1}`),
      ),
    ],
    ...overrides,
  };
}

/** Planta completa (com OLT). `semOlt` remove OLT/DIO e suas conexões. */
function makeData(opts: { semOlt?: boolean } = {}): TraceGraphData {
  const devices: TraceDeviceData[] = [makeSplitter()];
  if (!opts.semOlt) {
    devices.push(
      {
        id: 'dev-olt',
        elementId: EL.pop,
        type: 'OLT',
        name: 'OLT-CPM-01',
        metadata: { pon_ports: 2 },
        ports: [port('p-olt-1', 'BIDI', 1, 'PON 0/1/1'), port('p-olt-2', 'BIDI', 2, 'PON 0/1/2')],
      },
      {
        id: 'dev-dio',
        elementId: EL.pop,
        type: 'DIO',
        name: 'DIO-01',
        metadata: { ports: 2 },
        ports: [port('p-dio-1', 'BIDI', 1, 'Porta 01'), port('p-dio-2', 'BIDI', 2, 'Porta 02')],
      },
    );
  }
  return {
    cables: [
      {
        id: 'cab-1',
        name: 'BB-CPM-R1',
        segments: [
          seg('s11', 1, EL.pop, EL.ceo11, 510.0, { geometricLengthM: 500 }),
          seg('s12', 2, EL.ceo11, EL.ceo12, 1000.0, {
            geometricLengthM: 985,
            measuredLengthM: 1000,
          }),
        ],
        slacks: [{ elementId: EL.ceo11, lengthM: 30 }],
      },
      {
        id: 'cab-2',
        name: 'DIST-GUA-R2',
        segments: [
          seg('s21', 1, EL.ceo12, EL.ceo13, 816.0, { geometricLengthM: 800 }),
          seg('s22', 2, EL.ceo13, EL.cto01, 204.0, { geometricLengthM: 200 }),
        ],
        slacks: [{ elementId: EL.ceo13, lengthM: 25 }],
      },
    ],
    fibers: [
      { id: 'f11', cableId: 'cab-1', fiberNumber: 1, tubeNumber: 1, color: 'VERDE', cuts: [] },
      { id: 'f21', cableId: 'cab-2', fiberNumber: 1, tubeNumber: 1, color: 'VERDE', cuts: [] },
      {
        id: 'f22',
        cableId: 'cab-2',
        fiberNumber: 2,
        tubeNumber: 1,
        color: 'AMARELA',
        cuts: [{ id: 'cut-22', elementId: EL.ceo13 }],
      },
    ],
    devices,
    connections: [
      ...(opts.semOlt
        ? []
        : ([
            {
              id: 'c1',
              elementId: EL.pop,
              kind: 'CONNECTOR',
              lossDb: null, // default do par: 0,50
              a: { type: 'PORT', portId: 'p-olt-1' },
              b: { type: 'PORT', portId: 'p-dio-1' },
            },
            {
              id: 'c2',
              elementId: EL.pop,
              kind: 'FUSION',
              lossDb: 0.1,
              a: { type: 'PORT', portId: 'p-dio-1' },
              b: { type: 'FIBER_END', fiberId: 'f11', side: 'A' },
            },
          ] satisfies TraceGraphData['connections'])),
      {
        id: 'c3',
        elementId: EL.ceo12,
        kind: 'FUSION',
        lossDb: 0.05,
        a: { type: 'FIBER_END', fiberId: 'f11', side: 'B' },
        b: { type: 'FIBER_END', fiberId: 'f21', side: 'A' },
      },
      {
        id: 'c4',
        elementId: EL.cto01,
        kind: 'FUSION',
        lossDb: 0.08,
        a: { type: 'FIBER_END', fiberId: 'f21', side: 'B' },
        b: { type: 'PORT', portId: 'p-sp-in' },
      },
    ],
    elements: {
      [EL.pop]: { name: 'POP-CPM', latitude: -24.046, longitude: -52.378 },
      [EL.ceo11]: { name: 'CPN-011', latitude: -24.049, longitude: -52.3745 },
      [EL.ceo12]: { name: 'CPN-012', latitude: -24.0525, longitude: -52.371 },
      [EL.ceo13]: { name: 'CPN-013', latitude: -24.056, longitude: -52.3672 },
      [EL.cto01]: { name: 'CTO-CPM-01', latitude: -24.0585, longitude: -52.365 },
    },
    attenuation: { ...FIBERMAP_ATTENUATION_DEFAULTS },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// opticalDistance (§5.2) — sobra sai incluída, chegada excluída
// ─────────────────────────────────────────────────────────────────────────────
describe('opticalDistance (spec §5.2)', () => {
  const cable2 = makeData().cables[1];

  it('soma segmentos + sobras (partida e intermediários; chegada excluída)', () => {
    const r = opticalDistance(cable2, EL.ceo12, EL.cto01);
    // 816 (sobra CEO12 = 0) + 25 + 204 = 1045
    expect(r.distanceM).toBeCloseTo(1045.0, 2);
    expect(r.milestones).toEqual([
      { elementId: EL.ceo12, cumM: 0 },
      { elementId: EL.ceo13, cumM: 816.0 }, // chegada em CEO13: sobra ainda não
      { elementId: EL.cto01, cumM: 1045.0 },
    ]);
    expect(r.hops.map((h) => h.reversed)).toEqual([false, false]);
    expect(r.hops.map((h) => h.slackBeforeM)).toEqual([0, 25]);
  });

  it('sentido inverso: mesma sobra intermediária, marcos invertidos', () => {
    const r = opticalDistance(cable2, EL.cto01, EL.ceo12);
    expect(r.distanceM).toBeCloseTo(1045.0, 2);
    expect(r.milestones).toEqual([
      { elementId: EL.cto01, cumM: 0 },
      { elementId: EL.ceo13, cumM: 204.0 },
      { elementId: EL.ceo12, cumM: 1045.0 },
    ]);
    expect(r.hops.map((h) => h.reversed)).toEqual([true, true]);
    expect(r.hops.map((h) => h.slackBeforeM)).toEqual([0, 25]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Trace fim-a-fim (aceite FM-4: ±0,01 m / ±0,01 dB)
// ─────────────────────────────────────────────────────────────────────────────
describe('walkTrace — cálculo manual da planta (aceite FM-4)', () => {
  it('trace da porta da OLT reproduz a tabela do cabeçalho', () => {
    const r = walkTrace(makeData(), { kind: 'PORT', portId: 'p-olt-1' }, 1490);

    expect(r.path.map((e) => e.kind)).toEqual([
      'PORT', // OLT PON 1
      'CONNECTOR',
      'PORT', // DIO p1
      'FUSION',
      'FIBER', // cabo1 f1
      'FUSION', // CEO12
      'FIBER', // cabo2 f1
      'FUSION', // CTO01
      'PORT', // splitter IN
      'SPLITTER',
    ]);

    const [olt, connector, , fusaoDio, fibra1, fusaoCeo12, fibra2, fusaoCto, spIn, splitter] =
      r.path;
    expect(olt.portLabel).toBe('PON 0/1/1');
    expect(olt.cumDistanceM).toBe(0);
    expect(connector.lossDb).toBeCloseTo(0.5, 2);
    expect(fusaoDio.cumLossDb).toBeCloseTo(0.6, 2);

    expect(fibra1.cableName).toBe('BB-CPM-R1');
    expect(fibra1.lengthM).toBeCloseTo(1540.0, 2); // 510 + 1000 + sobra 30
    expect(fibra1.lossDb).toBeCloseTo(0.43, 2); // 1,540 × 0,28 = 0,4312
    expect(fibra1.cumDistanceM).toBeCloseTo(1540.0, 2);
    expect(fibra1.cumLossDb).toBeCloseTo(1.03, 2);

    expect(fusaoCeo12.elementName).toBe('CPN-012');
    expect(fusaoCeo12.cumLossDb).toBeCloseTo(1.08, 2);

    expect(fibra2.lengthM).toBeCloseTo(1045.0, 2); // 816 + 204 + sobra 25
    expect(fibra2.cumDistanceM).toBeCloseTo(2585.0, 2);
    expect(fibra2.cumLossDb).toBeCloseTo(1.37, 2);

    expect(fusaoCto.cumLossDb).toBeCloseTo(1.45, 2);
    expect(spIn.portRole).toBe('IN');

    // Ramificação downstream: 8 sub-caminhos, perda 10,5 aplicada por ramo.
    expect(splitter.ratio).toBe('1x8');
    expect(splitter.lossDb).toBeCloseTo(10.5, 2);
    expect(splitter.branches).toHaveLength(8);
    expect(splitter.branches!.map((b) => b.outPortNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const branch of splitter.branches!) {
      const [outPort, end] = branch.events;
      expect(outPort.kind).toBe('PORT');
      expect(outPort.lossDb).toBeCloseTo(10.5, 2);
      expect(outPort.cumLossDb).toBeCloseTo(11.95, 2); // 1,4538 + 10,5
      expect(end.kind).toBe('END');
      expect(end.endReason).toBe('FREE_END');
    }

    expect(r.maxDistanceM).toBeCloseTo(2585.0, 2);
    expect(r.maxLossDb).toBeCloseTo(11.95, 2);
    // Highlight: os 4 segmentos na ordem da caminhada.
    expect(r.traversedSegments.map((s) => s.id)).toEqual(['s11', 's12', 's21', 's22']);
  });

  it('trace de fibra no meio do caminho normaliza a raiz na OLT', () => {
    const r = walkTrace(
      makeData(),
      { kind: 'FIBER_END', fiberId: 'f21', side: 'A' },
      1490,
    );
    expect(r.path[0].kind).toBe('PORT');
    expect(r.path[0].deviceName).toBe('OLT-CPM-01');
    expect(r.maxDistanceM).toBeCloseTo(2585.0, 2);
    expect(r.maxLossDb).toBeCloseTo(11.95, 2);
  });

  it('trace da OUT 3: caminho linear com branchTaken (sem árvore)', () => {
    const r = walkTrace(makeData(), { kind: 'PORT', portId: 'p-sp-out3' }, 1490);
    expect(r.path[0].deviceName).toBe('OLT-CPM-01');
    const splitter = r.path.find((e) => e.kind === 'SPLITTER')!;
    expect(splitter.branchTaken).toBe(3);
    expect(splitter.branchCount).toBe(8);
    expect(splitter.branches).toBeUndefined();
    const end = r.path[r.path.length - 1];
    expect(end.kind).toBe('END');
    expect(end.cumLossDb).toBeCloseTo(11.95, 2);
    expect(end.cumDistanceM).toBeCloseTo(2585.0, 2);
  });

  it('upstream sem OLT: OUT converge só pra IN com a mesma perda do ramo', () => {
    const r = walkTrace(
      makeData({ semOlt: true }),
      { kind: 'PORT', portId: 'p-sp-out3' },
      1490,
    );
    expect(r.path.map((e) => e.kind)).toEqual([
      'PORT', // OUT 3 (origem — não há terminal de porta acima)
      'SPLITTER', // convergência OUT→IN
      'PORT', // IN
      'FUSION', // CTO01, 0,08
      'FIBER', // cabo2 f1 (invertida): 1045,00
      'FUSION', // CEO12, 0,05
      'FIBER', // cabo1 f1 (invertida): 1540,00
      'END', // ponta A livre no POP
    ]);
    const splitter = r.path[1];
    expect(splitter.branchTaken).toBe(3);
    expect(splitter.lossDb).toBeCloseTo(10.5, 2);
    // 10,5 + 0,08 + 0,2926 + 0,05 + 0,4312 = 11,3538
    expect(r.maxLossDb).toBeCloseTo(11.35, 2);
    expect(r.maxDistanceM).toBeCloseTo(2585.0, 2);
    // Fibras percorridas de B→A mantêm o mesmo comprimento (sobras idem —
    // CEO11/CEO13 são intermediários nos dois sentidos).
    const fibras = r.path.filter((e) => e.kind === 'FIBER');
    expect(fibras[0].lengthM).toBeCloseTo(1045.0, 2);
    expect(fibras[1].lengthM).toBeCloseTo(1540.0, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Corte (tesoura): sub-arestas e dependência de direção da sobra
// ─────────────────────────────────────────────────────────────────────────────
describe('walkTrace — fibra cortada (f2 do cabo2, corte em CEO13)', () => {
  it('de A até o corte: sobra de CEO13 NÃO conta (chegada excluída)', () => {
    const r = walkTrace(makeData(), { kind: 'FIBER_END', fiberId: 'f22', side: 'A' }, 1490);
    expect(r.path.map((e) => e.kind)).toEqual(['FIBER', 'END']);
    expect(r.path[0].lengthM).toBeCloseTo(816.0, 2); // só s21
    expect(r.path[0].elementName).toBe('CPN-013');
  });

  it('do corte (lado U) até A: sobra de CEO13 conta (sai da caixa)', () => {
    const r = walkTrace(makeData(), { kind: 'CUT_END', cutId: 'cut-22', side: 'U' }, 1490);
    expect(r.path.map((e) => e.kind)).toEqual(['FIBER', 'END']);
    expect(r.path[0].lengthM).toBeCloseTo(841.0, 2); // 25 + 816
  });

  it('do corte (lado D) até B: sobra de CEO13 conta', () => {
    const r = walkTrace(makeData(), { kind: 'CUT_END', cutId: 'cut-22', side: 'D' }, 1490);
    expect(r.path[0].lengthM).toBeCloseTo(229.0, 2); // 25 + 204
  });

  it('de B até o corte: sobra de CEO13 NÃO conta', () => {
    const r = walkTrace(makeData(), { kind: 'FIBER_END', fiberId: 'f22', side: 'B' }, 1490);
    expect(r.path[0].lengthM).toBeCloseTo(204.0, 2); // só s22
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Atenuação por λ e splitter desbalanceado (§5.3)
// ─────────────────────────────────────────────────────────────────────────────
describe('atenuação (spec §5.3)', () => {
  it('λ=1550 usa 0,22 dB/km', () => {
    const r = walkTrace(makeData(), { kind: 'PORT', portId: 'p-olt-1' }, 1550);
    const fibra1 = r.path.find((e) => e.kind === 'FIBER')!;
    // 0,5 + 0,1 + 1,540 × 0,22 (=0,3388) = 0,9388
    expect(fibra1.cumLossDb).toBeCloseTo(0.94, 2);
  });

  it('desbalanceado 10%: OUT 1 = tap 10,5 dB; OUT 2 = passante 0,8 dB', () => {
    const sp = makeSplitter({
      id: 'dev-sp2',
      name: 'SP-TAP 1x2',
      metadata: { ratio: '1x2', topology: 'UNBALANCED', tap_percent: 10 },
      ports: [
        port('p2-in', 'IN', 1, 'IN'),
        port('p2-out1', 'OUT', 1, 'OUT 1'),
        port('p2-out2', 'OUT', 2, 'OUT 2'),
      ],
    });
    const attn = { ...FIBERMAP_ATTENUATION_DEFAULTS };
    expect(splitterBranchLossDb(sp, 1, attn)).toBeCloseTo(10.5, 2);
    expect(splitterBranchLossDb(sp, 2, attn)).toBeCloseTo(0.8, 2);

    const data: TraceGraphData = {
      ...makeData({ semOlt: true }),
      devices: [sp],
      connections: [],
    };
    const r = walkTrace(data, { kind: 'PORT', portId: 'p2-in' }, 1490);
    const splitter = r.path.find((e) => e.kind === 'SPLITTER')!;
    expect(splitter.lossDb).toBeUndefined(); // perdas divergem por ramo
    const [tap, pass] = splitter.branches!;
    expect(tap.events[0].lossDb).toBeCloseTo(10.5, 2);
    expect(pass.events[0].lossDb).toBeCloseTo(0.8, 2);
  });

  it('balanceado 50/50 (1x2): 3,7 dB nos dois ramos', () => {
    const sp = makeSplitter({
      id: 'dev-sp3',
      name: 'SP 1x2',
      metadata: { ratio: '1x2', topology: 'BALANCED' },
      ports: [
        port('p3-in', 'IN', 1, 'IN'),
        port('p3-out1', 'OUT', 1, 'OUT 1'),
        port('p3-out2', 'OUT', 2, 'OUT 2'),
      ],
    });
    const attn = { ...FIBERMAP_ATTENUATION_DEFAULTS };
    expect(splitterBranchLossDb(sp, 1, attn)).toBeCloseTo(3.7, 2);
    expect(splitterBranchLossDb(sp, 2, attn)).toBeCloseTo(3.7, 2);
  });
});

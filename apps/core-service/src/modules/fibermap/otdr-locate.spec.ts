/**
 * FiberMap — testes do localizador OTDR (FM-5, casos obrigatórios spec §13).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Planta sintética (a da FM-4 + splitter 1x2 com drops — p/ ambiguidade):
 *
 *   POP ──s11── CEO11* ──s12── CEO12 ──s21── CEO13* ──s22── CTO01
 *     cabo1 BB-CPM-R1: s11 ótico 510 (geo 500) · s12 ótico 1000 (MEDIDO;
 *       geo 985) · sobra* 30 m em CEO11
 *     cabo2 DIST-GUA-R2: s21 816 (geo 800) · s22 204 (geo 200) · sobra* 25 m
 *       em CEO13 · f2 CORTADA em CEO13 · f3 expressa
 *   POP: OLT PON1 →conector→ DIO p1 →fusão→ cabo1 f1 (A)
 *   CEO12: cabo1 f1 B →fusão→ cabo2 f1 A
 *   CTO01: cabo2 f1 B →fusão→ SP 1x2 IN; OUT1 →fusão→ dropA f1; OUT2 →fusão→ dropB f1
 *   dropA: sd1 CTO01→CLI1 100 m (geo 100) · dropB: sd2 CTO01→CLI2 120 m (geo 120)
 *
 * ── Marcos OTDR a partir do POP (cabo1 f1, direção CEO11) ──
 *   510    chegada CEO11 (antes da sobra)
 *   540    saída CEO11 (sobra 30 consumida ao sair — §5.2/§5.5.3)
 *   1540   CEO12 (fusão cabo1↔cabo2)
 *   2356   CEO13 (chegada; sobra 25 só ao sair)
 *   2585   CTO01 (fusão + splitter)
 *   2685   CLI1 (fim dropA) · 2705 CLI2 (fim dropB)
 */
import { FIBERMAP_ATTENUATION_DEFAULTS } from '@netx/shared';

import { locateOtdrEvent } from './otdr-locate';
import type { TraceDeviceData, TraceGraphData } from './trace-graph';

const EL = {
  pop: 'el-pop',
  ceo11: 'el-ceo11',
  ceo12: 'el-ceo12',
  ceo13: 'el-ceo13',
  cto01: 'el-cto01',
  cli1: 'el-cli1',
  cli2: 'el-cli2',
} as const;

const seg = (
  id: string,
  seq: number,
  from: string,
  to: string,
  opticalLengthM: number,
  geometricLengthM: number,
  measuredLengthM: number | null = null,
) => ({
  id,
  seq,
  fromElementId: from,
  toElementId: to,
  opticalLengthM,
  geometricLengthM,
  measuredLengthM,
  path: [[0, 0], [1, 1]] as number[][],
});

const port = (id: string, role: 'IN' | 'OUT' | 'BIDI', n: number, label: string) => ({
  id,
  role,
  portNumber: n,
  label,
});

function makeOtdrData(): TraceGraphData {
  const devices: TraceDeviceData[] = [
    {
      id: 'dev-olt',
      elementId: EL.pop,
      type: 'OLT',
      name: 'OLT-CPM-01',
      metadata: { pon_ports: 2 },
      ports: [port('p-olt-1', 'BIDI', 1, 'PON 0/1/1')],
    },
    {
      id: 'dev-dio',
      elementId: EL.pop,
      type: 'DIO',
      name: 'DIO-01',
      metadata: { ports: 2 },
      ports: [port('p-dio-1', 'BIDI', 1, 'Porta 01')],
    },
    {
      id: 'dev-sp',
      elementId: EL.cto01,
      type: 'SPLITTER',
      name: 'SP-CPM 1x2',
      metadata: { ratio: '1x2', topology: 'BALANCED' },
      ports: [
        port('p-sp-in', 'IN', 1, 'IN'),
        port('p-sp-out1', 'OUT', 1, 'OUT 1'),
        port('p-sp-out2', 'OUT', 2, 'OUT 2'),
      ],
    },
  ];
  return {
    cables: [
      {
        id: 'cab-1',
        name: 'BB-CPM-R1',
        segments: [
          seg('s11', 1, EL.pop, EL.ceo11, 510.0, 500),
          seg('s12', 2, EL.ceo11, EL.ceo12, 1000.0, 985, 1000),
        ],
        slacks: [{ elementId: EL.ceo11, lengthM: 30 }],
      },
      {
        id: 'cab-2',
        name: 'DIST-GUA-R2',
        segments: [
          seg('s21', 1, EL.ceo12, EL.ceo13, 816.0, 800),
          seg('s22', 2, EL.ceo13, EL.cto01, 204.0, 200),
        ],
        slacks: [{ elementId: EL.ceo13, lengthM: 25 }],
      },
      {
        id: 'cab-da',
        name: 'DROP-A',
        segments: [seg('sd1', 1, EL.cto01, EL.cli1, 100.0, 100)],
        slacks: [],
      },
      {
        id: 'cab-db',
        name: 'DROP-B',
        segments: [seg('sd2', 1, EL.cto01, EL.cli2, 120.0, 120)],
        slacks: [],
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
      { id: 'f23', cableId: 'cab-2', fiberNumber: 3, tubeNumber: 1, color: 'BRANCA', cuts: [] },
      { id: 'fa1', cableId: 'cab-da', fiberNumber: 1, tubeNumber: 1, color: 'VERDE', cuts: [] },
      { id: 'fb1', cableId: 'cab-db', fiberNumber: 1, tubeNumber: 1, color: 'VERDE', cuts: [] },
    ],
    devices,
    connections: [
      {
        id: 'c1',
        elementId: EL.pop,
        kind: 'CONNECTOR',
        lossDb: null,
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
      {
        id: 'c5',
        elementId: EL.cto01,
        kind: 'FUSION',
        lossDb: null,
        a: { type: 'PORT', portId: 'p-sp-out1' },
        b: { type: 'FIBER_END', fiberId: 'fa1', side: 'A' },
      },
      {
        id: 'c6',
        elementId: EL.cto01,
        kind: 'FUSION',
        lossDb: null,
        a: { type: 'PORT', portId: 'p-sp-out2' },
        b: { type: 'FIBER_END', fiberId: 'fb1', side: 'A' },
      },
    ],
    elements: {
      [EL.pop]: { name: 'POP-CPM', latitude: -24.046, longitude: -52.378 },
      [EL.ceo11]: { name: 'CPN-011', latitude: -24.049, longitude: -52.3745 },
      [EL.ceo12]: { name: 'CPN-012', latitude: -24.0525, longitude: -52.371 },
      [EL.ceo13]: { name: 'CPN-013', latitude: -24.056, longitude: -52.3672 },
      [EL.cto01]: { name: 'CTO-CPM-01', latitude: -24.0585, longitude: -52.365 },
      [EL.cli1]: { name: 'CLI-001', latitude: -24.059, longitude: -52.364 },
      [EL.cli2]: { name: 'CLI-002', latitude: -24.0595, longitude: -52.3635 },
    },
    attenuation: { ...FIBERMAP_ATTENUATION_DEFAULTS },
  };
}

const fromPop = (distanceM: number) => ({
  cableId: 'cab-1',
  fiberNumber: 1,
  referenceElementId: EL.pop,
  directionElementId: EL.ceo11,
  distanceM,
});

describe('locateOtdrEvent — casos obrigatórios (spec §13 FM-5)', () => {
  it('evento no meio de segmento: fração geográfica pelo excesso efetivo', () => {
    const r = locateOtdrEvent(makeOtdrData(), fromPop(300));
    expect(r.flags).toEqual([]);
    expect(r.candidates).toHaveLength(1);
    const c = r.candidates[0];
    expect(c.kind).toBe('ON_SEGMENT');
    expect(c.segment!.id).toBe('s11');
    expect(c.offsetOpticalM).toBeCloseTo(300, 2);
    // 300 ÷ (510/500) = 294,1176 m geográficos ÷ 500 = 0,588235
    expect(c.geoFractionStored).toBeCloseTo(0.58824, 4);
    expect(c.reversed).toBe(false);
    expect(c.walkFromElementId).toBe(EL.pop);
    expect(c.walkToElementId).toBe(EL.ceo11);
    // Incerteza: sem sobras, 300 m geométricos × 0,01 = 3 → mínimo 10.
    expect(c.uncertaintyRadiusM).toBe(10);
    // expected_events do caminho INTEIRO (correlaciona a curva — §5.5.7).
    const fusao12 = r.expectedEvents.find(
      (e) => e.type === 'FUSION' && e.elementId === EL.ceo12,
    );
    expect(fusao12?.expectedOtdrM).toBeCloseTo(1540, 2);
    const splitter = r.expectedEvents.find((e) => e.type === 'SPLITTER');
    expect(splitter?.expectedOtdrM).toBeCloseTo(2585, 2);
    const fimA = r.expectedEvents.find(
      (e) => e.type === 'END' && e.elementId === EL.cli1,
    );
    expect(fimA?.expectedOtdrM).toBeCloseTo(2685, 2);
  });

  it('evento dentro de sobra: candidato NA caixa com flag IN_SLACK', () => {
    // 510 (chegada CEO11) < 520 ≤ 540 (após a sobra de 30 m)
    const r = locateOtdrEvent(makeOtdrData(), fromPop(520));
    expect(r.flags).toEqual(['IN_SLACK']);
    const c = r.candidates[0];
    expect(c.kind).toBe('IN_SLACK');
    expect(c.elementId).toBe(EL.ceo11);
    expect(c.slackTraversedM).toBeCloseTo(10, 2); // 10 m pra dentro da sobra
    // max(10, 10×0,5 + 510×0,01) = max(10, 10,1) = 10,1
    expect(c.uncertaintyRadiusM).toBeCloseTo(10.1, 2);
  });

  it('após fusão entre cabos diferentes: continua no outro cabo', () => {
    // 2000 − 1540 (CEO12) = 460 dentro do s21 do DIST-GUA-R2
    const r = locateOtdrEvent(makeOtdrData(), fromPop(2000));
    const c = r.candidates[0];
    expect(c.kind).toBe('ON_SEGMENT');
    expect(c.cable!.name).toBe('DIST-GUA-R2');
    expect(c.segment!.id).toBe('s21');
    expect(c.offsetOpticalM).toBeCloseTo(460, 2);
    // 460 ÷ 1,02 = 450,98 ÷ 800 = 0,563725
    expect(c.geoFractionStored).toBeCloseTo(0.56373, 4);
    // sobras 30 · geométricos: 510 + 460 (s12 é MEDIDO, não conta) = 970
    // max(10, 30×0,5 + 970×0,01) = 24,7
    expect(c.slackTraversedM).toBeCloseTo(30, 2);
    expect(c.geometricBasedM).toBeCloseTo(970, 2);
    expect(c.uncertaintyRadiusM).toBeCloseTo(24.7, 2);
  });

  it('após splitter: um candidato por ramo + AMBIGUOUS_AFTER_SPLITTER', () => {
    // 2650 − 2585 (splitter) = 65 m em cada drop
    const r = locateOtdrEvent(makeOtdrData(), fromPop(2650));
    expect(r.flags).toContain('AMBIGUOUS_AFTER_SPLITTER');
    expect(r.candidates).toHaveLength(2);
    const [a, b] = r.candidates;
    expect(a.branchLabel).toBe('OUT 1');
    expect(a.cable!.name).toBe('DROP-A');
    expect(a.offsetOpticalM).toBeCloseTo(65, 2);
    expect(a.geoFractionStored).toBeCloseTo(0.65, 4); // 65/100 (excesso 1,0)
    expect(b.branchLabel).toBe('OUT 2');
    expect(b.cable!.name).toBe('DROP-B');
    expect(b.geoFractionStored).toBeCloseTo(65 / 120, 4);
  });

  it('além do fim documentado: BEYOND_END na(s) ponta(s)', () => {
    const r = locateOtdrEvent(makeOtdrData(), fromPop(3000));
    expect(r.flags).toContain('BEYOND_END');
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates.map((c) => c.kind)).toEqual(['BEYOND_END', 'BEYOND_END']);
    expect(r.candidates.map((c) => c.elementId).sort()).toEqual([EL.cli1, EL.cli2]);
  });

  it('segmento com measured divergente do geométrico usa o excesso efetivo', () => {
    // 1000 − 540 (saída CEO11) = 460 no s12 (MEDIDO 1000, geo 985)
    const r = locateOtdrEvent(makeOtdrData(), fromPop(1000));
    const c = r.candidates[0];
    expect(c.segment!.id).toBe('s12');
    expect(c.offsetOpticalM).toBeCloseTo(460, 2);
    // eff = 1000/985 → geo = 460×0,985 = 453,1 ÷ 985 = 0,46
    expect(c.geoFractionStored).toBeCloseTo(0.46, 4);
    // s12 tem MEDIDO ⇒ não entra no termo geométrico: só s11 (510)
    expect(c.geometricBasedM).toBeCloseTo(510, 2);
    // max(10, 30×0,5 + 510×0,01) = 20,1
    expect(c.uncertaintyRadiusM).toBeCloseTo(20.1, 2);
  });
});

describe('locateOtdrEvent — direção, corte e medição pra trás', () => {
  it('direção reversa: fração convertida pra orientação armazenada', () => {
    // CEO12 → CEO11 no cabo1: 600 m caem no s12 percorrido de to→from
    const r = locateOtdrEvent(makeOtdrData(), {
      cableId: 'cab-1',
      fiberNumber: 1,
      referenceElementId: EL.ceo12,
      directionElementId: EL.ceo11,
      distanceM: 600,
    });
    const c = r.candidates[0];
    expect(c.segment!.id).toBe('s12');
    expect(c.reversed).toBe(true);
    // 600 ÷ (1000/985) = 591 ÷ 985 = 0,6 no sentido da caminhada ⇒ 0,4 na
    // geometria armazenada (ST_LineInterpolatePoint direto, sem ST_Reverse).
    expect(c.geoFractionStored).toBeCloseTo(0.4, 4);
    expect(c.walkFromElementId).toBe(EL.ceo12);
    expect(c.walkToElementId).toBe(EL.ceo11);
  });

  it('marco zero em elemento interior (fibra expressa): sobra sai primeiro', () => {
    // f3 do cabo2 a partir de CEO13 → CTO01, 100 m: 25 de sobra + 75 no s22
    const r = locateOtdrEvent(makeOtdrData(), {
      cableId: 'cab-2',
      fiberNumber: 3,
      referenceElementId: EL.ceo13,
      directionElementId: EL.cto01,
      distanceM: 100,
    });
    const c = r.candidates[0];
    expect(c.segment!.id).toBe('s22');
    expect(c.offsetOpticalM).toBeCloseTo(75, 2);
    // 75 ÷ 1,02 = 73,53 ÷ 200 = 0,3676
    expect(c.geoFractionStored).toBeCloseTo(0.36765, 4);
    expect(c.slackTraversedM).toBeCloseTo(25, 2);
    // max(10, 25×0,5 + 75×0,01) = 13,25
    expect(c.uncertaintyRadiusM).toBeCloseTo(13.25, 2);
  });

  it('fibra cortada: a luz termina no corte (BEYOND_END na caixa do corte)', () => {
    // f2 do cabo2 de CEO12 → CEO13: corte em CEO13 a 816 m; 900 > 816
    const r = locateOtdrEvent(makeOtdrData(), {
      cableId: 'cab-2',
      fiberNumber: 2,
      referenceElementId: EL.ceo12,
      directionElementId: EL.ceo13,
      distanceM: 900,
    });
    expect(r.flags).toContain('BEYOND_END');
    expect(r.candidates[0].kind).toBe('BEYOND_END');
    expect(r.candidates[0].elementId).toBe(EL.ceo13);
    const fim = r.expectedEvents.find((e) => e.type === 'END');
    expect(fim?.expectedOtdrM).toBeCloseTo(816, 2);
  });

  it('direção fora do cabo: mede pra trás através da conexão da ponta', () => {
    // cabo2 f1 a partir de CEO12 (ponta A) apontando pro POP (não está na
    // rota do cabo2): atravessa a fusão, percorre o cabo1 invertido e morre
    // na OLT — 1600 > 1540 ⇒ BEYOND_END no POP.
    const r = locateOtdrEvent(makeOtdrData(), {
      cableId: 'cab-2',
      fiberNumber: 1,
      referenceElementId: EL.ceo12,
      directionElementId: EL.pop,
      distanceM: 1600,
    });
    expect(r.flags).toContain('BEYOND_END');
    expect(r.candidates[0].elementId).toBe(EL.pop);
    const marcos = r.expectedEvents.map((e) => `${e.type}@${e.expectedOtdrM}`);
    expect(marcos).toContain('FUSION@0'); // fusão cabo2↔cabo1 na própria CEO12
    expect(marcos).toContain('FUSION@1540'); // pigtail do DIO no POP
    expect(marcos).toContain('CONNECTOR@1540'); // patch DIO↔OLT
    expect(marcos).toContain('END@1540'); // luz morre na porta da OLT
  });
});

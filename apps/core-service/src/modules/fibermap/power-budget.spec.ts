/**
 * FiberMap — testes do power budget e da calibração (FM-6, spec §5.4/§5.5.8).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Mesma planta sintética da FM-4 (ver cabeçalho do trace-graph.spec.ts):
 * perda total OLT→OUT do splitter @1490 nm =
 *   0,50 (conector) + 0,10 (fusão DIO) + 0,4312 (1540 m) + 0,05 (CEO12)
 *   + 0,2926 (1045 m) + 0,08 (CTO01) + 10,5 (1x8) = 11,9538 dB
 * ⇒ tx +4 dBm → Rx esperado nas 8 pontas = −7,9538 → −7,95 dBm (OK).
 * Esses são exatamente os valores da planilha docs/fixtures/
 * power-budget-reference.xlsx (aceite da fase, com os comprimentos REAIS
 * da fixture do banco — 1064,38/946,48 m — em vez dos sintéticos daqui).
 */
import { FIBERMAP_ATTENUATION_DEFAULTS } from '@netx/shared';

import { fitExcessFactor } from './otdr-locate';
import { buildPowerBudget } from './power-budget';
import { walkTrace, type TraceDeviceData, type TraceGraphData } from './trace-graph';

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

function makeData(): TraceGraphData {
  const devices: TraceDeviceData[] = [
    {
      id: 'dev-olt',
      elementId: EL.pop,
      type: 'OLT',
      name: 'OLT-CPM-01',
      metadata: { pon_ports: 1 },
      ports: [port('p-olt-1', 'BIDI', 1, 'PON 0/1/1')],
    },
    {
      id: 'dev-dio',
      elementId: EL.pop,
      type: 'DIO',
      name: 'DIO-01',
      metadata: { ports: 1 },
      ports: [port('p-dio-1', 'BIDI', 1, 'Porta 01')],
    },
    {
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
    ],
    fibers: [
      { id: 'f11', cableId: 'cab-1', fiberNumber: 1, tubeNumber: 1, color: 'VERDE', cuts: [] },
      { id: 'f21', cableId: 'cab-2', fiberNumber: 1, tubeNumber: 1, color: 'VERDE', cuts: [] },
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

const tracePath = () =>
  walkTrace(makeData(), { kind: 'PORT', portId: 'p-olt-1' }, 1490).path;

describe('buildPowerBudget (spec §5.4)', () => {
  it('tx +4 dBm: Rx −7,95 nas 8 pontas do splitter, tudo OK', () => {
    const r = buildPowerBudget(tracePath(), { txDbm: 4, warnDbm: -25, critDbm: -27 });

    // Na porta de origem: Rx = tx (perda 0).
    expect(r.path[0].kind).toBe('PORT');
    expect(r.path[0].expectedDbm).toBeCloseTo(4, 2);
    expect(r.path[0].level).toBe('OK');

    expect(r.terminals).toHaveLength(8);
    for (const t of r.terminals) {
      expect(t.deviceName).toBe('SP-CPM 1x8');
      expect(t.distanceM).toBeCloseTo(2585, 2);
      expect(t.lossDb).toBeCloseTo(11.95, 2); // 11,9538
      expect(t.expectedDbm).toBeCloseTo(-7.95, 2); // 4 − 11,9538
      expect(t.level).toBe('OK');
      expect(t.endReason).toBe('FREE_END');
    }
    expect(r.terminals.map((t) => t.branchPath)).toEqual(
      Array.from({ length: 8 }, (_, i) => `OUT ${i + 1}`),
    );
    expect(r.worstDbm).toBeCloseTo(-7.95, 2);

    // A árvore enriquecida preserva os ramos com dBm por evento.
    const splitter = r.path.find((e) => e.kind === 'SPLITTER')!;
    expect(splitter.branches).toHaveLength(8);
    expect(splitter.branches![0].events[0].expectedDbm).toBeCloseTo(-7.95, 2);
  });

  it('níveis: WARN quando Rx < warn, CRIT quando Rx < crit (spec §5.4)', () => {
    // Rx nas pontas = −7,95: limiares artificiais pra exercitar os níveis.
    const warn = buildPowerBudget(tracePath(), { txDbm: 4, warnDbm: -7, critDbm: -8 });
    expect(warn.terminals[0].level).toBe('WARN');

    const crit = buildPowerBudget(tracePath(), { txDbm: 4, warnDbm: -7, critDbm: -7.9 });
    expect(crit.terminals[0].level).toBe('CRIT');

    // Igual ao limiar NÃO dispara (spec: estritamente menor).
    const edge = buildPowerBudget(tracePath(), { txDbm: 4, warnDbm: -7.95, critDbm: -10 });
    expect(edge.terminals[0].level).toBe('OK');
  });
});

describe('fitExcessFactor (spec §5.5.8)', () => {
  it('curva proporcional: k = medido/teórico, excesso escala junto', () => {
    const fit = fitExcessFactor(1.02, [
      { expectedM: 1000, measuredM: 980 },
      { expectedM: 2000, measuredM: 1960 },
    ]);
    expect(fit.k).toBeCloseTo(0.98, 4);
    expect(fit.newExcessFactor).toBeCloseTo(0.9996, 4);
    expect(fit.clamped).toBe(false);
  });

  it('clamp em 1,2: k plausível mas excesso resultante estourando o teto', () => {
    const fit = fitExcessFactor(1.02, [
      { expectedM: 1000, measuredM: 1190 },
      { expectedM: 2000, measuredM: 2380 },
    ]);
    expect(fit.k).toBeCloseTo(1.19, 4);
    expect(fit.newExcessFactor).toBeCloseTo(1.2, 4);
    expect(fit.clamped).toBe(true);
  });

  it('k fora de 0,8–1,25 = marco zero deslocado ⇒ erro amigável', () => {
    expect(() =>
      fitExcessFactor(1.02, [
        { expectedM: 1000, measuredM: 1300 },
        { expectedM: 2000, measuredM: 2600 },
      ]),
    ).toThrow(/marco zero/);
  });

  it('exige pelo menos 2 pares', () => {
    expect(() => fitExcessFactor(1.02, [{ expectedM: 1000, measuredM: 990 }])).toThrow();
  });
});

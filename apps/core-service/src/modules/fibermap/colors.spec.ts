/**
 * FiberMap — testes da lógica de cores (FIBERMAP-SPEC.md §2, aceite FM-0).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 */
import {
  ABNT_COLOR_CYCLE,
  EIA598_COLOR_CYCLE,
  buildCableFiberLayout,
  buildTubeColors,
  fiberColorAt,
  isValidCableStructure,
} from '@netx/shared';

describe('fibermap colors (spec §2)', () => {
  it('ciclo ABNT NBR 14700 na ordem exata', () => {
    expect(ABNT_COLOR_CYCLE).toEqual([
      'VERDE', 'AMARELA', 'BRANCA', 'AZUL', 'VERMELHA', 'VIOLETA',
      'MARROM', 'ROSA', 'PRETA', 'CINZA', 'LARANJA', 'AGUA_MARINHA',
    ]);
  });

  it('ciclo EIA/TIA-598 na ordem exata', () => {
    expect(EIA598_COLOR_CYCLE).toEqual([
      'AZUL', 'LARANJA', 'VERDE', 'MARROM', 'CINZA', 'BRANCA',
      'VERMELHA', 'PRETA', 'AMARELA', 'VIOLETA', 'ROSA', 'AGUA_MARINHA',
    ]);
  });

  it('cor da fibra cicla após 12 (fibra 13 = cor 1)', () => {
    expect(fiberColorAt('ABNT', 13)).toBe('VERDE');
    expect(fiberColorAt('EIA598', 13)).toBe('AZUL');
    expect(fiberColorAt('ABNT', 12)).toBe('AGUA_MARINHA');
  });
});

describe('buildTubeColors (spec §2 esquemas de tubo)', () => {
  it('STANDARD_CYCLE segue o ciclo do padrão', () => {
    expect(buildTubeColors({ scheme: 'STANDARD_CYCLE', standard: 'ABNT', tubeCount: 4 }))
      .toEqual(['VERDE', 'AMARELA', 'BRANCA', 'AZUL']);
    expect(buildTubeColors({ scheme: 'STANDARD_CYCLE', standard: 'EIA598', tubeCount: 3 }))
      .toEqual(['AZUL', 'LARANJA', 'VERDE']);
  });

  it('PILOT_DIRECTIONAL: verde, amarela, demais brancas — nos DOIS padrões', () => {
    const expected6 = ['VERDE', 'AMARELA', 'BRANCA', 'BRANCA', 'BRANCA', 'BRANCA'];
    expect(buildTubeColors({ scheme: 'PILOT_DIRECTIONAL', standard: 'ABNT', tubeCount: 6 }))
      .toEqual(expected6);
    expect(buildTubeColors({ scheme: 'PILOT_DIRECTIONAL', standard: 'EIA598', tubeCount: 6 }))
      .toEqual(expected6);
  });

  it('CUSTOM valida cardinalidade e cores conhecidas', () => {
    expect(
      buildTubeColors({
        scheme: 'CUSTOM',
        standard: 'ABNT',
        tubeCount: 2,
        customColors: ['ROSA', 'PRETA'],
      }),
    ).toEqual(['ROSA', 'PRETA']);
    expect(() =>
      buildTubeColors({ scheme: 'CUSTOM', standard: 'ABNT', tubeCount: 3, customColors: ['ROSA'] }),
    ).toThrow(/exatamente 3/);
    expect(() =>
      buildTubeColors({
        scheme: 'CUSTOM',
        standard: 'ABNT',
        tubeCount: 1,
        customColors: ['MAGENTA' as never],
      }),
    ).toThrow(/desconhecida/);
  });
});

describe('buildCableFiberLayout (aceite FM-0)', () => {
  it('AS 36FO (ABNT): 6 tubos × 6 fibras Verde…Violeta, numeração global', () => {
    const layout = buildCableFiberLayout(
      { fiberCount: 36, tubeCount: 6, fibersPerTube: 6 },
      'ABNT',
    );
    expect(layout).toHaveLength(36);
    // Tubo 1: fibras 1..6 truncadas no ciclo ABNT (Verde…Violeta)
    expect(layout.slice(0, 6).map((f) => f.color)).toEqual([
      'VERDE', 'AMARELA', 'BRANCA', 'AZUL', 'VERMELHA', 'VIOLETA',
    ]);
    // Numeração global: tubo 2 começa na fibra 7; cor reinicia no ciclo
    expect(layout[6]).toMatchObject({
      tubeNumber: 2,
      fiberNumber: 7,
      fiberInTube: 1,
      color: 'VERDE',
    });
    expect(layout[35]).toMatchObject({ tubeNumber: 6, fiberNumber: 36, color: 'VIOLETA' });
  });

  it('AS 48FO (EIA/TIA): 4 tubos × 12 fibras Azul…Água-marinha', () => {
    const layout = buildCableFiberLayout(
      { fiberCount: 48, tubeCount: 4, fibersPerTube: 12 },
      'EIA598',
    );
    expect(layout).toHaveLength(48);
    for (let tube = 1; tube <= 4; tube++) {
      const colors = layout.filter((f) => f.tubeNumber === tube).map((f) => f.color);
      expect(colors).toEqual([...EIA598_COLOR_CYCLE]);
    }
  });

  it('DROP 1FO: fibra única com a cor 1 do padrão', () => {
    expect(buildCableFiberLayout({ fiberCount: 1, tubeCount: 1, fibersPerTube: 1 }, 'ABNT'))
      .toEqual([{ tubeNumber: 1, fiberNumber: 1, fiberInTube: 1, color: 'VERDE' }]);
    expect(
      buildCableFiberLayout({ fiberCount: 1, tubeCount: 1, fibersPerTube: 1 }, 'EIA598')[0].color,
    ).toBe('AZUL');
  });

  it('rejeita estrutura inconsistente (fibras ≠ tubos × fibras/tubo)', () => {
    expect(isValidCableStructure({ fiberCount: 36, tubeCount: 6, fibersPerTube: 6 })).toBe(true);
    expect(isValidCableStructure({ fiberCount: 36, tubeCount: 4, fibersPerTube: 6 })).toBe(false);
    expect(() =>
      buildCableFiberLayout({ fiberCount: 36, tubeCount: 4, fibersPerTube: 6 }, 'ABNT'),
    ).toThrow(/estrutura inválida/);
  });
});

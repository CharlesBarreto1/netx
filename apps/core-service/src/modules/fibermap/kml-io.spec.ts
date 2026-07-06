/**
 * FiberMap — testes do parse/build KML (FM-7, spec §12).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * O aceite da fase (export→import reproduz a geometria ≤ 1 m) é validado em
 * duas camadas: aqui o round-trip PURO build→parse com igualdade exata de
 * coordenadas; no box, o smoke exporta a fixture real e reimporta em pasta
 * nova comparando via PostGIS.
 */
import {
  buildFibermapKml,
  inferFibermapElementType,
  kmlColor,
  kmlPathLengthMeters,
  parseFibermapKml,
} from './kml-io';

describe('inferFibermapElementType (spec §12 — tabela default)', () => {
  it('infere pelo nome: CTO/CEO/POP, senão POLE', () => {
    expect(inferFibermapElementType('CTO-CPM-01')).toBe('CTO');
    expect(inferFibermapElementType('cto guarujá 12')).toBe('CTO');
    expect(inferFibermapElementType('CPN-011')).toBe('POLE'); // CEO sem "CEO" no nome
    expect(inferFibermapElementType('CEO-R2-04')).toBe('CEO');
    expect(inferFibermapElementType('POP Central')).toBe('POP');
    expect(inferFibermapElementType('POSTE-118')).toBe('POLE');
  });

  it('netx-type do ExtendedData tem precedência (round-trip fiel)', () => {
    expect(inferFibermapElementType('CPN-011', 'CEO')).toBe('CEO');
    expect(inferFibermapElementType('CTO-01', 'POLE')).toBe('POLE');
    // Tipo fora do vocabulário de import cai na inferência por nome.
    expect(inferFibermapElementType('ARM-01', 'CABINET')).toBe('POLE');
  });
});

describe('kmlColor', () => {
  it('#rrggbb → aabbggrr opaco; inválido usa fallback', () => {
    expect(kmlColor('#ff8800')).toBe('ff0088ff');
    expect(kmlColor(null)).toBe(kmlColor('#f97316'));
    expect(kmlColor('laranja')).toBe(kmlColor('#f97316'));
  });
});

describe('round-trip build → parse (aceite FM-7)', () => {
  const folders = [
    {
      name: 'FiberMap — Fixture',
      elements: [
        {
          name: 'POP-CPM',
          type: 'POP',
          latitude: -24.046,
          longitude: -52.378,
          description: 'central',
        },
        { name: 'CPN-011', type: 'CEO', latitude: -24.049, longitude: -52.3745 },
        { name: 'CTO-CPM-01', type: 'CTO', latitude: -24.0585, longitude: -52.365 },
      ],
      cables: [
        {
          name: 'BB-CPM-R1',
          displayColor: '#ec4899',
          segments: [
            {
              seq: 1,
              path: [
                [-52.378, -24.046],
                [-52.3764, -24.0472],
                [-52.3745, -24.049],
              ],
            },
            {
              seq: 2,
              path: [
                [-52.3745, -24.049],
                [-52.371, -24.0525],
              ],
            },
          ],
        },
      ],
    },
  ];

  it('coordenadas e tipos sobrevivem intactos', () => {
    const xml = buildFibermapKml(folders, 'NetX — FiberMap');
    expect(xml).toContain('http://www.opengis.net/kml/2.2');

    const parsed = parseFibermapKml(xml);
    expect(parsed.warnings).toEqual([]);

    // Elementos: nome, coordenada EXATA e netx-type preservados.
    expect(parsed.points).toHaveLength(3);
    const pop = parsed.points.find((p) => p.name === 'POP-CPM')!;
    expect(pop.latitude).toBe(-24.046);
    expect(pop.longitude).toBe(-52.378);
    expect(pop.typeHint).toBe('POP');
    expect(inferFibermapElementType(pop.name, pop.typeHint)).toBe('POP');
    const ceo = parsed.points.find((p) => p.name === 'CPN-011')!;
    // Sem o netx-type este nome viraria POLE — o hint garante o round-trip.
    expect(inferFibermapElementType(ceo.name, ceo.typeHint)).toBe('CEO');

    // Cabos: um LineString POR SEGMENTO, path exato (spec §12: import cria
    // um cabo por LineString — geometria ≤ 1 m garantida por igualdade).
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0].name).toBe('BB-CPM-R1 #1');
    expect(parsed.lines[0].path).toEqual([
      { latitude: -24.046, longitude: -52.378 },
      { latitude: -24.0472, longitude: -52.3764 },
      { latitude: -24.049, longitude: -52.3745 },
    ]);
    expect(parsed.lines[1].name).toBe('BB-CPM-R1 #2');
    expect(parsed.lines[1].path).toHaveLength(2);
  });

  it('estilos: cor da polyline no formato KML e styleUrl por tipo', () => {
    const xml = buildFibermapKml(folders, 'NetX — FiberMap');
    expect(xml).toContain('ff9948ec'); // #ec4899 → aabbggrr
    expect(xml).toContain('#netx-pop');
    expect(xml).toContain('#netx-cto');
  });
});

describe('parse — tolerância a KML de terceiros (Tomodat/Google Earth)', () => {
  it('Placemarks em Folders aninhados, MultiGeometry e sem nome', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <kml xmlns="http://www.opengis.net/kml/2.2"><Document>
        <Folder><name>Região 1</name>
          <Folder><name>CTOs</name>
            <Placemark><name>CTO GUA 07</name>
              <Point><coordinates>-52.36,-24.05,0</coordinates></Point>
            </Placemark>
            <Placemark>
              <Point><coordinates>-52.37,-24.06</coordinates></Point>
            </Placemark>
          </Folder>
          <Placemark><name>Tronco</name>
            <MultiGeometry>
              <LineString><coordinates>-52.36,-24.05 -52.37,-24.06</coordinates></LineString>
              <LineString><coordinates>-52.37,-24.06 -52.38,-24.07</coordinates></LineString>
            </MultiGeometry>
          </Placemark>
          <Placemark><name>Degenerado</name>
            <LineString><coordinates>-52.36,-24.05</coordinates></LineString>
          </Placemark>
        </Folder>
      </Document></kml>`;
    const parsed = parseFibermapKml(xml);

    expect(parsed.points).toHaveLength(2);
    expect(parsed.points[0].name).toBe('CTO GUA 07');
    expect(parsed.points[0].typeHint).toBeNull();
    expect(parsed.points[1].name).toBe('KML-2'); // gerado + warning

    expect(parsed.lines).toHaveLength(2); // MultiGeometry expandida
    expect(parsed.lines.map((l) => l.name)).toEqual(['Tronco #1', 'Tronco #2']);

    expect(parsed.warnings.some((w) => w.includes('sem <name>'))).toBe(true);
    expect(parsed.warnings.some((w) => w.includes('Degenerado'))).toBe(true);
  });

  it('arquivo sem geometria reconhecida gera aviso', () => {
    const parsed = parseFibermapKml(
      '<kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>',
    );
    expect(parsed.points).toHaveLength(0);
    expect(parsed.lines).toHaveLength(0);
    expect(parsed.warnings).toHaveLength(1);
  });
});

describe('kmlPathLengthMeters', () => {
  it('haversine plausível (1° de latitude ≈ 111,2 km)', () => {
    const len = kmlPathLengthMeters([
      { latitude: -24, longitude: -52 },
      { latitude: -25, longitude: -52 },
    ]);
    expect(len).toBeGreaterThan(110_000);
    expect(len).toBeLessThan(112_500);
  });
});

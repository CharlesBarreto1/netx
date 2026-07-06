/**
 * FiberMap — parse/build de KML 2.2 (FM-7, spec §12). Módulo PURO.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Parse (import, base Tomodat): coleta Placemarks em qualquer profundidade
 * (Folders aninhados), Point → elemento com tipo inferido pelo NOME
 * (contém CTO→CTO, CEO→CEO, POP→POP, senão POLE — tabela default da spec
 * §12) ou pelo `netx-type` em ExtendedData (round-trip fiel dos nossos
 * exports); LineString/MultiGeometry → cabo. Mesmas defesas do
 * optical/kml.service: processEntities:false (XXE), parseTagValue:false
 * (coordenada "0,0" não vira number).
 *
 * Build (export): Document com um Folder por pasta, Placemarks de elemento
 * (Point + styleUrl por tipo + netx-type) e um Placemark POR SEGMENTO
 * (LineString com estilo inline na cor do cabo) — o import cria um cabo por
 * LineString (spec §12), então a geometria faz round-trip ≤ 1 m.
 */
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import type { FibermapKmlImportType } from '@netx/shared';

const KML_NS = 'http://www.opengis.net/kml/2.2';

// =============================================================================
// Helpers geográficos
// =============================================================================
/** Haversine somado do caminho (m) — só pra exibição no preview. */
export function kmlPathLengthMeters(
  path: Array<{ latitude: number; longitude: number }>,
): number {
  const R = 6_371_000;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
    const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a.latitude * Math.PI) / 180) *
        Math.cos((b.latitude * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    total += 2 * R * Math.asin(Math.sqrt(s));
  }
  return Math.round(total * 100) / 100;
}

/** Distância haversine entre dois pontos (m) — snap do preview. */
export function kmlDistanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  return kmlPathLengthMeters([a, b]);
}

// =============================================================================
// Inferência de tipo (spec §12 — tabela default)
// =============================================================================
export function inferFibermapElementType(
  name: string,
  hint?: string | null,
): FibermapKmlImportType {
  if (hint) {
    const h = hint.trim().toUpperCase();
    if (h === 'POP' || h === 'CEO' || h === 'CTO' || h === 'POLE') return h;
    // Tipos fora do vocabulário de import (CABINET etc.) caem na inferência.
  }
  const n = name.toUpperCase();
  if (n.includes('CTO')) return 'CTO';
  if (n.includes('CEO')) return 'CEO';
  if (n.includes('POP')) return 'POP';
  return 'POLE';
}

// =============================================================================
// Parse
// =============================================================================
export interface ParsedKmlPoint {
  name: string;
  latitude: number;
  longitude: number;
  description: string | null;
  /** netx-type do ExtendedData, quando presente. */
  typeHint: string | null;
}

export interface ParsedKmlLine {
  name: string;
  path: Array<{ latitude: number; longitude: number }>;
  description: string | null;
}

export interface ParsedKml {
  points: ParsedKmlPoint[];
  lines: ParsedKmlLine[];
  warnings: string[];
}

export function parseFibermapKml(xml: string): ParsedKml {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    processEntities: false,
  });
  const parsed = parser.parse(xml);

  const placemarks: unknown[] = [];
  collectPlacemarks(parsed, placemarks);

  const out: ParsedKml = { points: [], lines: [], warnings: [] };

  for (const pm of placemarks) {
    const p = pm as Record<string, unknown>;
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    const description =
      typeof p.description === 'string' && p.description.trim() !== ''
        ? p.description.trim()
        : null;
    const typeHint = extendedDataValue(p, 'netx-type');

    // Point (direto ou dentro de MultiGeometry)
    for (const point of geometriesOf(p, 'Point')) {
      const coords = (point as Record<string, unknown>).coordinates;
      if (typeof coords !== 'string') continue;
      const coord = parseCoordinate(coords);
      if (!coord) continue;
      if (!name) {
        out.warnings.push(
          `Placemark sem <name> em ${coord.latitude.toFixed(4)},${coord.longitude.toFixed(4)} — usando nome gerado.`,
        );
      }
      out.points.push({
        name: name || `KML-${out.points.length + 1}`,
        latitude: coord.latitude,
        longitude: coord.longitude,
        description,
        typeHint,
      });
    }

    // LineString (direto ou dentro de MultiGeometry)
    const lines = geometriesOf(p, 'LineString');
    lines.forEach((line, i) => {
      const coords = (line as Record<string, unknown>).coordinates;
      if (typeof coords !== 'string') return;
      const path = parseCoordinateList(coords);
      const suffix = lines.length > 1 ? ` #${i + 1}` : '';
      if (path.length < 2) {
        out.warnings.push(
          `Cabo "${name || 's/nome'}${suffix}" ignorado: precisa de ≥ 2 pontos.`,
        );
        return;
      }
      if (!name) {
        out.warnings.push(
          `Cabo sem <name> com ${path.length} pontos — usando nome gerado.`,
        );
      }
      out.lines.push({
        name: (name || `CABO-KML-${out.lines.length + 1}`) + suffix,
        path,
        description,
      });
    });
  }

  if (out.points.length === 0 && out.lines.length === 0) {
    out.warnings.push(
      'Nenhuma geometria reconhecida. KML precisa de <Placemark> com <Point> ou <LineString>.',
    );
  }
  return out;
}

/** Geometrias do tipo pedido: diretas no Placemark ou em MultiGeometry. */
function geometriesOf(pm: Record<string, unknown>, tag: 'Point' | 'LineString'): unknown[] {
  const out: unknown[] = [];
  const push = (v: unknown): void => {
    if (Array.isArray(v)) out.push(...v);
    else if (v && typeof v === 'object') out.push(v);
  };
  push(pm[tag]);
  const multi = pm.MultiGeometry as Record<string, unknown> | undefined;
  if (multi && typeof multi === 'object') push(multi[tag]);
  return out;
}

function extendedDataValue(pm: Record<string, unknown>, key: string): string | null {
  const ext = pm.ExtendedData as Record<string, unknown> | undefined;
  if (!ext || typeof ext !== 'object') return null;
  const data = Array.isArray(ext.Data) ? ext.Data : ext.Data ? [ext.Data] : [];
  for (const d of data) {
    const rec = d as Record<string, unknown>;
    if (rec['@_name'] === key && typeof rec.value === 'string') {
      return rec.value.trim() || null;
    }
  }
  return null;
}

function collectPlacemarks(node: unknown, out: unknown[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectPlacemarks(item, out);
    return;
  }
  const obj = node as Record<string, unknown>;
  if ('Placemark' in obj) {
    const pm = obj.Placemark;
    if (Array.isArray(pm)) out.push(...pm);
    else if (pm) out.push(pm);
  }
  for (const key of Object.keys(obj)) {
    if (key === 'Placemark') continue;
    collectPlacemarks(obj[key], out);
  }
}

/** KML coordinates: "lng,lat[,alt]" — pega o primeiro token. */
function parseCoordinate(
  s: string,
): { latitude: number; longitude: number } | null {
  const cleaned = s.trim().split(/\s+/)[0];
  const parts = cleaned.split(',').map((v) => parseFloat(v));
  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
  return { longitude: parts[0], latitude: parts[1] };
}

function parseCoordinateList(
  s: string,
): Array<{ latitude: number; longitude: number }> {
  const tokens = s.trim().split(/\s+/);
  const result: Array<{ latitude: number; longitude: number }> = [];
  for (const t of tokens) {
    const parts = t.split(',').map((v) => parseFloat(v));
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      result.push({ longitude: parts[0], latitude: parts[1] });
    }
  }
  return result;
}

// =============================================================================
// Build (export)
// =============================================================================
export interface KmlExportElement {
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  description?: string | null;
}

export interface KmlExportCable {
  name: string;
  displayColor: string | null;
  segments: Array<{ seq: number; path: number[][] }>;
}

export interface KmlExportFolder {
  name: string;
  elements: KmlExportElement[];
  cables: KmlExportCable[];
}

/** #rrggbb → aabbggrr (formato de cor do KML), opaco. */
export function kmlColor(hex: string | null, fallback = '#f97316'): string {
  const h = /^#[0-9a-fA-F]{6}$/.test(hex ?? '') ? hex! : fallback;
  const r = h.slice(1, 3);
  const g = h.slice(3, 5);
  const b = h.slice(5, 7);
  return `ff${b}${g}${r}`.toLowerCase();
}

const ELEMENT_STYLE_COLOR: Record<string, string> = {
  POP: 'ff7c3aed',
  CABINET: 'ff0891b2',
  CEO: 'ff2563eb',
  CTO: 'ff16a34a',
  POLE: 'ff64748b',
  SLACK_COIL: 'ffca8a04',
  CUSTOMER_PREMISE: 'ffdb2777',
};

export function buildFibermapKml(
  folders: KmlExportFolder[],
  documentName: string,
): string {
  const folderNodes = folders.map((folder) => {
    const placemarks: Array<Record<string, unknown>> = [];
    for (const el of folder.elements) {
      placemarks.push({
        name: el.name,
        ...(el.description ? { description: el.description } : {}),
        styleUrl: `#netx-${el.type.toLowerCase()}`,
        ExtendedData: {
          Data: [{ '@_name': 'netx-type', value: el.type }],
        },
        Point: {
          coordinates: `${el.longitude},${el.latitude},0`,
        },
      });
    }
    for (const cable of folder.cables) {
      for (const seg of cable.segments) {
        const coords = seg.path
          .filter(
            (p): p is [number, number] =>
              Array.isArray(p) &&
              typeof p[0] === 'number' &&
              typeof p[1] === 'number',
          )
          .map(([lng, lat]) => `${lng},${lat},0`)
          .join(' ');
        if (!coords) continue;
        placemarks.push({
          name:
            cable.segments.length > 1 ? `${cable.name} #${seg.seq}` : cable.name,
          // Estilo inline: cor da polyline do cabo (Google Earth respeita).
          Style: {
            LineStyle: { color: kmlColor(cable.displayColor), width: '3' },
          },
          ExtendedData: {
            Data: [{ '@_name': 'netx-cable', value: cable.name }],
          },
          LineString: { tessellate: '1', coordinates: coords },
        });
      }
    }
    return { name: folder.name, Placemark: placemarks };
  });

  const doc: Record<string, unknown> = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    kml: {
      '@_xmlns': KML_NS,
      Document: {
        name: documentName,
        Style: Object.entries(ELEMENT_STYLE_COLOR).map(([type, color]) => ({
          '@_id': `netx-${type.toLowerCase()}`,
          IconStyle: { color, scale: type === 'POLE' ? '0.7' : '1.0' },
        })),
        Folder: folderNodes,
      },
    },
  };

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    format: true,
    indentBy: '  ',
    suppressEmptyNode: true,
  });
  return builder.build(doc);
}

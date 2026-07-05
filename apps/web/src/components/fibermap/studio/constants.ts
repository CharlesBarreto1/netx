/**
 * Constantes e helpers puros do Estúdio FiberMap (Tela 1 · FM-1).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Tudo aqui é compartilhado entre o mapa (MapLibre), o painel lateral e os
 * forms — cores por tipo (mesmas do spec §7), mapeamento tipo→produto do
 * catálogo (spec §3.3) e utilidades de árvore de pastas/coordenadas.
 */
import {
  Box,
  Cylinder,
  Disc3,
  Home,
  Radio,
  Server,
  UtilityPole,
  type LucideIcon,
} from 'lucide-react';

import type {
  FibermapElementType,
  FibermapFolder,
  FibermapProductType,
} from '@/lib/fibermap-api';

// ─── Modos do estúdio ────────────────────────────────────────────────────────
export type StudioMode =
  | { kind: 'select' }
  | { kind: 'add'; type: FibermapElementType }
  | { kind: 'reposition'; elementId: string }
  // FM-2: desenhar cabo — 1º clique snap num elemento, cliques intermediários
  // viram vértices, clique noutro elemento fecha o trecho (atalho C).
  | { kind: 'draw' };

/** Viewport do mapa — persiste em ?lat&lng&z pra deep-link. */
export interface StudioView {
  latitude: number;
  longitude: number;
  zoom: number;
}

// ─── Tipos de elemento ───────────────────────────────────────────────────────
export const ELEMENT_TYPES: readonly FibermapElementType[] = [
  'POP',
  'CABINET',
  'CEO',
  'CTO',
  'POLE',
  'SLACK_COIL',
  'CUSTOMER_PREMISE',
];

/** Cores por tipo no mapa (spec §7 — círculos unclustered). */
export const ELEMENT_TYPE_COLOR: Record<FibermapElementType, string> = {
  POP: '#2563eb',
  CABINET: '#6b7280',
  CEO: '#7c3aed',
  CTO: '#16a34a',
  POLE: '#9ca3af',
  SLACK_COIL: '#ea580c',
  CUSTOMER_PREMISE: '#ec4899',
};

export const ELEMENT_TYPE_ICON: Record<FibermapElementType, LucideIcon> = {
  POP: Radio,
  CABINET: Server,
  CEO: Cylinder,
  CTO: Box,
  POLE: UtilityPole,
  SLACK_COIL: Disc3,
  CUSTOMER_PREMISE: Home,
};

/**
 * Tipos que exigem produto do catálogo na criação/edição (spec §3.3):
 * CEO→caixa de emenda, CTO→caixa de atendimento, CABINET→armário.
 * Os demais não têm produto na UI da FM-1.
 */
export const PRODUCT_TYPE_BY_ELEMENT: Partial<
  Record<FibermapElementType, FibermapProductType>
> = {
  CEO: 'SPLICE_CLOSURE',
  CTO: 'TERMINATION_BOX',
  CABINET: 'CABINET',
};

// ─── Toolbar / atalhos ───────────────────────────────────────────────────────
/** Ferramentas rápidas da topbar (com atalho de teclado). */
export const QUICK_ADD_TOOLS: ReadonlyArray<{
  type: FibermapElementType;
  shortcut: string;
}> = [
  { type: 'CTO', shortcut: 'B' },
  { type: 'CEO', shortcut: 'E' },
  { type: 'POP', shortcut: 'P' },
  { type: 'POLE', shortcut: 'O' },
];

/** Tipos restantes — ficam no dropdown "Mais" da topbar. */
export const MORE_ADD_TYPES: readonly FibermapElementType[] = [
  'CABINET',
  'SLACK_COIL',
  'CUSTOMER_PREMISE',
];

/** tecla (minúscula) → tipo, pros atalhos B/E/P/O. */
export const ADD_SHORTCUTS: { readonly [key: string]: FibermapElementType | undefined } = {
  b: 'CTO',
  e: 'CEO',
  p: 'POP',
  o: 'POLE',
};

// ─── Coordenadas ─────────────────────────────────────────────────────────────
/**
 * Aceita colar "lat, lng" num campo único (spec §14.7 — padrão Tomodat).
 * Separador: vírgula, ponto-e-vírgula ou espaço. Valida faixas geográficas.
 */
export function parseLatLng(
  raw: string,
): { latitude: number; longitude: number } | null {
  const parts = raw
    .trim()
    .split(/[,;]+|\s+/)
    .filter((p) => p.length > 0);
  if (parts.length !== 2) return null;
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

// ─── Árvore de pastas (flat list → árvore por parentId) ──────────────────────
export interface FolderTreeNode {
  folder: FibermapFolder;
  children: FolderTreeNode[];
}

export function buildFolderTree(folders: FibermapFolder[]): FolderTreeNode[] {
  const byParent = new Map<string | null, FibermapFolder[]>();
  for (const f of folders) {
    const key = f.parentId ?? null;
    const list = byParent.get(key);
    if (list) list.push(f);
    else byParent.set(key, [f]);
  }
  const sortFn = (a: FibermapFolder, b: FibermapFolder) =>
    a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  const build = (parentId: string | null): FolderTreeNode[] =>
    (byParent.get(parentId) ?? [])
      .slice()
      .sort(sortFn)
      .map((folder) => ({ folder, children: build(folder.id) }));
  return build(null);
}

/** Achata a árvore com profundidade — pros <Select> de pasta dos forms. */
export function flattenFolderTree(
  nodes: FolderTreeNode[],
  depth = 0,
): Array<{ folder: FibermapFolder; depth: number }> {
  return nodes.flatMap((n) => [
    { folder: n.folder, depth },
    ...flattenFolderTree(n.children, depth + 1),
  ]);
}

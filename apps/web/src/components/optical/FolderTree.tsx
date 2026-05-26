'use client';

/**
 * FolderTree — sidebar lateral com árvore de pastas administrativas (R4.5e).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Doc: docs/architecture/osp-network.md
 *
 * Comportamento:
 *   - Lista flat de pastas → constrói árvore por parentId no render.
 *   - Checkbox por nó filtra a visibilidade no mapa (controlled pelo pai).
 *   - Sentinel "Sem pasta" (unassigned) também tem checkbox.
 *   - Menu de contexto: criar subpasta, renomear, deletar.
 *   - Hover destaca pasta no mapa (TODO v2).
 *
 * Drag-drop entre pastas fica pra v2 — em v1, operador renomeia/move via
 * menu de contexto com Select de "mover pra…".
 */
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import type { NetworkFolder } from '@/lib/network-folders-api';

interface FolderNode extends NetworkFolder {
  children: FolderNode[];
}

interface Props {
  folders: NetworkFolder[];
  /** Set de IDs visíveis no mapa (controlado). 'unassigned' é sentinel. */
  visibleIds: Set<string>;
  onVisibleChange: (ids: Set<string>) => void;
  onCreate?: (parentId: string | null) => void;
  onEdit?: (folder: NetworkFolder) => void;
  onDelete?: (folder: NetworkFolder) => void;
  canWrite?: boolean;
}

export function FolderTree({
  folders,
  visibleIds,
  onVisibleChange,
  onCreate,
  onEdit,
  onDelete,
  canWrite,
}: Props) {
  const tree = useMemo(() => buildTree(folders), [folders]);

  function toggleVisible(id: string) {
    const next = new Set(visibleIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onVisibleChange(next);
  }

  function selectAll() {
    const all = new Set<string>(folders.map((f) => f.id));
    all.add('unassigned');
    onVisibleChange(all);
  }

  function selectNone() {
    onVisibleChange(new Set());
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Pastas
        </span>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={selectAll}
            className="text-2xs text-text-muted hover:text-text"
            title="Mostrar todas"
          >
            todas
          </button>
          <span className="text-text-subtle">·</span>
          <button
            type="button"
            onClick={selectNone}
            className="text-2xs text-text-muted hover:text-text"
            title="Esconder todas"
          >
            nenhuma
          </button>
          {canWrite && onCreate && (
            <button
              type="button"
              onClick={() => onCreate(null)}
              title="Nova pasta raiz"
              className="ml-1 rounded p-0.5 text-text-muted hover:bg-surface-hover hover:text-text"
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1 py-1 text-sm">
        {tree.map((node) => (
          <FolderNodeView
            key={node.id}
            node={node}
            depth={0}
            visibleIds={visibleIds}
            toggleVisible={toggleVisible}
            onCreate={onCreate}
            onEdit={onEdit}
            onDelete={onDelete}
            canWrite={canWrite}
          />
        ))}

        {/* Sentinel: itens órfãos (sem pasta). Sempre presente. */}
        <div className="mt-2 border-t border-border pt-2">
          <div className="flex items-center gap-1.5 rounded px-1 py-1 hover:bg-surface-hover">
            <input
              type="checkbox"
              checked={visibleIds.has('unassigned')}
              onChange={() => toggleVisible('unassigned')}
              className="h-3.5 w-3.5"
            />
            <span
              className="inline-block h-3 w-3 rounded-sm border"
              style={{ borderColor: '#94a3b8', backgroundColor: 'transparent' }}
            />
            <span className="text-xs italic text-text-muted">Sem pasta</span>
          </div>
        </div>

        {tree.length === 0 && (
          <p className="px-2 py-3 text-xs text-text-muted">
            Nenhuma pasta ainda. Crie uma pra agrupar caixas e cabos.
          </p>
        )}
      </div>
    </div>
  );
}

function FolderNodeView({
  node,
  depth,
  visibleIds,
  toggleVisible,
  onCreate,
  onEdit,
  onDelete,
  canWrite,
}: {
  node: FolderNode;
  depth: number;
  visibleIds: Set<string>;
  toggleVisible: (id: string) => void;
  onCreate?: (parentId: string | null) => void;
  onEdit?: (folder: NetworkFolder) => void;
  onDelete?: (folder: NetworkFolder) => void;
  canWrite?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const totalItems = node.itemCounts.enclosures + node.itemCounts.cables;

  return (
    <div>
      <div
        className="group flex items-center gap-1.5 rounded px-1 py-1 hover:bg-surface-hover"
        style={{ paddingLeft: depth * 14 + 4 }}
      >
        {/* Chevron expand/collapse */}
        {node.children.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-text-muted"
          >
            {open ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="w-3.5" />
        )}

        <input
          type="checkbox"
          checked={visibleIds.has(node.id)}
          onChange={() => toggleVisible(node.id)}
          className="h-3.5 w-3.5"
        />

        <Folder
          className="h-3.5 w-3.5 shrink-0"
          style={{ color: node.color ?? '#64748b' }}
        />

        <span className="flex-1 truncate text-xs" title={node.name}>
          {node.name}
        </span>

        {totalItems > 0 && (
          <span className="text-2xs text-text-muted">{totalItems}</span>
        )}

        {canWrite && (
          <div className="relative opacity-0 group-hover:opacity-100">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded p-0.5 text-text-muted hover:bg-surface-active hover:text-text"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-5 z-10 min-w-[140px] rounded-md border border-border bg-surface shadow-md"
                onMouseLeave={() => setMenuOpen(false)}
              >
                <button
                  type="button"
                  onClick={() => {
                    onCreate?.(node.id);
                    setMenuOpen(false);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-xs hover:bg-surface-hover"
                >
                  + Subpasta
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onEdit?.(node);
                    setMenuOpen(false);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-xs hover:bg-surface-hover"
                >
                  Renomear / cor
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDelete?.(node);
                    setMenuOpen(false);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                >
                  <Trash2 className="inline h-3 w-3" /> Excluir
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {open &&
        node.children.map((child) => (
          <FolderNodeView
            key={child.id}
            node={child}
            depth={depth + 1}
            visibleIds={visibleIds}
            toggleVisible={toggleVisible}
            onCreate={onCreate}
            onEdit={onEdit}
            onDelete={onDelete}
            canWrite={canWrite}
          />
        ))}
    </div>
  );
}

function buildTree(folders: NetworkFolder[]): FolderNode[] {
  const map = new Map<string, FolderNode>();
  for (const f of folders) {
    map.set(f.id, { ...f, children: [] });
  }
  const roots: FolderNode[] = [];
  for (const f of folders) {
    const node = map.get(f.id)!;
    if (f.parentId && map.has(f.parentId)) {
      map.get(f.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // Ordena children por position depois name.
  function sort(nodes: FolderNode[]) {
    nodes.sort((a, b) =>
      a.position !== b.position
        ? a.position - b.position
        : a.name.localeCompare(b.name),
    );
    nodes.forEach((n) => sort(n.children));
  }
  sort(roots);
  return roots;
}

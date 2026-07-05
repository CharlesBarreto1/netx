'use client';

/**
 * StudioSidebar — painel esquerdo do Estúdio FiberMap (w-72, colapsável).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Três blocos:
 *   1. Busca de elementos (autocomplete server-side com debounce →
 *      seleção voa até o elemento e abre o detalhe).
 *   2. Chips de filtro por tipo (multi-seleção; refetch do viewport).
 *   3. Árvore de pastas (flat → árvore por parentId; clique = toggle do
 *      filtro folderId; ações por pasta em dropdown).
 */
import {
  ChevronRight,
  Folder,
  FolderPlus,
  MoreVertical,
  Pencil,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/Input';
import { InlineLoader } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import {
  fibermapApi,
  type FibermapElementSearchHit,
  type FibermapElementType,
  type FibermapFolder,
  type FibermapFolderContents,
} from '@/lib/fibermap-api';

import {
  buildFolderTree,
  ELEMENT_TYPE_COLOR,
  ELEMENT_TYPE_ICON,
  ELEMENT_TYPES,
  type FolderTreeNode,
} from './constants';

interface StudioSidebarProps {
  folders: FibermapFolder[];
  foldersLoading: boolean;
  selectedFolderId: string | null;
  onToggleFolder: (id: string) => void;
  onClearFolder: () => void;
  typeFilter: ReadonlySet<FibermapElementType>;
  onToggleType: (type: FibermapElementType) => void;
  onClearTypes: () => void;
  onCreateFolder: (parentId: string | null) => void;
  onRenameFolder: (folder: FibermapFolder) => void;
  onDeleteFolder: (folder: FibermapFolder) => void;
  onSelectSearchHit: (hit: FibermapElementSearchHit) => void;
  /** FM-2: clique num cabo do conteúdo da pasta abre o drawer do cabo. */
  onOpenCable: (cableId: string) => void;
  canWrite: boolean;
  canDelete: boolean;
}

export function StudioSidebar({
  folders,
  foldersLoading,
  selectedFolderId,
  onToggleFolder,
  onClearFolder,
  typeFilter,
  onToggleType,
  onClearTypes,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onSelectSearchHit,
  onOpenCable,
  canWrite,
  canDelete,
}: StudioSidebarProps) {
  const t = useTranslations('fibermap');
  const tree = useMemo(() => buildFolderTree(folders), [folders]);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-surface">
      {/* ── Busca ─────────────────────────────────────────────────────────── */}
      <div className="border-b border-border p-2">
        <SearchBox onSelect={onSelectSearchHit} />
      </div>

      {/* ── Filtro por tipo ───────────────────────────────────────────────── */}
      <div className="border-b border-border p-2">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-2xs font-semibold uppercase tracking-wider text-text-subtle">
            {t('studio.filters.title')}
          </span>
          {typeFilter.size > 0 && (
            <button
              type="button"
              onClick={onClearTypes}
              className="text-2xs text-text-muted hover:text-text"
            >
              {t('studio.filters.clear')}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {ELEMENT_TYPES.map((type) => {
            const active = typeFilter.has(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => onToggleType(type)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors',
                  active
                    ? 'border-accent bg-accent-muted text-accent'
                    : 'border-border text-text-muted hover:bg-surface-hover hover:text-text',
                )}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: ELEMENT_TYPE_COLOR[type] }}
                />
                {t(`studio.type.${type}`)}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Pastas ────────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-2 pb-1 pt-2">
          <span className="text-2xs font-semibold uppercase tracking-wider text-text-subtle">
            {t('studio.folders.title')}
          </span>
          <div className="flex items-center gap-1">
            {selectedFolderId && (
              <button
                type="button"
                onClick={onClearFolder}
                className="text-2xs text-text-muted hover:text-text"
              >
                {t('studio.folders.clear')}
              </button>
            )}
            {canWrite && (
              <button
                type="button"
                onClick={() => onCreateFolder(null)}
                title={t('studio.folders.new')}
                className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-surface-hover hover:text-text"
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
          {foldersLoading ? (
            <div className="flex justify-center py-4">
              <InlineLoader />
            </div>
          ) : tree.length === 0 ? (
            <p className="px-2 py-3 text-xs text-text-subtle">
              {t('studio.folders.empty')}
            </p>
          ) : (
            tree.map((node) => (
              <FolderNode
                key={node.folder.id}
                node={node}
                depth={0}
                selectedFolderId={selectedFolderId}
                onToggleFolder={onToggleFolder}
                onCreateFolder={onCreateFolder}
                onRenameFolder={onRenameFolder}
                onDeleteFolder={onDeleteFolder}
                onSelectElement={onSelectSearchHit}
                onOpenCable={onOpenCable}
                canWrite={canWrite}
                canDelete={canDelete}
              />
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

// ─── Nó da árvore de pastas ──────────────────────────────────────────────────
function FolderNode({
  node,
  depth,
  selectedFolderId,
  onToggleFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onSelectElement,
  onOpenCable,
  canWrite,
  canDelete,
}: {
  node: FolderTreeNode;
  depth: number;
  selectedFolderId: string | null;
  onToggleFolder: (id: string) => void;
  onCreateFolder: (parentId: string | null) => void;
  onRenameFolder: (folder: FibermapFolder) => void;
  onDeleteFolder: (folder: FibermapFolder) => void;
  onSelectElement: (hit: FibermapElementSearchHit) => void;
  onOpenCable: (cableId: string) => void;
  canWrite: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations('fibermap');
  const tc = useTranslations('common');
  // Fechado por default: expandir dispara o fetch do conteúdo (lazy) — spec §7
  // (pasta → elementos) sem bombardear a API com N pastas no mount.
  const [open, setOpen] = useState(false);
  const { folder, children } = node;
  const selected = selectedFolderId === folder.id;
  const hasActions = canWrite || canDelete;
  const itemsCount = (folder.elementsCount ?? 0) + (folder.cablesCount ?? 0);
  const expandable = children.length > 0 || itemsCount > 0;

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-0.5 rounded-md pr-1',
          selected ? 'bg-accent-muted text-accent' : 'hover:bg-surface-hover',
        )}
        style={{ paddingLeft: depth * 12 + 2 }}
      >
        {expandable ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex h-6 w-5 shrink-0 items-center justify-center text-text-subtle hover:text-text"
            title={open ? tc('close') : tc('open')}
          >
            <ChevronRight
              className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')}
            />
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onToggleFolder(folder.id)}
          title={folder.name}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-xs"
        >
          <Folder
            className={cn(
              'h-3.5 w-3.5 shrink-0',
              selected ? 'text-accent' : 'text-text-subtle',
            )}
          />
          <span className={cn('truncate', selected ? 'font-medium' : 'text-text')}>
            {folder.name}
          </span>
          {itemsCount > 0 && (
            <span className="ml-auto shrink-0 text-2xs text-text-subtle">
              {itemsCount}
            </span>
          )}
        </button>
        {hasActions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title={tc('actions')}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-subtle opacity-0 hover:bg-surface-hover hover:text-text focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="z-[2000]">
              {canWrite && (
                <>
                  <DropdownMenuItem onSelect={() => onRenameFolder(folder)}>
                    <Pencil className="h-3.5 w-3.5" />
                    {t('studio.folders.rename')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onCreateFolder(folder.id)}>
                    <FolderPlus className="h-3.5 w-3.5" />
                    {t('studio.folders.newSub')}
                  </DropdownMenuItem>
                </>
              )}
              {canWrite && canDelete && <DropdownMenuSeparator />}
              {canDelete && (
                <DropdownMenuItem
                  variant="danger"
                  onSelect={() => onDeleteFolder(folder)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('studio.folders.delete')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {open && (
        <>
          {children.map((child) => (
            <FolderNode
              key={child.folder.id}
              node={child}
              depth={depth + 1}
              selectedFolderId={selectedFolderId}
              onToggleFolder={onToggleFolder}
              onCreateFolder={onCreateFolder}
              onRenameFolder={onRenameFolder}
              onDeleteFolder={onDeleteFolder}
              onSelectElement={onSelectElement}
              onOpenCable={onOpenCable}
              canWrite={canWrite}
              canDelete={canDelete}
            />
          ))}
          {itemsCount > 0 && (
            <FolderContents
              folderId={folder.id}
              depth={depth + 1}
              onSelectElement={onSelectElement}
              onOpenCable={onOpenCable}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Conteúdo da pasta (elementos + cabos, lazy — spec §7) ───────────────────
function FolderContents({
  folderId,
  depth,
  onSelectElement,
  onOpenCable,
}: {
  folderId: string;
  depth: number;
  onSelectElement: (hit: FibermapElementSearchHit) => void;
  onOpenCable: (cableId: string) => void;
}) {
  const { data, error } = useSWR<FibermapFolderContents>(
    `/v1/fibermap/folders/${folderId}/contents`,
  );
  const pad = { paddingLeft: depth * 12 + 24 };

  if (error) return null;
  if (!data) {
    return (
      <div className="py-1" style={pad}>
        <InlineLoader />
      </div>
    );
  }
  return (
    <div className="space-y-px pb-0.5">
      {data.cables.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onOpenCable(c.id)}
          title={c.name}
          className="flex w-full min-w-0 items-center gap-1.5 rounded-md py-0.5 pr-2 text-left text-xs text-text-muted hover:bg-surface-hover hover:text-text"
          style={pad}
        >
          <span
            className="h-1.5 w-4 shrink-0 rounded-sm"
            style={{ backgroundColor: c.displayColor ?? '#64748b' }}
          />
          <span className="truncate">{c.name}</span>
          <span className="ml-auto shrink-0 text-2xs text-text-subtle">
            {c.fiberCount}FO
          </span>
        </button>
      ))}
      {data.elements.map((el) => {
        const Icon = ELEMENT_TYPE_ICON[el.type];
        return (
          <button
            key={el.id}
            type="button"
            onClick={() =>
              onSelectElement({
                id: el.id,
                type: el.type,
                name: el.name,
                latitude: el.latitude,
                longitude: el.longitude,
                folderId,
              })
            }
            title={el.name}
            className="flex w-full min-w-0 items-center gap-1.5 rounded-md py-0.5 pr-2 text-left text-xs text-text-muted hover:bg-surface-hover hover:text-text"
            style={pad}
          >
            <Icon
              className="h-3 w-3 shrink-0"
              style={{ color: ELEMENT_TYPE_COLOR[el.type] }}
            />
            <span className="truncate">{el.name}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Busca de elementos (autocomplete) ───────────────────────────────────────
function SearchBox({
  onSelect,
}: {
  onSelect: (hit: FibermapElementSearchHit) => void;
}) {
  const t = useTranslations('fibermap');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<FibermapElementSearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Descarta respostas fora de ordem (digitação rápida).
  const seqRef = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    const seq = ++seqRef.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      fibermapApi
        .searchElements(q)
        .then((res) => {
          if (seqRef.current !== seq) return;
          setHits(res);
        })
        .catch(() => {
          if (seqRef.current !== seq) return;
          setHits([]);
        })
        .finally(() => {
          if (seqRef.current === seq) setLoading(false);
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const showList = open && query.trim().length >= 2;

  return (
    <div ref={rootRef} className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-subtle" />
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder={t('studio.search.placeholder')}
        className="pl-8 pr-7 text-xs"
      />
      {query.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setQuery('');
            setOpen(false);
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-text-subtle hover:text-text"
          title={t('studio.search.clear')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {showList && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-surface-elevated shadow-pop">
          {loading ? (
            <p className="px-3 py-2 text-xs text-text-muted">
              {t('studio.search.loading')}
            </p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-2 text-xs text-text-muted">
              {t('studio.search.empty')}
            </p>
          ) : (
            <ul className="py-1">
              {hits.map((hit) => {
                const Icon = ELEMENT_TYPE_ICON[hit.type];
                return (
                  <li key={hit.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(hit);
                        setOpen(false);
                        setQuery(hit.name);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-surface-hover"
                    >
                      <Icon
                        className="h-3.5 w-3.5 shrink-0"
                        style={{ color: ELEMENT_TYPE_COLOR[hit.type] }}
                      />
                      <span className="truncate text-text">{hit.name}</span>
                      <span className="ml-auto shrink-0 text-2xs text-text-subtle">
                        {t(`studio.type.${hit.type}`)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

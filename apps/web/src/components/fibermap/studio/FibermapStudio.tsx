'use client';

/**
 * FibermapStudio — orquestrador da Tela 1 do FiberMap (FM-1).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Layout full-screen (route group (fullscreen), sem AppShell): topbar h-12 +
 * painel esquerdo colapsável + mapa MapLibre no resto. Estado central:
 *   - modo (select / add-<tipo> / reposition) com atalhos V·B·E·P·O·Esc;
 *   - filtros (tipos multi-seleção + pasta) → repassados ao mapa (refetch);
 *   - viewport persistido em ?lat&lng&z via history.replaceState (deep-link
 *     sem re-render do router a cada pan — o estado "vivo" fica no mapa);
 *   - modais (criar elemento, pasta, confirmações) e drawer de detalhe.
 *
 * Permissões como UX (backend é a autoridade): botões de escrita somem sem
 * fibermap.write, exclusões sem fibermap.delete, Config sem fibermap.admin.
 */
import type { Route } from 'next';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';

import { InlineLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  FIBERMAP_OTDR_STORAGE_KEY,
  FIBERMAP_TRACE_STORAGE_KEY,
  fibermapApi,
  type FibermapElementSearchHit,
  type FibermapElementType,
  type FibermapFolder,
} from '@/lib/fibermap-api';
import { hasPermission } from '@/lib/session';

import {
  ADD_SHORTCUTS,
  ELEMENT_TYPES,
  type StudioMode,
  type StudioView,
} from './constants';
import { CableDetailDrawer } from './CableDetailDrawer';
import { CableDrawModal } from './CableDrawModal';
import { ElementCreateModal, type ElementDraft } from './ElementCreateModal';
import { ElementDetailDrawer } from './ElementDetailDrawer';
import { OtdrModal } from '../otdr/OtdrModal';
import type {
  FibermapDrawResult,
  FibermapMapHandle,
  FibermapMapLabels,
  FibermapOtdrOverlay,
  FibermapTraceHighlight,
} from './FibermapMap';
import { FolderEditModal } from './FolderEditModal';
import { StudioConfirm } from './StudioModal';
import { StudioSidebar } from './StudioSidebar';
import { StudioTopbar } from './StudioTopbar';

// MapLibre é client-only (window/WebGL) — mesmo padrão do NetworkMap Leaflet.
const FibermapMap = dynamic(
  () => import('./FibermapMap').then((m) => m.FibermapMap),
  { ssr: false, loading: () => <MapLoading /> },
);

function MapLoading() {
  const t = useTranslations('fibermap');
  return (
    <div className="flex h-full items-center justify-center bg-surface-muted">
      <InlineLoader label={t('studio.map.loading')} />
    </div>
  );
}

type FolderModalState = FibermapFolder | { parentId: string | null };

export function FibermapStudio({ initialView }: { initialView: StudioView }) {
  const t = useTranslations('fibermap');
  const tc = useTranslations('common');
  const router = useRouter();

  // Gate client-side puro: o (fullscreen) layout só renderiza children após
  // checar a sessão no client, então ler localStorage aqui é seguro.
  const canWrite = useMemo(() => hasPermission('fibermap.write'), []);
  const canDelete = useMemo(() => hasPermission('fibermap.delete'), []);
  const canAdmin = useMemo(() => hasPermission('fibermap.admin'), []);

  // ── Estado central ─────────────────────────────────────────────────────────
  const [mode, setMode] = useState<StudioMode>({ kind: 'select' });
  const [panelOpen, setPanelOpen] = useState(true);
  const [typeFilter, setTypeFilter] = useState<ReadonlySet<FibermapElementType>>(
    new Set(),
  );
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [viewportInfo, setViewportInfo] = useState({ count: 0, truncated: false });

  const [draft, setDraft] = useState<ElementDraft | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  // FM-2: trecho desenhado aguardando o modal (novo cabo / continuar) e o
  // drawer de detalhe de cabo (mutuamente exclusivo com o de elemento).
  const [drawResult, setDrawResult] = useState<FibermapDrawResult | null>(null);
  const [cableDetailId, setCableDetailId] = useState<string | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [folderModal, setFolderModal] = useState<FolderModalState | null>(null);
  const [folderDeleting, setFolderDeleting] = useState<FibermapFolder | null>(
    null,
  );
  const [folderDeleteBusy, setFolderDeleteBusy] = useState(false);

  const mapHandleRef = useRef<FibermapMapHandle | null>(null);

  // ── Trace vindo do access-point ("Ver no mapa", FM-4) ──────────────────────
  const [trace, setTrace] = useState<FibermapTraceHighlight | null>(null);
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(FIBERMAP_TRACE_STORAGE_KEY);
      if (raw) setTrace(JSON.parse(raw) as FibermapTraceHighlight);
    } catch {
      // payload corrompido — ignora e limpa
      window.sessionStorage.removeItem(FIBERMAP_TRACE_STORAGE_KEY);
    }
  }, []);
  const clearTrace = useCallback(() => {
    setTrace(null);
    window.sessionStorage.removeItem(FIBERMAP_TRACE_STORAGE_KEY);
  }, []);

  // ── OTDR (FM-5): modal + overlay (círculo de incerteza) ───────────────────
  const [otdrElementId, setOtdrElementId] = useState<string | null>(null);
  const [otdr, setOtdr] = useState<FibermapOtdrOverlay | null>(null);
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(FIBERMAP_OTDR_STORAGE_KEY);
      if (raw) setOtdr(JSON.parse(raw) as FibermapOtdrOverlay);
    } catch {
      window.sessionStorage.removeItem(FIBERMAP_OTDR_STORAGE_KEY);
    }
  }, []);
  const clearOtdr = useCallback(() => {
    setOtdr(null);
    window.sessionStorage.removeItem(FIBERMAP_OTDR_STORAGE_KEY);
  }, []);
  const handleOpenOtdr = useCallback((id: string) => setOtdrElementId(id), []);
  const applyOtdrOverlay = useCallback((overlay: FibermapOtdrOverlay) => {
    setOtdr(overlay);
    window.sessionStorage.setItem(FIBERMAP_OTDR_STORAGE_KEY, JSON.stringify(overlay));
    setOtdrElementId(null);
  }, []);

  // ── Pastas (SWR — fetcher global do layout) ────────────────────────────────
  const { data: foldersData, mutate: mutateFolders } = useSWR<FibermapFolder[]>(
    '/v1/fibermap/folders',
  );
  const folders = foldersData ?? [];

  const typeArray = useMemo(
    () => ELEMENT_TYPES.filter((et) => typeFilter.has(et)),
    [typeFilter],
  );

  const mapLabels = useMemo<FibermapMapLabels>(
    () => ({
      detail: t('studio.popup.detail'),
      remove: t('studio.popup.delete'),
      loadError: t('studio.map.loadError'),
      accessPoint: t('studio.popup.accessPoint'),
      otdr: t('studio.popup.otdr'),
      drawStartOnElement: t('studio.cable.drawStartOnElement'),
      typeLabels: Object.fromEntries(
        ELEMENT_TYPES.map((et) => [et, t(`studio.type.${et}`)]),
      ) as Record<FibermapElementType, string>,
    }),
    [t],
  );

  // ── Viewport → querystring (deep-link) ─────────────────────────────────────
  const handleViewChange = useCallback((v: StudioView) => {
    // replaceState em vez de router.replace: o viewport muda a cada pan e o
    // router re-renderizaria a árvore toda; aqui só queremos URL compartilhável
    // (convenção §7 — estado em URL). Preserva o state interno do Next.
    const params = new URLSearchParams(window.location.search);
    params.set('lat', v.latitude.toFixed(5));
    params.set('lng', v.longitude.toFixed(5));
    params.set('z', v.zoom.toFixed(2));
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}?${params.toString()}`,
    );
  }, []);

  const handleData = useCallback(
    (info: { count: number; truncated: boolean }) => setViewportInfo(info),
    [],
  );

  // ── Clique no mapa em modo pick (add / reposicionar) ───────────────────────
  const handlePick = useCallback(
    (point: { latitude: number; longitude: number }) => {
      if (mode.kind === 'add') {
        setDraft({
          type: mode.type,
          latitude: point.latitude,
          longitude: point.longitude,
        });
        setMode({ kind: 'select' });
        return;
      }
      if (mode.kind === 'reposition') {
        const id = mode.elementId;
        setMode({ kind: 'select' });
        void (async () => {
          try {
            await fibermapApi.updateElement(id, {
              latitude: point.latitude,
              longitude: point.longitude,
            });
            toast.success(t('studio.toast.repositioned'));
            await globalMutate(`/v1/fibermap/elements/${id}`);
            mapHandleRef.current?.refresh();
          } catch (err) {
            toast.error(
              err instanceof ApiError ? err.friendlyMessage : tc('error'),
            );
          }
        })();
      }
    },
    [mode, t, tc],
  );

  const handleOpenDetail = useCallback((id: string) => {
    setCableDetailId(null);
    setDetailId(id);
  }, []);
  const handleRequestDelete = useCallback(
    (el: { id: string; name: string }) => setDeleteRequest(el),
    [],
  );

  // ── Desenho de cabo (FM-2) ─────────────────────────────────────────────────
  const handleDrawComplete = useCallback((result: FibermapDrawResult) => {
    setMode({ kind: 'select' });
    setDrawResult(result);
  }, []);
  const handleOpenCable = useCallback((cableId: string) => {
    setDetailId(null);
    setCableDetailId(cableId);
  }, []);
  const handleOpenAccessPoint = useCallback(
    (id: string) => {
      router.push(`/fibermap/access-point/${id}` as Route);
    },
    [router],
  );

  function closeDetail() {
    setDetailId(null);
    mapHandleRef.current?.setHighlight(null);
    if (mode.kind === 'reposition') setMode({ kind: 'select' });
  }

  // ── Busca → voar + destacar + abrir detalhe ────────────────────────────────
  function handleSearchHit(hit: FibermapElementSearchHit) {
    mapHandleRef.current?.flyTo(hit.longitude, hit.latitude, 17);
    mapHandleRef.current?.setHighlight({
      latitude: hit.latitude,
      longitude: hit.longitude,
    });
    setDetailId(hit.id);
  }

  // ── Exclusão de elemento (popup ou drawer) ─────────────────────────────────
  async function confirmDeleteElement() {
    if (!deleteRequest) return;
    setDeleting(true);
    try {
      await fibermapApi.deleteElement(deleteRequest.id);
      toast.success(t('studio.toast.elementDeleted', { name: deleteRequest.name }));
      if (detailId === deleteRequest.id) closeDetail();
      setDeleteRequest(null);
      mapHandleRef.current?.refresh();
    } catch (err) {
      // 409 = elemento com cabos/devices (spec §14.2) — mensagem do backend.
      toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setDeleting(false);
    }
  }

  // ── Exclusão de pasta ──────────────────────────────────────────────────────
  async function confirmDeleteFolder() {
    if (!folderDeleting) return;
    setFolderDeleteBusy(true);
    try {
      await fibermapApi.deleteFolder(folderDeleting.id);
      toast.success(t('studio.toast.folderDeleted'));
      if (selectedFolderId === folderDeleting.id) setSelectedFolderId(null);
      setFolderDeleting(null);
      await mutateFolders();
    } catch (err) {
      // 409 = pasta não vazia — mensagem do backend no toast.
      toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setFolderDeleteBusy(false);
    }
  }

  // ── Atalhos de teclado ─────────────────────────────────────────────────────
  useEffect(() => {
    function isTypingTarget(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      return (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable
      );
    }
    function handleKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const modalOpen = Boolean(
        draft || drawResult || folderModal || folderDeleting || deleteRequest || otdrElementId,
      );
      if (e.key === 'Escape') {
        if (modalOpen) return; // os modais fecham a si próprios
        if (mode.kind !== 'select') setMode({ kind: 'select' });
        return;
      }
      if (modalOpen) return;
      const k = e.key.toLowerCase();
      if (k === 'v') {
        setMode({ kind: 'select' });
        return;
      }
      if (!canWrite) return;
      if (k === 'c') {
        setMode({ kind: 'draw' });
        return;
      }
      const addType = ADD_SHORTCUTS[k];
      if (addType) setMode({ kind: 'add', type: addType });
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [mode, draft, drawResult, folderModal, folderDeleting, deleteRequest, otdrElementId, canWrite]);

  return (
    <div className="flex h-screen w-screen flex-col bg-bg text-text">
      {/* ─── Topbar ─────────────────────────────────────────────────────── */}
      <StudioTopbar
        mode={mode}
        onSelectMode={() => setMode({ kind: 'select' })}
        onAddMode={(type) => setMode({ kind: 'add', type })}
        onDrawMode={() => setMode({ kind: 'draw' })}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((o) => !o)}
        count={viewportInfo.count}
        truncated={viewportInfo.truncated}
        canWrite={canWrite}
        canAdmin={canAdmin}
      />

      {/* ─── Body ───────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {panelOpen && (
          <StudioSidebar
            folders={folders}
            foldersLoading={!foldersData}
            selectedFolderId={selectedFolderId}
            onToggleFolder={(id) =>
              setSelectedFolderId((cur) => (cur === id ? null : id))
            }
            onClearFolder={() => setSelectedFolderId(null)}
            typeFilter={typeFilter}
            onToggleType={(type) =>
              setTypeFilter((prev) => {
                const next = new Set(prev);
                if (next.has(type)) next.delete(type);
                else next.add(type);
                return next;
              })
            }
            onClearTypes={() => setTypeFilter(new Set())}
            onCreateFolder={(parentId) => setFolderModal({ parentId })}
            onRenameFolder={(f) => setFolderModal(f)}
            onDeleteFolder={setFolderDeleting}
            onSelectSearchHit={handleSearchHit}
            onOpenCable={handleOpenCable}
            canWrite={canWrite}
            canDelete={canDelete}
          />
        )}

        <main className="relative flex-1 overflow-hidden">
          <FibermapMap
            handleRef={mapHandleRef}
            initialView={initialView}
            mode={
              mode.kind === 'select'
                ? 'select'
                : mode.kind === 'draw'
                  ? 'draw'
                  : 'pick'
            }
            types={typeArray}
            folderId={selectedFolderId ?? undefined}
            canDelete={canDelete}
            canWrite={canWrite}
            trace={trace}
            otdr={otdr}
            labels={mapLabels}
            onViewChange={handleViewChange}
            onData={handleData}
            onPick={handlePick}
            onOpenDetail={handleOpenDetail}
            onRequestDelete={handleRequestDelete}
            onDrawComplete={handleDrawComplete}
            onOpenCable={handleOpenCable}
            onOpenAccessPoint={handleOpenAccessPoint}
            onOpenOtdr={handleOpenOtdr}
          />

          {/* Chips de overlays ativos (trace FM-4 / OTDR FM-5) */}
          {(trace || otdr) && (
            <div className="absolute left-1/2 top-3 z-[500] flex -translate-x-1/2 flex-col items-center gap-1.5">
              {trace && (
                <div className="flex items-center gap-2 rounded-full bg-slate-900/95 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-orange-400" />
                  <span className="max-w-[280px] truncate">
                    {t('studio.trace.active', { label: trace.label })}
                  </span>
                  <button
                    type="button"
                    className="rounded-full bg-white/10 px-2 py-0.5 hover:bg-white/20"
                    onClick={clearTrace}
                  >
                    {t('studio.trace.clear')}
                  </button>
                </div>
              )}
              {otdr && (
                <div className="flex items-center gap-2 rounded-full bg-slate-900/95 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-red-500" />
                  <span className="max-w-[280px] truncate">
                    {t('studio.otdr.active', { label: otdr.label })}
                  </span>
                  <button
                    type="button"
                    className="rounded-full bg-white/10 px-2 py-0.5 hover:bg-white/20"
                    onClick={clearOtdr}
                  >
                    {t('studio.trace.clear')}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* HUD — instrução do modo ativo */}
          {mode.kind !== 'select' && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 z-[500] -translate-x-1/2 rounded-md bg-slate-900/95 px-4 py-2 text-xs font-medium text-white shadow-lg">
              {mode.kind === 'add'
                ? t('studio.hint.add', { type: t(`studio.type.${mode.type}`) })
                : mode.kind === 'draw'
                  ? t('studio.hint.draw')
                  : t('studio.hint.reposition')}
            </div>
          )}
        </main>
      </div>

      {/* ─── Drawer de detalhe de cabo (FM-2) ───────────────────────────── */}
      {cableDetailId && (
        <CableDetailDrawer
          cableId={cableDetailId}
          canWrite={canWrite}
          canDelete={canDelete}
          onChanged={() => {
            mapHandleRef.current?.refresh();
            void mutateFolders();
          }}
          onDeleted={() => {
            setCableDetailId(null);
            mapHandleRef.current?.refresh();
            void mutateFolders();
          }}
          onClose={() => setCableDetailId(null)}
        />
      )}

      {/* ─── Drawer de detalhe ──────────────────────────────────────────── */}
      {detailId && (
        <ElementDetailDrawer
          elementId={detailId}
          folders={folders}
          canWrite={canWrite}
          canDelete={canDelete}
          repositionActive={
            mode.kind === 'reposition' && mode.elementId === detailId
          }
          onStartReposition={() =>
            setMode({ kind: 'reposition', elementId: detailId })
          }
          onCancelReposition={() => setMode({ kind: 'select' })}
          onRequestDelete={handleRequestDelete}
          onChanged={() => mapHandleRef.current?.refresh()}
          onClose={closeDetail}
        />
      )}

      {/* ─── Modais (z-[2000], acima do drawer) ─────────────────────────── */}
      {draft && (
        <ElementCreateModal
          draft={draft}
          folders={folders}
          defaultFolderId={selectedFolderId}
          onClose={() => setDraft(null)}
          onCreated={(el) => {
            setDraft(null);
            toast.success(t('studio.toast.elementCreated', { name: el.name }));
            mapHandleRef.current?.refresh();
            // Árvore de pastas: contadores + conteúdo (feedback FM-1).
            void mutateFolders();
          }}
        />
      )}

      {drawResult && (
        <CableDrawModal
          draw={drawResult}
          folders={folders}
          defaultFolderId={selectedFolderId}
          onClose={() => setDrawResult(null)}
          onCreated={(cable) => {
            setDrawResult(null);
            toast.success(t('studio.cable.segmentAdded', { name: cable.name }));
            mapHandleRef.current?.refresh();
            void mutateFolders();
            // Continua desenhando da nova ponta — fluxo Tomodat de espinha.
            setMode({ kind: 'draw' });
          }}
        />
      )}

      {folderModal && (
        <FolderEditModal
          initial={folderModal}
          onClose={() => setFolderModal(null)}
          onSaved={async () => {
            await mutateFolders();
            setFolderModal(null);
          }}
        />
      )}

      {otdrElementId && (
        <OtdrModal
          elementId={otdrElementId}
          onClose={() => setOtdrElementId(null)}
          onShowOnMap={applyOtdrOverlay}
        />
      )}

      {deleteRequest && (
        <StudioConfirm
          title={t('studio.element.deleteTitle', { name: deleteRequest.name })}
          message={t('studio.element.deleteMessage')}
          confirmLabel={tc('delete')}
          danger
          loading={deleting}
          onClose={() => {
            if (!deleting) setDeleteRequest(null);
          }}
          onConfirm={confirmDeleteElement}
        />
      )}

      {folderDeleting && (
        <StudioConfirm
          title={t('studio.folders.deleteTitle', { name: folderDeleting.name })}
          message={t('studio.folders.deleteMessage')}
          confirmLabel={tc('delete')}
          danger
          loading={folderDeleteBusy}
          onClose={() => {
            if (!folderDeleteBusy) setFolderDeleting(null);
          }}
          onConfirm={confirmDeleteFolder}
        />
      )}
    </div>
  );
}

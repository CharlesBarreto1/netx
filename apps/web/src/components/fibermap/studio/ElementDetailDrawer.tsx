'use client';

/**
 * ElementDetailDrawer — detalhe do elemento no Estúdio FiberMap (FM-1).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Abre do popup do mapa ou da busca. Mostra tudo do GET /elements/:id,
 * edição inline (nome, pasta, produto, coordenadas, endereço, descrição),
 * reposicionamento via clique no mapa (fluxo do pai) e fotos:
 *   - grid de thumbnails SEM pré-carregar imagem — a URL presignada só é
 *     resolvida sob demanda (clique) via photoDownloadUrl;
 *   - upload em 3 passos: presign → PUT direto no MinIO → register.
 *
 * Drawer lateral (não modal): o operador continua vendo a planta.
 * z-[1600] — acima do mapa, abaixo dos modais do estúdio (z-[2000]).
 */
import {
  Image as ImageIcon,
  Move,
  Pencil,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox';
import {
  FieldError,
  FieldHelp,
  Input,
  Label,
  Select,
  Textarea,
} from '@/components/ui/Input';
import { InlineLoader, Spinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  fibermapApi,
  type FibermapElement,
  type FibermapElementPhoto,
  type FibermapFolder,
} from '@/lib/fibermap-api';

import {
  buildFolderTree,
  ELEMENT_TYPE_COLOR,
  flattenFolderTree,
  parseLatLng,
  PRODUCT_TYPE_BY_ELEMENT,
} from './constants';
import { StudioConfirm } from './StudioModal';

interface ElementDetailDrawerProps {
  elementId: string;
  folders: FibermapFolder[];
  canWrite: boolean;
  canDelete: boolean;
  /** true enquanto o estúdio espera o clique de reposicionamento no mapa. */
  repositionActive: boolean;
  onStartReposition: () => void;
  onCancelReposition: () => void;
  onRequestDelete: (element: { id: string; name: string }) => void;
  /** Algo mudou (update/foto) — o pai refaz o fetch do viewport. */
  onChanged: () => void;
  onClose: () => void;
}

interface EditForm {
  name: string;
  folderId: string;
  coords: string;
  address: string;
  description: string;
  productId: string;
}

export function ElementDetailDrawer({
  elementId,
  folders,
  canWrite,
  canDelete,
  repositionActive,
  onStartReposition,
  onCancelReposition,
  onRequestDelete,
  onChanged,
  onClose,
}: ElementDetailDrawerProps) {
  const t = useTranslations('fibermap');
  const tc = useTranslations('common');
  const swrKey = `/v1/fibermap/elements/${elementId}`;
  const { data: element, mutate, error } = useSWR<FibermapElement>(swrKey);

  // ── Edição inline ──────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditForm | null>(null);
  const [productOption, setProductOption] = useState<ComboboxOption | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Fotos ──────────────────────────────────────────────────────────────────
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [photoLoadingId, setPhotoLoadingId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{
    photo: FibermapElementPhoto;
    url: string;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [photoDeleting, setPhotoDeleting] = useState<FibermapElementPhoto | null>(
    null,
  );
  const [photoDeleteBusy, setPhotoDeleteBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Troca de elemento → zera estado local.
  useEffect(() => {
    setEditing(false);
    setForm(null);
    setProductOption(null);
    setFormError(null);
    setPhotoUrls({});
    setPhotoLoadingId(null);
    setLightbox(null);
    setPhotoDeleting(null);
  }, [elementId]);

  // Esc fecha o lightbox (o handler global do estúdio não mexe no drawer).
  useEffect(() => {
    if (!lightbox) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setLightbox(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const productType = element ? PRODUCT_TYPE_BY_ELEMENT[element.type] : undefined;

  const loadProductOptions = useCallback(
    async (query: string): Promise<ComboboxOption[]> => {
      if (!productType) return [];
      const res = await fibermapApi.listProducts({
        type: productType,
        q: query || undefined,
        active: 'true',
        pageSize: 20,
      });
      return res.data.map((p) => ({
        value: p.id,
        label: p.name,
        sublabel: p.manufacturer || undefined,
      }));
    },
    [productType],
  );

  function startEdit() {
    if (!element) return;
    setForm({
      name: element.name,
      folderId: element.folderId,
      coords: `${element.latitude.toFixed(6)}, ${element.longitude.toFixed(6)}`,
      address: element.address ?? '',
      description: element.description ?? '',
      productId: element.productId ?? '',
    });
    setProductOption(
      element.product
        ? {
            value: element.product.id,
            label: element.product.name,
            sublabel: element.product.manufacturer || undefined,
          }
        : null,
    );
    setFormError(null);
    setEditing(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form || !element) return;
    const parsed = parseLatLng(form.coords);
    if (!form.name.trim()) return setFormError(t('studio.form.errorNameRequired'));
    if (!parsed) return setFormError(t('studio.form.errorCoords'));
    if (productType && !form.productId) {
      return setFormError(t('studio.form.errorProductRequired'));
    }
    setSaving(true);
    setFormError(null);
    try {
      await fibermapApi.updateElement(element.id, {
        name: form.name.trim(),
        folderId: form.folderId,
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        address: form.address.trim() || null,
        description: form.description.trim() || null,
        productId: productType ? form.productId : undefined,
      });
      toast.success(t('studio.toast.elementUpdated'));
      await mutate();
      onChanged();
      setEditing(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setSaving(false);
    }
  }

  async function openPhoto(photo: FibermapElementPhoto) {
    const cached = photoUrls[photo.id];
    if (cached) {
      setLightbox({ photo, url: cached });
      return;
    }
    setPhotoLoadingId(photo.id);
    try {
      const { downloadUrl } = await fibermapApi.photoDownloadUrl(
        elementId,
        photo.id,
      );
      setPhotoUrls((prev) => ({ ...prev, [photo.id]: downloadUrl }));
      setLightbox({ photo, url: downloadUrl });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setPhotoLoadingId(null);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite re-selecionar o mesmo arquivo depois
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error(t('studio.photos.invalidType'));
      return;
    }
    setUploading(true);
    try {
      const contentType = file.type || 'application/octet-stream';
      const presign = await fibermapApi.presignPhoto(elementId, {
        fileName: file.name,
        contentType,
      });
      // PUT direto no MinIO com a URL presignada (fora do api client —
      // é storage externo, sem Bearer do NetX).
      const res = await fetch(presign.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': contentType },
      });
      if (!res.ok) throw new Error(`Upload HTTP ${res.status}`);
      await fibermapApi.registerPhoto(elementId, {
        storageKey: presign.storageKey,
        fileName: file.name,
      });
      toast.success(t('studio.photos.uploaded'));
      await mutate();
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setUploading(false);
    }
  }

  async function confirmDeletePhoto() {
    if (!photoDeleting) return;
    setPhotoDeleteBusy(true);
    try {
      await fibermapApi.deletePhoto(elementId, photoDeleting.id);
      toast.success(t('studio.photos.deleted'));
      setPhotoDeleting(null);
      await mutate();
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setPhotoDeleteBusy(false);
    }
  }

  const folderName = element
    ? folders.find((f) => f.id === element.folderId)?.name ?? '—'
    : '—';
  const flatFolders = flattenFolderTree(buildFolderTree(folders));

  return (
    <aside className="fixed right-0 top-12 z-[1600] flex h-[calc(100vh-3rem)] w-96 max-w-[calc(100vw-2rem)] flex-col border-l border-border bg-surface shadow-2xl">
      <header className="flex items-center justify-between gap-2 border-b border-border bg-surface-muted px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {element ? (
            <>
              <Badge tone="neutral" dot={ELEMENT_TYPE_COLOR[element.type]}>
                {t(`studio.type.${element.type}`)}
              </Badge>
              <span className="truncate text-sm font-semibold text-text">
                {element.name}
              </span>
            </>
          ) : (
            <span className="text-sm text-text-muted">{tc('loading')}</span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          title={tc('close')}
          className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {error ? (
          <p className="text-sm text-danger">
            {error instanceof ApiError ? error.friendlyMessage : tc('error')}
          </p>
        ) : !element ? (
          <div className="flex justify-center py-8">
            <InlineLoader label={tc('loading')} />
          </div>
        ) : (
          <>
            {/* ── Reposicionamento ativo ─────────────────────────────────── */}
            {repositionActive && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-warning-muted px-2.5 py-2 text-xs text-warning">
                <span>{t('studio.drawer.repositionHint')}</span>
                <Button size="xs" variant="ghost" onClick={onCancelReposition}>
                  {tc('cancel')}
                </Button>
              </div>
            )}

            {/* ── Dados / Edição ─────────────────────────────────────────── */}
            {editing && form ? (
              <form onSubmit={handleSave} className="space-y-3">
                <div>
                  <Label required>{tc('name')}</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    autoFocus
                  />
                </div>
                <div>
                  <Label required>{t('studio.form.folder')}</Label>
                  <Select
                    value={form.folderId}
                    onChange={(e) => setForm({ ...form, folderId: e.target.value })}
                  >
                    {flatFolders.map(({ folder, depth }) => (
                      <option key={folder.id} value={folder.id}>
                        {`${'— '.repeat(depth)}${folder.name}`}
                      </option>
                    ))}
                  </Select>
                </div>
                {productType && (
                  <div>
                    <Label required>{t('studio.form.product')}</Label>
                    <Combobox
                      value={form.productId}
                      selectedOption={productOption}
                      onChange={(value, option) => {
                        setForm({ ...form, productId: value });
                        setProductOption(option);
                      }}
                      loadOptions={loadProductOptions}
                      placeholder={t('studio.form.productPlaceholder')}
                      resetKey={element.id}
                    />
                  </div>
                )}
                <div>
                  <Label required>{t('studio.form.coords')}</Label>
                  <Input
                    value={form.coords}
                    onChange={(e) => setForm({ ...form, coords: e.target.value })}
                  />
                  <FieldHelp>{t('studio.form.coordsHelp')}</FieldHelp>
                </div>
                <div>
                  <Label>{t('studio.form.address')}</Label>
                  <Input
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                  />
                </div>
                <div>
                  <Label>{t('studio.form.description')}</Label>
                  <Textarea
                    rows={2}
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                  />
                </div>
                <FieldError>{formError}</FieldError>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(false)}
                    disabled={saving}
                  >
                    {tc('cancel')}
                  </Button>
                  <Button type="submit" size="sm" loading={saving}>
                    {tc('save')}
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <section className="rounded-md border border-border bg-surface-muted p-3">
                  <dl className="space-y-1.5 text-xs">
                    <Row label={t('studio.drawer.folder')} value={folderName} />
                    {element.product && (
                      <Row
                        label={t('studio.drawer.product')}
                        value={
                          element.product.manufacturer
                            ? `${element.product.name} · ${element.product.manufacturer}`
                            : element.product.name
                        }
                      />
                    )}
                    <Row
                      label={t('studio.drawer.coords')}
                      value={
                        <span className="font-mono">
                          {element.latitude.toFixed(6)},{' '}
                          {element.longitude.toFixed(6)}
                        </span>
                      }
                    />
                    {element.address && (
                      <Row
                        label={t('studio.drawer.address')}
                        value={element.address}
                      />
                    )}
                    {element.description && (
                      <Row
                        label={t('studio.drawer.description')}
                        value={element.description}
                      />
                    )}
                    <Row
                      label={tc('createdAt')}
                      value={new Date(element.createdAt).toLocaleString()}
                    />
                  </dl>
                </section>

                {(canWrite || canDelete) && !repositionActive && (
                  <div className="flex flex-wrap gap-1.5">
                    {canWrite && (
                      <Button size="sm" variant="outline" onClick={startEdit}>
                        <Pencil className="h-3.5 w-3.5" />
                        {t('studio.drawer.edit')}
                      </Button>
                    )}
                    {canWrite && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={onStartReposition}
                      >
                        <Move className="h-3.5 w-3.5" />
                        {t('studio.drawer.reposition')}
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() =>
                          onRequestDelete({ id: element.id, name: element.name })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t('studio.drawer.delete')}
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ── Fotos ──────────────────────────────────────────────────── */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-2xs font-semibold uppercase tracking-wider text-text-subtle">
                  {t('studio.photos.title')} ({element.photos.length})
                </h4>
                {canWrite && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => void handleUpload(e)}
                    />
                    <Button
                      size="xs"
                      variant="outline"
                      loading={uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="h-3 w-3" />
                      {t('studio.photos.upload')}
                    </Button>
                  </>
                )}
              </div>
              {element.photos.length === 0 ? (
                <p className="text-xs text-text-subtle">
                  {t('studio.photos.empty')}
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {element.photos.map((photo) => (
                    <div key={photo.id} className="group relative">
                      <button
                        type="button"
                        title={photo.fileName ?? undefined}
                        onClick={() => void openPhoto(photo)}
                        className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-md border border-border bg-surface-muted text-text-subtle hover:bg-surface-hover hover:text-text"
                      >
                        {photoLoadingId === photo.id ? (
                          <Spinner className="h-4 w-4" />
                        ) : (
                          <ImageIcon className="h-5 w-5" />
                        )}
                        <span className="max-w-full truncate px-1 text-2xs">
                          {photo.fileName ?? '—'}
                        </span>
                      </button>
                      {canWrite && (
                        <button
                          type="button"
                          title={tc('delete')}
                          onClick={() => setPhotoDeleting(photo)}
                          className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-danger text-danger-foreground shadow group-hover:flex"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* ── Lightbox (URL presignada resolvida sob demanda) ─────────────── */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[2100] flex items-center justify-center bg-slate-950/80 p-6"
          onClick={() => setLightbox(null)}
        >
          <div
            className="flex max-h-full max-w-4xl flex-col items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {/* <img> puro: URL presignada dinâmica do MinIO — next/image exigiria remotePatterns do storage */}
            <img
              src={lightbox.url}
              alt={lightbox.photo.fileName ?? ''}
              className="max-h-[80vh] max-w-full rounded-md object-contain"
            />
            <div className="flex items-center gap-3 text-xs text-slate-200">
              <span className="max-w-md truncate">
                {lightbox.photo.caption ?? lightbox.photo.fileName ?? ''}
              </span>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                className="rounded-md border border-slate-500 px-2 py-1 hover:bg-slate-800"
              >
                {tc('close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirmação de exclusão de foto ─────────────────────────────── */}
      {photoDeleting && (
        <StudioConfirm
          title={t('studio.photos.deleteTitle')}
          message={t('studio.photos.deleteMessage', {
            name: photoDeleting.fileName ?? '—',
          })}
          confirmLabel={tc('delete')}
          danger
          loading={photoDeleteBusy}
          onClose={() => {
            if (!photoDeleteBusy) setPhotoDeleting(null);
          }}
          onConfirm={confirmDeletePhoto}
        />
      )}
    </aside>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-text-subtle">{label}</dt>
      <dd className="min-w-0 text-right text-text">{value}</dd>
    </div>
  );
}

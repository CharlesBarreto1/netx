'use client';

/**
 * ElementCreateModal — criação de elemento após o clique no mapa (FM-1).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Regras (FIBERMAP-SPEC §7/§14):
 *   - Coordenadas pré-preenchidas pelo clique, editáveis num campo único
 *     que aceita colar "lat, lng" (§14.7).
 *   - Pasta obrigatória (elemento sempre vive numa pasta).
 *   - Produto do catálogo obrigatório pra CEO/CTO/CABINET (§3.3) —
 *     Combobox com busca server-side em /catalog/products.
 */
import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

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
import { ApiError } from '@/lib/api';
import {
  fibermapApi,
  type FibermapElement,
  type FibermapElementType,
  type FibermapFolder,
} from '@/lib/fibermap-api';

import {
  buildFolderTree,
  flattenFolderTree,
  parseLatLng,
  PRODUCT_TYPE_BY_ELEMENT,
} from './constants';
import { StudioModal } from './StudioModal';

export interface ElementDraft {
  type: FibermapElementType;
  latitude: number;
  longitude: number;
}

interface ElementCreateModalProps {
  draft: ElementDraft;
  folders: FibermapFolder[];
  /** Pré-seleção da pasta (ex.: filtro ativo no painel). */
  defaultFolderId?: string | null;
  onClose: () => void;
  onCreated: (element: FibermapElement) => void;
}

export function ElementCreateModal({
  draft,
  folders,
  defaultFolderId,
  onClose,
  onCreated,
}: ElementCreateModalProps) {
  const t = useTranslations('fibermap');
  const tc = useTranslations('common');

  const flat = flattenFolderTree(buildFolderTree(folders));
  const productType = PRODUCT_TYPE_BY_ELEMENT[draft.type];
  const typeLabel = t(`studio.type.${draft.type}`);

  const [name, setName] = useState('');
  const [folderId, setFolderId] = useState(
    defaultFolderId && folders.some((f) => f.id === defaultFolderId)
      ? defaultFolderId
      : flat[0]?.folder.id ?? '',
  );
  const [coords, setCoords] = useState(
    `${draft.latitude.toFixed(6)}, ${draft.longitude.toFixed(6)}`,
  );
  const [productId, setProductId] = useState('');
  const [productOption, setProductOption] = useState<ComboboxOption | null>(null);
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const coordsValid = parseLatLng(coords) !== null;

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseLatLng(coords);
    if (!name.trim()) return setError(t('studio.form.errorNameRequired'));
    if (!folderId) return setError(t('studio.form.errorFolderRequired'));
    if (!parsed) return setError(t('studio.form.errorCoords'));
    if (productType && !productId) {
      return setError(t('studio.form.errorProductRequired'));
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await fibermapApi.createElement({
        folderId,
        type: draft.type,
        name: name.trim(),
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        productId: productId || undefined,
        address: address.trim() || undefined,
        description: description.trim() || undefined,
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <StudioModal
      title={t('studio.form.createTitle', { type: typeLabel })}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {tc('cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            loading={submitting}
            disabled={folders.length === 0}
          >
            {tc('create')}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        {folders.length === 0 && (
          <p className="rounded-md bg-warning-muted px-3 py-2 text-xs text-warning">
            {t('studio.form.noFolders')}
          </p>
        )}
        <div>
          <Label required>{tc('name')}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('studio.form.namePlaceholder', { type: typeLabel })}
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label required>{t('studio.form.folder')}</Label>
            <Select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              {flat.map(({ folder, depth }) => (
                <option key={folder.id} value={folder.id}>
                  {`${'— '.repeat(depth)}${folder.name}`}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label required>{t('studio.form.coords')}</Label>
            <Input
              value={coords}
              onChange={(e) => setCoords(e.target.value)}
              placeholder="-24.052000, -52.370000"
              className={coordsValid ? undefined : 'border-red-500'}
            />
            <FieldHelp>{t('studio.form.coordsHelp')}</FieldHelp>
          </div>
        </div>
        {productType && (
          <div>
            <Label required>{t('studio.form.product')}</Label>
            <Combobox
              value={productId}
              selectedOption={productOption}
              onChange={(value, option) => {
                setProductId(value);
                setProductOption(option);
              }}
              loadOptions={loadProductOptions}
              placeholder={t('studio.form.productPlaceholder')}
              resetKey={productType}
            />
          </div>
        )}
        <div>
          <Label>{t('studio.form.address')}</Label>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div>
          <Label>{t('studio.form.description')}</Label>
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <FieldError>{error}</FieldError>
      </form>
    </StudioModal>
  );
}

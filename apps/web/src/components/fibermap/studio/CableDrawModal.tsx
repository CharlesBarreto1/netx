'use client';

/**
 * CableDrawModal — fecha o trecho desenhado num cabo (FM-2, spec §7).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Dois caminhos (padrão Tomodat):
 *   - CABO NOVO: escolhe o modelo do catálogo (estrutura no rótulo), nome,
 *     pasta e cor → POST /cables (tubos+fibras automáticos) + POST /segments.
 *   - CONTINUAR CABO: lista os cabos cuja ponta final é o elemento de origem
 *     do desenho (ou ainda sem trechos) → só POST /segments (o backend valida
 *     a contiguidade — spec §14.4).
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  fibermapApi,
  type FibermapCable,
  type FibermapCableStub,
  type FibermapFolder,
  type FibermapProduct,
  type Paginated,
} from '@/lib/fibermap-api';

import { buildFolderTree, flattenFolderTree } from './constants';
import type { FibermapDrawResult } from './FibermapMap';
import { StudioModal } from './StudioModal';

const FIELD =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent';

export function CableDrawModal({
  draw,
  folders,
  defaultFolderId,
  onClose,
  onCreated,
}: {
  draw: FibermapDrawResult;
  folders: FibermapFolder[];
  defaultFolderId: string | null;
  onClose: () => void;
  onCreated: (cable: FibermapCable) => void;
}) {
  const t = useTranslations('fibermap');
  const tc = useTranslations('common');

  // Cabos que podem continuar a partir da origem do desenho.
  const { data: stubs } = useSWR<FibermapCableStub[]>(
    `/v1/fibermap/cables/ending-at/${draw.fromElement.id}`,
  );
  // Modelos de cabo do catálogo (ativos).
  const { data: productsPage } = useSWR<Paginated<FibermapProduct>>(
    '/v1/fibermap/catalog/products?type=CABLE&active=true&pageSize=200',
  );
  const models = useMemo(
    () => (productsPage?.data ?? []).filter((p) => p.cableModel),
    [productsPage],
  );

  const [tab, setTab] = useState<'new' | 'continue'>('new');
  const [name, setName] = useState('');
  const [folderId, setFolderId] = useState<string>(
    defaultFolderId ?? folders[0]?.id ?? '',
  );
  const [productId, setProductId] = useState('');
  const [displayColor, setDisplayColor] = useState('');
  const [continueId, setContinueId] = useState('');
  const [measured, setMeasured] = useState('');
  const [busy, setBusy] = useState(false);

  const folderOptions = useMemo(
    () => flattenFolderTree(buildFolderTree(folders)),
    [folders],
  );

  async function submit() {
    const measuredLengthM = measured.trim()
      ? Number(measured.trim().replace(',', '.'))
      : null;
    if (measuredLengthM !== null && !(measuredLengthM > 0)) {
      toast.error(t('studio.cable.errorMeasured'));
      return;
    }
    setBusy(true);
    try {
      let cableId: string;
      if (tab === 'new') {
        if (!name.trim()) {
          toast.error(t('studio.form.errorNameRequired'));
          return;
        }
        if (!folderId) {
          toast.error(t('studio.form.errorFolderRequired'));
          return;
        }
        if (!productId) {
          toast.error(t('studio.cable.errorModelRequired'));
          return;
        }
        const cable = await fibermapApi.createCable({
          folderId,
          name: name.trim(),
          productId,
          displayColor: displayColor || undefined,
        });
        cableId = cable.id;
      } else {
        if (!continueId) {
          toast.error(t('studio.cable.errorContinueRequired'));
          return;
        }
        cableId = continueId;
      }
      const cable = await fibermapApi.addSegment(cableId, {
        fromElementId: draw.fromElement.id,
        toElementId: draw.toElement.id,
        path: draw.path,
        measuredLengthM,
      });
      onCreated(cable);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  const tabBtn = (active: boolean) =>
    `flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${
      active
        ? 'bg-accent text-white'
        : 'bg-surface-muted text-text-muted hover:bg-surface-hover'
    }`;

  return (
    <StudioModal
      title={t('studio.cable.drawTitle', {
        from: draw.fromElement.name,
        to: draw.toElement.name,
      })}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {tc('cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          <button type="button" className={tabBtn(tab === 'new')} onClick={() => setTab('new')}>
            {t('studio.cable.tabNew')}
          </button>
          <button
            type="button"
            className={tabBtn(tab === 'continue')}
            onClick={() => setTab('continue')}
            disabled={(stubs ?? []).length === 0}
          >
            {t('studio.cable.tabContinue', { count: (stubs ?? []).length })}
          </button>
        </div>

        {tab === 'new' ? (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-text">{t('studio.cable.model')}</span>
              <select
                className={FIELD}
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
              >
                <option value="">{t('studio.form.productPlaceholder')}</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} — {m.cableModel!.tubeCount}×{m.cableModel!.fibersPerTube}{' '}
                    ({m.cableModel!.fiberCount} FO)
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-text">{tc('name')}</span>
              <input
                className={FIELD}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('studio.cable.namePlaceholder')}
                autoFocus
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-text">{t('studio.form.folder')}</span>
              <select
                className={FIELD}
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
              >
                {folderOptions.map(({ folder, depth }) => (
                  <option key={folder.id} value={folder.id}>
                    {' '.repeat(depth * 3)}
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-3 text-sm">
              <span className="font-medium text-text">{t('studio.cable.color')}</span>
              <input
                type="color"
                className="h-8 w-14 cursor-pointer rounded border border-border bg-surface"
                value={displayColor || '#3b82f6'}
                onChange={(e) => setDisplayColor(e.target.value)}
              />
              <span className="text-xs text-text-subtle">
                {t('studio.cable.colorHelp')}
              </span>
            </label>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            {(stubs ?? []).map((s) => (
              <label
                key={s.id}
                className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm ${
                  continueId === s.id
                    ? 'border-accent bg-accent/5'
                    : 'border-border hover:bg-surface-hover'
                }`}
              >
                <input
                  type="radio"
                  name="continue-cable"
                  checked={continueId === s.id}
                  onChange={() => setContinueId(s.id)}
                />
                <span
                  className="inline-block h-2.5 w-6 rounded-sm"
                  style={{ backgroundColor: s.displayColor ?? '#64748b' }}
                />
                <span className="flex-1 truncate font-medium text-text">{s.name}</span>
                <span className="text-xs text-text-muted">
                  {s.fiberCount} FO · {t('studio.cable.segmentsCount', { count: s.segmentsCount })}
                </span>
              </label>
            ))}
          </div>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text">{t('studio.cable.measured')}</span>
          <input
            className={FIELD}
            value={measured}
            onChange={(e) => setMeasured(e.target.value)}
            placeholder={t('studio.cable.measuredPlaceholder')}
            inputMode="decimal"
          />
          <span className="text-xs text-text-subtle">{t('studio.cable.measuredHelp')}</span>
        </label>
      </div>
    </StudioModal>
  );
}

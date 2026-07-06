'use client';

/**
 * KmlImportModal — importação de KML/KMZ (FM-7, spec §12).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Objetivo prático: migrar a base exportada do Tomodat. Dois passos:
 *   1. arquivo + pasta destino → preview (o que SERIA criado: tipos
 *      inferidos, colisões de nome, resolução das pontas dos cabos);
 *   2. confirmar → cria por item e mostra o relatório final
 *      (criados / postes automáticos / pulados com motivo).
 */
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  fibermapApi,
  type FibermapFolder,
  type FibermapKmlImportPreview,
  type FibermapKmlImportResult,
} from '@/lib/fibermap-api';

import { StudioModal } from '../studio/StudioModal';

const LIST_CAP = 60;

export function KmlImportModal({
  folders,
  defaultFolderId,
  onClose,
  onImported,
}: {
  folders: FibermapFolder[];
  defaultFolderId: string | null;
  onClose: () => void;
  onImported: () => void;
}) {
  const t = useTranslations('fibermap');
  const tc = useTranslations('common');

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [folderId, setFolderId] = useState(defaultFolderId ?? folders[0]?.id ?? '');
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<FibermapKmlImportPreview | null>(null);
  const [result, setResult] = useState<FibermapKmlImportResult | null>(null);

  async function analyze() {
    const file = fileRef.current?.files?.[0];
    if (!file || !folderId) {
      toast.error(t('kml.invalid'));
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      setPreview(await fibermapApi.kmlImportPreview(folderId, file));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await fibermapApi.kmlImportConfirm({
        folderId: preview.folderId,
        elements: preview.elements
          .filter((e) => e.status === 'CREATE')
          .map((e) => ({
            name: e.name,
            type: e.type,
            latitude: e.latitude,
            longitude: e.longitude,
            description: e.description,
          })),
        cables: preview.cables
          .filter((c) => c.status === 'CREATE')
          .map((c) => ({ name: c.name, path: c.path, description: c.description })),
      });
      setResult(r);
      onImported();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent';
  const labelCls = 'flex flex-col gap-1 text-sm font-medium text-text';

  const createElements = preview?.elements.filter((e) => e.status === 'CREATE') ?? [];
  const skipElements = preview?.elements.filter((e) => e.status === 'SKIP') ?? [];
  const createCables = preview?.cables.filter((c) => c.status === 'CREATE') ?? [];
  const skipCables = preview?.cables.filter((c) => c.status === 'SKIP') ?? [];

  return (
    <StudioModal
      title={t('kml.title')}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {tc('close')}
          </Button>
          {!result && (
            <Button variant="outline" onClick={() => void analyze()} loading={busy && !preview}>
              {t('kml.analyze')}
            </Button>
          )}
          {preview && !result && (
            <Button
              onClick={() => void confirm()}
              loading={busy}
              disabled={createElements.length + createCables.length === 0}
            >
              {t('kml.confirm', { count: createElements.length + createCables.length })}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <label className={labelCls}>
            {t('kml.folder')}
            <select
              className={inputCls}
              value={folderId}
              onChange={(e) => {
                setFolderId(e.target.value);
                setPreview(null);
                setResult(null);
              }}
            >
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            {t('kml.file')}
            <input
              ref={fileRef}
              type="file"
              accept=".kml,.kmz"
              className="w-full text-sm text-text file:mr-2 file:rounded-md file:border file:border-border file:bg-surface file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-text hover:file:bg-surface-hover"
              onChange={(e) => {
                setFileName(e.target.files?.[0]?.name ?? null);
                setPreview(null);
                setResult(null);
              }}
            />
          </label>
        </div>

        {/* ── Preview ─────────────────────────────────────────────────────── */}
        {preview && !result && (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-muted/50 p-3 text-xs text-text">
            <p className="font-medium">
              {t('kml.summary', {
                file: fileName ?? 'KML',
                elements: createElements.length,
                cables: createCables.length,
                skipped: skipElements.length + skipCables.length,
              })}
            </p>
            {preview.warnings.length > 0 && (
              <ul className="list-inside list-disc text-amber-600">
                {preview.warnings.slice(0, 10).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {preview.warnings.length > 10 && (
                  <li>+{preview.warnings.length - 10}…</li>
                )}
              </ul>
            )}
            {preview.elements.length > 0 && (
              <div className="max-h-40 overflow-y-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="text-text-muted">
                    <tr>
                      <th className="py-0.5 pr-2 font-medium">{t('kml.colElement')}</th>
                      <th className="py-0.5 pr-2 font-medium">{t('kml.colType')}</th>
                      <th className="py-0.5 font-medium">{t('kml.colStatus')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.elements.slice(0, LIST_CAP).map((e, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="py-0.5 pr-2">{e.name}</td>
                        <td className="py-0.5 pr-2">{e.type}</td>
                        <td className="py-0.5">
                          {e.status === 'CREATE' ? (
                            <span className="text-emerald-600">{t('kml.create')}</span>
                          ) : (
                            <span className="text-amber-600">{e.reason}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.elements.length > LIST_CAP && (
                  <p className="pt-1 text-text-muted">
                    +{preview.elements.length - LIST_CAP}…
                  </p>
                )}
              </div>
            )}
            {preview.cables.length > 0 && (
              <div className="max-h-40 overflow-y-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="text-text-muted">
                    <tr>
                      <th className="py-0.5 pr-2 font-medium">{t('kml.colCable')}</th>
                      <th className="py-0.5 pr-2 font-medium">{t('kml.colLength')}</th>
                      <th className="py-0.5 pr-2 font-medium">{t('kml.colEndpoints')}</th>
                      <th className="py-0.5 font-medium">{t('kml.colStatus')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.cables.slice(0, LIST_CAP).map((c, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="py-0.5 pr-2">{c.name}</td>
                        <td className="py-0.5 pr-2 font-mono">
                          {Math.round(c.lengthMeters)} m
                        </td>
                        <td className="py-0.5 pr-2">
                          {c.fromElementName ?? t('kml.newPole')} →{' '}
                          {c.toElementName ?? t('kml.newPole')}
                        </td>
                        <td className="py-0.5">
                          {c.status === 'CREATE' ? (
                            <span className="text-emerald-600">{t('kml.create')}</span>
                          ) : (
                            <span className="text-amber-600">{c.reason}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.cables.length > LIST_CAP && (
                  <p className="pt-1 text-text-muted">
                    +{preview.cables.length - LIST_CAP}…
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Relatório final ─────────────────────────────────────────────── */}
        {result && (
          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-muted/50 p-3 text-xs text-text">
            <p className="font-medium">
              {t('kml.result', {
                elements: result.elementsCreated,
                poles: result.polesCreated,
                cables: result.cablesCreated,
              })}
            </p>
            {result.skipped.length > 0 && (
              <ul className="list-inside list-disc text-amber-600">
                {result.skipped.slice(0, 15).map((s, i) => (
                  <li key={i}>
                    {s.item}: {s.reason}
                  </li>
                ))}
                {result.skipped.length > 15 && <li>+{result.skipped.length - 15}…</li>}
              </ul>
            )}
          </div>
        )}
      </div>
    </StudioModal>
  );
}

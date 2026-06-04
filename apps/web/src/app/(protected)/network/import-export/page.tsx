'use client';

/**
 * /network/import-export — import KML/KMZ + export KML (R4.5d OSP).
 *
 * Fluxo:
 *   1. Operador escolhe arquivo .kml ou .kmz → upload.
 *   2. Backend parseia + retorna preview (X caixas, Y cabos, warnings).
 *   3. Operador escolhe defaults (tipo da caixa, capacity, tipo do cabo,
 *      fiberCount) → confirma.
 *   4. Backend cria em transação. UI mostra resultado.
 *
 * Export: 1 clique, download direto. Abre em Google Earth/QGIS.
 */
import { Download, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { FieldHelp, Label, Select } from '@/components/ui/Input';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  kmlApi,
  type KmlImportPreview,
  type KmlImportResult,
} from '@/lib/kml-api';
import type { FiberCableType } from '@/lib/fiber-api';
import type { OpticalEnclosureType } from '@/lib/optical-api';
import { hasPermission } from '@/lib/session';

export default function KmlImportExportPage() {
  const t = useTranslations('network.importExport');
  const canWrite = hasPermission('network.write');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<KmlImportPreview | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [result, setResult] = useState<KmlImportResult | null>(null);

  async function handleUndo() {
    if (!result?.importBatchId) return;
    if (!confirm(t('undoConfirm'))) return;
    setUndoing(true);
    try {
      await kmlApi.undo(result.importBatchId);
      toast.success(t('undoneToast'));
      setResult(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
    } finally {
      setUndoing(false);
    }
  }

  // Defaults aplicados a TODO o import — operador edita caso-a-caso depois.
  const [enclosureType, setEnclosureType] = useState<OpticalEnclosureType>('CTO');
  const [enclosureCapacity, setEnclosureCapacity] = useState(16);
  const [cableType, setCableType] = useState<FiberCableType>('DISTRIBUTION');
  const [cableFiberCount, setCableFiberCount] = useState(12);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setPreview(null);
    setResult(null);
    try {
      const data = await kmlApi.preview(file);
      setPreview(data);
      if (data.warnings.length > 0) {
        toast.warning(t('toastPreviewWarnings', { count: data.warnings.length }));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errorParse'));
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setImporting(true);
    try {
      const r = await kmlApi.confirm({
        preview,
        defaults: {
          enclosureType,
          enclosureCapacity,
          cableType,
          cableFiberCount,
        },
      });
      setResult(r);
      setPreview(null);
      if (r.errors.length > 0) {
        toast.warning(
          t('toastImportedWithErrors', {
            items: r.enclosuresCreated + r.cablesCreated,
            errors: r.errors.length,
          }),
        );
      } else {
        toast.success(
          t('toastImportedSuccess', {
            enclosures: r.enclosuresCreated,
            cables: r.cablesCreated,
          }),
        );
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : t('errorImport'));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-text-muted">{t('subtitle')}</p>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        {/* ─── Import ──────────────────────────────────────────────────────── */}
        <section className="space-y-3 rounded-md border border-border bg-surface p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Upload className="h-4 w-4" />
            {t('importTitle')}
          </h2>
          <p className="text-xs text-text-muted">{t('importDescription')}</p>

          {/* Form de defaults */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="imp-encl-type">{t('enclosureType')}</Label>
              <Select
                id="imp-encl-type"
                value={enclosureType}
                onChange={(e) =>
                  setEnclosureType(e.target.value as OpticalEnclosureType)
                }
                disabled={!canWrite}
              >
                <option value="CTO">CTO</option>
                <option value="NAP">NAP</option>
                <option value="SPLITTER">Splitter</option>
                <option value="EMENDA">{t('enclosureTypeSplice')}</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="imp-encl-cap">{t('capacity')}</Label>
              <Select
                id="imp-encl-cap"
                value={String(enclosureCapacity)}
                onChange={(e) => setEnclosureCapacity(Number(e.target.value))}
                disabled={!canWrite}
              >
                {[8, 16, 32, 64].map((n) => (
                  <option key={n} value={n}>
                    {t('ports', { count: n })}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="imp-cab-type">{t('cableType')}</Label>
              <Select
                id="imp-cab-type"
                value={cableType}
                onChange={(e) =>
                  setCableType(e.target.value as FiberCableType)
                }
                disabled={!canWrite}
              >
                <option value="BACKBONE">Backbone</option>
                <option value="DISTRIBUTION">{t('cableTypeDistribution')}</option>
                <option value="DROP">Drop</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="imp-cab-fiber">{t('fibers')}</Label>
              <Select
                id="imp-cab-fiber"
                value={String(cableFiberCount)}
                onChange={(e) => setCableFiberCount(Number(e.target.value))}
                disabled={!canWrite}
              >
                {[2, 6, 12, 24, 48, 96, 144, 288].map((n) => (
                  <option key={n} value={n}>
                    {t('fibersCount', { count: n })}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="pt-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
              onChange={handleFileChange}
              disabled={!canWrite || parsing}
              className="block w-full text-sm text-text-muted file:mr-3 file:rounded-md file:border-0 file:bg-brand-500 file:px-3 file:py-1.5 file:text-white hover:file:bg-brand-600 file:cursor-pointer file:font-medium"
            />
            <FieldHelp>{t('fileHelp')}</FieldHelp>
          </div>

          {parsing && (
            <div className="text-sm text-text-muted">{t('parsing')}</div>
          )}

          {/* Preview do que será criado */}
          {preview && (
            <div className="space-y-3 rounded-md border border-border bg-surface-muted p-3">
              <div className="flex items-center gap-2">
                <Badge tone="info">
                  {t('enclosuresCount', { count: preview.enclosures.length })}
                </Badge>
                <Badge tone="brand">
                  {t('cablesCount', { count: preview.cables.length })}
                </Badge>
                {preview.warnings.length > 0 && (
                  <Badge tone="warning">
                    {t('warningsCount', { count: preview.warnings.length })}
                  </Badge>
                )}
              </div>

              {preview.warnings.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-text-muted">
                    {t('viewWarnings')}
                  </summary>
                  <ul className="mt-1 space-y-0.5 ml-4 list-disc text-text-muted">
                    {preview.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}

              {preview.enclosures.length > 0 && (
                <details className="text-xs" open>
                  <summary className="cursor-pointer font-semibold">
                    {t('enclosuresSection', { count: preview.enclosures.length })}
                  </summary>
                  <div className="mt-1 max-h-32 overflow-y-auto">
                    <table className="w-full">
                      <tbody>
                        {preview.enclosures.slice(0, 100).map((e, i) => (
                          <tr key={i}>
                            <td className="py-0.5 font-mono">{e.name}</td>
                            <td className="py-0.5 text-text-muted">
                              {e.latitude.toFixed(4)}, {e.longitude.toFixed(4)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {preview.enclosures.length > 100 && (
                      <p className="mt-1 text-text-muted">
                        {t('moreItems', { count: preview.enclosures.length - 100 })}
                      </p>
                    )}
                  </div>
                </details>
              )}

              {preview.cables.length > 0 && (
                <details className="text-xs" open>
                  <summary className="cursor-pointer font-semibold">
                    {t('cablesSection', { count: preview.cables.length })}
                  </summary>
                  <div className="mt-1 max-h-32 overflow-y-auto">
                    <table className="w-full">
                      <tbody>
                        {preview.cables.slice(0, 100).map((c, i) => (
                          <tr key={i}>
                            <td className="py-0.5 font-mono">{c.name}</td>
                            <td className="py-0.5 text-text-muted">
                              {t('pointsAbbr', { count: c.path.length })} ·{' '}
                              {formatLength(c.lengthMeters)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              <Button
                onClick={handleConfirm}
                loading={importing}
                disabled={
                  preview.enclosures.length === 0 &&
                  preview.cables.length === 0
                }
                className="w-full"
              >
                {t('confirmImport')}
              </Button>
            </div>
          )}

          {/* Resultado pós-confirm */}
          {result && (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/40">
              <div className="font-semibold text-emerald-800 dark:text-emerald-200">
                {t('importDone')}
              </div>
              <div className="mt-1 text-emerald-700 dark:text-emerald-300">
                {t('importDoneDetail', {
                  enclosures: result.enclosuresCreated,
                  cables: result.cablesCreated,
                })}
              </div>
              {result.errors.length > 0 && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-red-700 dark:text-red-300">
                    {t('errorsCount', { count: result.errors.length })}
                  </summary>
                  <ul className="mt-1 list-disc ml-4">
                    {result.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </details>
              )}
              {result.importBatchId && (
                <div className="mt-3">
                  <Button variant="outline" size="sm" loading={undoing} onClick={handleUndo}>
                    {t('undoImport')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ─── Export ──────────────────────────────────────────────────────── */}
        <section className="space-y-3 rounded-md border border-border bg-surface p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Download className="h-4 w-4" />
            {t('exportTitle')}
          </h2>
          <p className="text-xs text-text-muted">{t('exportDescription')}</p>

          <ul className="list-disc pl-4 text-xs text-text-muted space-y-1">
            <li>{t('exportFeatureStyles')}</li>
            <li>{t('exportFeatureNotes')}</li>
            <li>{t('exportFeatureCoords')}</li>
          </ul>

          <a
            href={kmlApi.exportUrl()}
            download="netx-planta.kml"
            className="inline-flex items-center gap-2 rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            <Download className="h-4 w-4" />
            {t('downloadKml')}
          </a>

          <FieldHelp>{t('exportHelp')}</FieldHelp>
        </section>
      </div>
    </div>
  );
}

function formatLength(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${meters.toFixed(0)} m`;
}

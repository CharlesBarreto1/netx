'use client';

/**
 * OtdrModal — ferramenta OTDR (FM-5, spec §9).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Acionável do estúdio (popup do elemento) e do access-point (header):
 * seleciona cabo/fibra do elemento de referência, a direção (vizinho na rota
 * do cabo), a distância medida e o λ → POST /otdr/locate. O resultado mostra
 * candidatos (com incerteza), elementos próximos e a tabela expected_events
 * (distância teórica × curva). "Ver no mapa" entrega o overlay pro chamador
 * (o estúdio aplica direto; o access-point persiste e navega).
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { InlineLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  fibermapApi,
  type FibermapAccessPoint,
  type FibermapCable,
  type FibermapOtdrLocateResponse,
} from '@/lib/fibermap-api';

import type { FibermapOtdrOverlay } from '../studio/FibermapMap';
import { StudioModal } from '../studio/StudioModal';

const fmtM = (v: number) => `${v.toFixed(2)} m`;

export interface OtdrModalProps {
  elementId: string;
  onClose: () => void;
  /** Aplica o overlay no mapa (estúdio) ou persiste+navega (access-point). */
  onShowOnMap: (overlay: FibermapOtdrOverlay) => void;
}

export function OtdrModal({ elementId, onClose, onShowOnMap }: OtdrModalProps) {
  const t = useTranslations('fibermap');
  const tc = useTranslations('common');

  // Cabos que tocam o elemento (mesmo payload do editor de emendas).
  const { data: ap } = useSWR<FibermapAccessPoint>(
    `/v1/fibermap/elements/${elementId}/access-point`,
  );

  const [cableId, setCableId] = useState('');
  const [fiberNumber, setFiberNumber] = useState('1');
  const [directionId, setDirectionId] = useState('');
  const [distance, setDistance] = useState('');
  const [wavelength, setWavelength] = useState<1310 | 1490 | 1550>(1550);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FibermapOtdrLocateResponse | null>(null);

  const cable = ap?.cables.find((c) => c.id === cableId) ?? null;

  // Vizinhos do elemento na rota do cabo selecionado (direção da medição).
  const { data: cableDetail } = useSWR<FibermapCable>(
    cableId ? `/v1/fibermap/cables/${cableId}` : null,
  );
  const neighbors = useMemo(() => {
    if (!cableDetail) return [];
    const chain: Array<{ id: string; name: string }> = [];
    cableDetail.segments.forEach((s, i) => {
      if (i === 0) chain.push({ id: s.fromElementId, name: s.fromElementName });
      chain.push({ id: s.toElementId, name: s.toElementName });
    });
    const out = new Map<string, string>();
    chain.forEach((el, i) => {
      if (el.id !== elementId) return;
      const prev = chain[i - 1];
      const next = chain[i + 1];
      if (prev && prev.id !== elementId) out.set(prev.id, prev.name);
      if (next && next.id !== elementId) out.set(next.id, next.name);
    });
    return [...out.entries()].map(([id, name]) => ({ id, name }));
  }, [cableDetail, elementId]);

  async function locate() {
    const dist = Number(distance.replace(',', '.'));
    const fiber = Number(fiberNumber);
    if (!cableId || !directionId || !(dist > 0) || !Number.isInteger(fiber) || fiber < 1) {
      toast.error(t('otdr.invalid'));
      return;
    }
    setBusy(true);
    try {
      const r = await fibermapApi.otdrLocate({
        referenceElementId: elementId,
        cableId,
        fiberNumber: fiber,
        directionElementId: directionId,
        distanceM: dist,
        wavelengthNm: wavelength,
      });
      setResult(r);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  function showOnMap() {
    if (!result || result.candidates.length === 0) return;
    onShowOnMap({
      label: t('otdr.overlayLabel', {
        cable: cable?.name ?? '',
        fiber: fiberNumber,
        distance: distance.replace(',', '.'),
      }),
      candidates: result.candidates.map((c) => ({
        latitude: c.latitude,
        longitude: c.longitude,
        uncertaintyRadiusM: c.uncertaintyRadiusM,
        kind: c.kind,
        branchLabel: c.branchLabel,
      })),
    });
  }

  async function copyCoords() {
    const p = result?.point;
    if (!p) return;
    try {
      await navigator.clipboard.writeText(`${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}`);
      toast.success(t('otdr.copied'));
    } catch {
      toast.error(tc('error'));
    }
  }

  const candidateLabel = (c: FibermapOtdrLocateResponse['candidates'][number]) => {
    if (c.kind === 'IN_SLACK') {
      return t('otdr.candInSlack', { name: c.elementName ?? '?' });
    }
    if (c.kind === 'BEYOND_END') {
      return t('otdr.candBeyond', { name: c.elementName ?? '?' });
    }
    return t('otdr.candOnSegment', {
      cable: c.cableName ?? '?',
      a: c.betweenElements?.[0] ?? '?',
      b: c.betweenElements?.[1] ?? '?',
      offset: fmtM(c.offsetM ?? 0),
    });
  };

  const inputCls =
    'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent';
  const labelCls = 'flex flex-col gap-1 text-sm font-medium text-text';

  return (
    <StudioModal
      title={t('otdr.title')}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {tc('close')}
          </Button>
          {result && result.candidates.length > 0 && (
            <Button variant="outline" onClick={showOnMap}>
              {t('otdr.viewOnMap')}
            </Button>
          )}
          <Button onClick={() => void locate()} loading={busy} disabled={!ap}>
            {t('otdr.locate')}
          </Button>
        </>
      }
    >
      {!ap ? (
        <div className="flex h-24 items-center justify-center">
          <InlineLoader label={tc('loading')} />
        </div>
      ) : ap.cables.length === 0 ? (
        <p className="text-sm text-text-muted">{t('otdr.noCables')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-text-muted">
            {t('otdr.reference', { name: ap.element.name })}
          </p>
          <label className={labelCls}>
            {t('otdr.cable')}
            <select
              className={inputCls}
              value={cableId}
              onChange={(e) => {
                setCableId(e.target.value);
                setDirectionId('');
                setResult(null);
              }}
            >
              <option value="">{t('otdr.pick')}</option>
              {ap.cables.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.fiberCount}FO
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelCls}>
              {t('otdr.fiber')}
              <input
                className={inputCls}
                inputMode="numeric"
                value={fiberNumber}
                onChange={(e) => setFiberNumber(e.target.value)}
                min={1}
                max={cable?.fiberCount ?? 144}
                type="number"
              />
            </label>
            <label className={labelCls}>
              {t('otdr.wavelength')}
              <select
                className={inputCls}
                value={wavelength}
                onChange={(e) => setWavelength(Number(e.target.value) as 1310 | 1490 | 1550)}
              >
                {[1310, 1490, 1550].map((w) => (
                  <option key={w} value={w}>
                    {w} nm
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className={labelCls}>
            {t('otdr.direction')}
            <select
              className={inputCls}
              value={directionId}
              onChange={(e) => setDirectionId(e.target.value)}
              disabled={!cableId}
            >
              <option value="">{t('otdr.pick')}</option>
              {neighbors.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            {t('otdr.distance')}
            <input
              className={inputCls}
              inputMode="decimal"
              placeholder="1868,47"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
            />
          </label>

          {/* ── Resultado ─────────────────────────────────────────────────── */}
          {result && (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-muted/50 p-3">
              {result.flags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {result.flags.map((f) => (
                    <span
                      key={f}
                      className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600"
                    >
                      {t(`otdr.flag.${f}`)}
                    </span>
                  ))}
                </div>
              )}
              {result.candidates.length === 0 ? (
                <p className="text-xs text-text-muted">{t('otdr.noCandidates')}</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {result.candidates.map((c, i) => (
                    <li key={i} className="text-xs text-text">
                      <span className="font-medium">
                        {c.branchLabel ? `[${c.branchLabel}] ` : ''}
                        {candidateLabel(c)}
                      </span>
                      <span className="text-text-muted">
                        {' '}
                        · ±{Math.round(c.uncertaintyRadiusM)} m ·{' '}
                        {c.latitude.toFixed(6)}, {c.longitude.toFixed(6)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {result.nearestElements.length > 0 && (
                <p className="text-xs text-text-muted">
                  {t('otdr.nearest')}:{' '}
                  {result.nearestElements
                    .map((n) => `${n.name} (${Math.round(n.distanceM)} m)`)
                    .join(' · ')}
                </p>
              )}
              {result.expectedEvents.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-text">
                    {t('otdr.expected')}
                  </p>
                  <table className="w-full text-left text-[11px] text-text">
                    <thead className="text-text-muted">
                      <tr>
                        <th className="py-0.5 pr-2 font-medium">{t('otdr.expectedType')}</th>
                        <th className="py-0.5 pr-2 font-medium">{t('otdr.expectedElement')}</th>
                        <th className="py-0.5 text-right font-medium">
                          {t('otdr.expectedDistance')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.expectedEvents.map((e, i) => (
                        <tr key={i} className="border-t border-border/60">
                          <td className="py-0.5 pr-2">
                            {t(`otdr.eventType.${e.type}`)}
                            {e.detail ? ` ${e.detail}` : ''}
                          </td>
                          <td className="py-0.5 pr-2">{e.elementName ?? '—'}</td>
                          <td className="py-0.5 text-right font-mono">
                            {fmtM(e.expectedOtdrM)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="xs" variant="outline" onClick={() => void copyCoords()}>
                  {t('otdr.copyCoords')}
                </Button>
                {result.point && (
                  <a
                    className="inline-flex h-7 items-center rounded-md border border-border px-2.5 text-xs font-medium text-text hover:bg-surface-hover"
                    href={`https://maps.google.com/?q=${result.point.latitude},${result.point.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('otdr.gmaps')}
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </StudioModal>
  );
}

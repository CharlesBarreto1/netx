'use client';

/**
 * PowerBudgetModal — orçamento de potência a partir de uma porta (FM-6, §5.4).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Acionável do header do access-point: escolhe device/porta do elemento
 * (OLTs primeiro — o budget é pensado pra PON), tx dBm e λ → tabela de
 * TERMINAIS (uma linha por ponta/assinante) com distância, perda total,
 * Rx esperado e nível OK/WARN/CRIT; esperado × medido quando existe
 * power_measurement na mesma λ.
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
  type FibermapPowerBudgetLevel,
  type FibermapPowerBudgetResponse,
  type FibermapPowerBudgetTerminal,
} from '@/lib/fibermap-api';

import { StudioModal } from '../studio/StudioModal';

const LEVEL_CLS: Record<FibermapPowerBudgetLevel, string> = {
  OK: 'bg-emerald-500/15 text-emerald-600',
  WARN: 'bg-amber-500/15 text-amber-600',
  CRIT: 'bg-red-500/15 text-red-600',
};

const fmtDbm = (v: number) => `${v.toFixed(2)} dBm`;

export function PowerBudgetModal({
  elementId,
  onClose,
}: {
  elementId: string;
  onClose: () => void;
}) {
  const t = useTranslations('fibermap');
  const tc = useTranslations('common');

  const { data: ap } = useSWR<FibermapAccessPoint>(
    `/v1/fibermap/elements/${elementId}/access-point`,
  );

  // OLTs primeiro (budget é PON-cêntrico), depois os demais com portas.
  const devices = useMemo(() => {
    const all = (ap?.devices ?? []).filter((d) => d.ports.length > 0);
    return [...all.filter((d) => d.type === 'OLT'), ...all.filter((d) => d.type !== 'OLT')];
  }, [ap]);

  const [deviceId, setDeviceId] = useState('');
  const [portId, setPortId] = useState('');
  const [txDbm, setTxDbm] = useState('4');
  const [wavelength, setWavelength] = useState<1310 | 1490 | 1550>(1490);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FibermapPowerBudgetResponse | null>(null);

  const device = devices.find((d) => d.id === deviceId) ?? null;

  async function calc() {
    const tx = Number(txDbm.replace(',', '.'));
    if (!portId || !Number.isFinite(tx)) {
      toast.error(t('budget.invalid'));
      return;
    }
    setBusy(true);
    try {
      setResult(await fibermapApi.powerBudget(portId, { wavelength, txDbm: tx }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  const terminalLabel = (term: FibermapPowerBudgetTerminal) => {
    const parts: string[] = [];
    if (term.deviceName && term.portLabel) parts.push(`${term.deviceName} · ${term.portLabel}`);
    else if (term.cableName) {
      parts.push(
        `${term.cableName}${term.fiberNumber !== undefined ? ` f${term.fiberNumber}` : ''}`,
      );
    }
    if (term.elementName) parts.push(term.elementName);
    return parts.join(' — ') || '—';
  };

  const inputCls =
    'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent';
  const labelCls = 'flex flex-col gap-1 text-sm font-medium text-text';

  return (
    <StudioModal
      title={t('budget.title')}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {tc('close')}
          </Button>
          <Button onClick={() => void calc()} loading={busy} disabled={!ap || !portId}>
            {t('budget.calc')}
          </Button>
        </>
      }
    >
      {!ap ? (
        <div className="flex h-24 items-center justify-center">
          <InlineLoader label={tc('loading')} />
        </div>
      ) : devices.length === 0 ? (
        <p className="text-sm text-text-muted">{t('budget.noPorts')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <label className={labelCls}>
              {t('budget.device')}
              <select
                className={inputCls}
                value={deviceId}
                onChange={(e) => {
                  setDeviceId(e.target.value);
                  setPortId('');
                  setResult(null);
                }}
              >
                <option value="">{t('otdr.pick')}</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              {t('budget.portField')}
              <select
                className={inputCls}
                value={portId}
                onChange={(e) => setPortId(e.target.value)}
                disabled={!device}
              >
                <option value="">{t('otdr.pick')}</option>
                {device?.ports.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label ?? `#${p.portNumber}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelCls}>
              {t('budget.txDbm')}
              <input
                className={inputCls}
                inputMode="decimal"
                value={txDbm}
                onChange={(e) => setTxDbm(e.target.value)}
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

          {/* ── Resultado ─────────────────────────────────────────────────── */}
          {result && (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-muted/50 p-3">
              {result.worstDbm !== null && (
                <p className="text-xs font-medium text-text">
                  {t('budget.worst', { dbm: fmtDbm(result.worstDbm) })}
                  <span className="text-text-muted">
                    {' '}
                    · WARN &lt; {result.warnDbm} · CRIT &lt; {result.critDbm}
                  </span>
                </p>
              )}
              {result.terminals.length === 0 ? (
                <p className="text-xs text-text-muted">{t('budget.noTerminals')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px] text-text">
                    <thead className="text-text-muted">
                      <tr>
                        <th className="py-0.5 pr-2 font-medium">{t('budget.colBranch')}</th>
                        <th className="py-0.5 pr-2 font-medium">{t('budget.colTerminal')}</th>
                        <th className="py-0.5 pr-2 text-right font-medium">
                          {t('budget.colDistance')}
                        </th>
                        <th className="py-0.5 pr-2 text-right font-medium">
                          {t('budget.colLoss')}
                        </th>
                        <th className="py-0.5 pr-2 text-right font-medium">
                          {t('budget.colRx')}
                        </th>
                        <th className="py-0.5 font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {result.terminals.map((term, i) => (
                        <tr key={i} className="border-t border-border/60">
                          <td className="py-1 pr-2 whitespace-nowrap">
                            {term.branchPath ?? '—'}
                          </td>
                          <td className="py-1 pr-2">{terminalLabel(term)}</td>
                          <td className="py-1 pr-2 text-right font-mono">
                            {term.distanceM.toFixed(0)} m
                          </td>
                          <td className="py-1 pr-2 text-right font-mono">
                            {term.lossDb.toFixed(2)} dB
                          </td>
                          <td className="py-1 pr-2 text-right font-mono">
                            {fmtDbm(term.expectedDbm)}
                            {term.measuredDbm != null && (
                              <span className="block text-[10px] text-text-muted">
                                {t('budget.measured', {
                                  dbm: fmtDbm(term.measuredDbm),
                                  delta: (term.deltaDb ?? 0).toFixed(2),
                                })}
                              </span>
                            )}
                          </td>
                          <td className="py-1">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${LEVEL_CLS[term.level]}`}
                            >
                              {term.level}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </StudioModal>
  );
}

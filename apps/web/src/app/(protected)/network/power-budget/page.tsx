'use client';

/**
 * /network/power-budget — calculadora de potência óptica (R5 OSP).
 *
 * v1: operador informa parâmetros do caminho e recebe breakdown dB.
 * v2 (futuro): traversal automático contrato→ONT→OLT (depende de
 * vínculo OpticalPort↔cabo-drop, que vem do fluxo de instalação).
 *
 * Defaults baseados em ITU-T G.984.5 (GPON Class B+) — operador pode
 * sobrescrever pra OLT/SFP específicos.
 */
import { Calculator } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { FieldHelp, Input, Label, Select } from '@/components/ui/Input';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import type { SplitterRatio } from '@/lib/optical-api';
import {
  powerBudgetApi,
  type PowerBudgetResult,
  type WavelengthNm,
} from '@/lib/power-budget-api';

const SPLITTER_OPTIONS: { value: SplitterRatio; label: string }[] = [
  { value: 'ONE_TO_2', label: '1:2 (3.5 dB)' },
  { value: 'ONE_TO_4', label: '1:4 (7.0 dB)' },
  { value: 'ONE_TO_8', label: '1:8 (10.5 dB)' },
  { value: 'ONE_TO_16', label: '1:16 (14.0 dB)' },
  { value: 'ONE_TO_32', label: '1:32 (17.0 dB)' },
  { value: 'ONE_TO_64', label: '1:64 (20.5 dB)' },
];

const STATUS_TONE: Record<
  PowerBudgetResult['status'],
  'success' | 'warning' | 'danger'
> = {
  safe: 'success',
  tight: 'warning',
  fail: 'danger',
};

export default function PowerBudgetPage() {
  const t = useTranslations('network.powerBudget');
  const tc = useTranslations('common');

  const STATUS_LABEL: Record<PowerBudgetResult['status'], string> = {
    safe: t('status.safe'),
    tight: t('status.tight'),
    fail: t('status.fail'),
  };

  // Parâmetros do caminho
  const [fiberMeters, setFiberMeters] = useState(2000);
  const [wavelength, setWavelength] = useState<WavelengthNm>('1490');
  const [splitter1, setSplitter1] = useState<SplitterRatio | ''>('ONE_TO_8');
  const [splitter2, setSplitter2] = useState<SplitterRatio | ''>('');
  const [spliceCount, setSpliceCount] = useState(4);
  const [connectorCount, setConnectorCount] = useState(2);

  // Potências
  const [oltTxDbm, setOltTxDbm] = useState(3);
  const [ontRxMinDbm, setOntRxMinDbm] = useState(-28);
  const [measuredOntRxDbm, setMeasuredOntRxDbm] = useState<string>('');

  const [result, setResult] = useState<PowerBudgetResult | null>(null);
  const [calculating, setCalculating] = useState(false);

  async function calculate() {
    setCalculating(true);
    try {
      const splitterRatios = [splitter1, splitter2].filter(
        (s): s is SplitterRatio => s !== '',
      );
      const r = await powerBudgetApi.calculate({
        fiberLengthMeters: fiberMeters,
        wavelengthNm: wavelength,
        splitterRatios,
        spliceCount,
        connectorCount,
        oltTxDbm,
        ontRxMinDbm,
        measuredOntRxDbm:
          measuredOntRxDbm.trim() === '' ? null : Number(measuredOntRxDbm),
      });
      setResult(r);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setCalculating(false);
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Calculator className="h-6 w-6" />
          {t('title')}
        </h1>
        <p className="text-sm text-text-muted">{t('subtitle')}</p>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        {/* Form */}
        <section className="space-y-4 rounded-md border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text">{t('params')}</h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pb-fiber">{t('fiberMeters')}</Label>
              <Input
                id="pb-fiber"
                type="number"
                min={0}
                value={fiberMeters}
                onChange={(e) => setFiberMeters(Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="pb-lambda">λ (nm)</Label>
              <Select
                id="pb-lambda"
                value={wavelength}
                onChange={(e) => setWavelength(e.target.value as WavelengthNm)}
              >
                <option value="1310">{t('lambda1310')}</option>
                <option value="1490">{t('lambda1490')}</option>
                <option value="1550">{t('lambda1550')}</option>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pb-sp1">{t('splitter1')}</Label>
              <Select
                id="pb-sp1"
                value={splitter1}
                onChange={(e) =>
                  setSplitter1(e.target.value as SplitterRatio | '')
                }
              >
                <option value="">{t('noSplitter')}</option>
                {SPLITTER_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="pb-sp2">{t('splitter2')}</Label>
              <Select
                id="pb-sp2"
                value={splitter2}
                onChange={(e) =>
                  setSplitter2(e.target.value as SplitterRatio | '')
                }
              >
                <option value="">{t('noSplitter2')}</option>
                {SPLITTER_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <FieldHelp>{t('splitter2Help')}</FieldHelp>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pb-splices">{t('splices')}</Label>
              <Input
                id="pb-splices"
                type="number"
                min={0}
                value={spliceCount}
                onChange={(e) => setSpliceCount(Number(e.target.value))}
              />
              <FieldHelp>{t('splicesHelp')}</FieldHelp>
            </div>
            <div>
              <Label htmlFor="pb-conn">{t('connectors')}</Label>
              <Input
                id="pb-conn"
                type="number"
                min={0}
                value={connectorCount}
                onChange={(e) => setConnectorCount(Number(e.target.value))}
              />
              <FieldHelp>{t('connectorsHelp')}</FieldHelp>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
            <div>
              <Label htmlFor="pb-tx">{t('oltTx')}</Label>
              <Input
                id="pb-tx"
                type="number"
                step={0.1}
                value={oltTxDbm}
                onChange={(e) => setOltTxDbm(Number(e.target.value))}
              />
              <FieldHelp>{t('oltTxHelp')}</FieldHelp>
            </div>
            <div>
              <Label htmlFor="pb-rx">{t('ontRxMin')}</Label>
              <Input
                id="pb-rx"
                type="number"
                step={0.1}
                value={ontRxMinDbm}
                onChange={(e) => setOntRxMinDbm(Number(e.target.value))}
              />
              <FieldHelp>{t('ontRxMinHelp')}</FieldHelp>
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <Label htmlFor="pb-measured">{t('measuredOntRx')}</Label>
            <Input
              id="pb-measured"
              type="number"
              step={0.1}
              value={measuredOntRxDbm}
              onChange={(e) => setMeasuredOntRxDbm(e.target.value)}
              placeholder={t('measuredOntRxPlaceholder')}
            />
            <FieldHelp>{t('measuredOntRxHelp')}</FieldHelp>
          </div>

          <Button onClick={calculate} loading={calculating} className="w-full">
            {t('calculate')}
          </Button>
        </section>

        {/* Resultado */}
        <section className="space-y-4 rounded-md border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text">{t('result')}</h2>

          {!result ? (
            <p className="text-sm text-text-muted">{t('resultEmpty')}</p>
          ) : (
            <div className="space-y-4">
              {/* Status badge gigante */}
              <div className="text-center">
                <Badge tone={STATUS_TONE[result.status]} className="text-sm">
                  {STATUS_LABEL[result.status]}
                </Badge>
              </div>

              {/* Numbers gigantes */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-md bg-surface-muted p-3">
                  <div className="text-2xs uppercase tracking-wider text-text-muted">
                    {t('totalLoss')}
                  </div>
                  <div className="text-2xl font-bold font-mono mt-1">
                    {result.totalLossDb.toFixed(2)}
                  </div>
                  <div className="text-2xs text-text-muted">dB</div>
                </div>
                <div className="rounded-md bg-surface-muted p-3">
                  <div className="text-2xs uppercase tracking-wider text-text-muted">
                    {t('ontPredicted')}
                  </div>
                  <div className="text-2xl font-bold font-mono mt-1">
                    {result.predictedOntRxDbm.toFixed(2)}
                  </div>
                  <div className="text-2xs text-text-muted">dBm</div>
                </div>
                <div className="rounded-md bg-surface-muted p-3">
                  <div className="text-2xs uppercase tracking-wider text-text-muted">
                    {t('margin')}
                  </div>
                  <div
                    className={`text-2xl font-bold font-mono mt-1 ${
                      result.marginDb < 0
                        ? 'text-red-600'
                        : result.marginDb < 3
                          ? 'text-amber-600'
                          : 'text-emerald-600'
                    }`}
                  >
                    {result.marginDb.toFixed(2)}
                  </div>
                  <div className="text-2xs text-text-muted">dB</div>
                </div>
              </div>

              {/* Breakdown */}
              <div className="rounded-md border border-border overflow-hidden">
                <div className="bg-surface-muted px-3 py-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  {t('breakdown')}
                </div>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border">
                    {result.breakdown.map((item, i) => (
                      <tr key={i}>
                        <td className="px-3 py-1.5">
                          {item.label}
                          {item.detail && (
                            <div className="text-2xs text-text-muted">
                              {item.detail}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-sm">
                          {item.lossDb.toFixed(2)} dB
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-surface-muted">
                      <td className="px-3 py-1.5 font-semibold">{t('total')}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold">
                        {result.totalLossDb.toFixed(2)} dB
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Janela útil */}
              <div className="text-xs text-text-muted text-center">
                {t('windowLabel')}{' '}
                <span className="font-mono">
                  {result.totalBudgetDb.toFixed(2)} dB
                </span>{' '}
                {t('windowFormula')}
              </div>

              {/* Medição (opcional) */}
              {result.measurement && (
                <div className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
                    {t('budgetedVsMeasured')}
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span>{t('predicted')}</span>
                    <span className="font-mono">
                      {result.predictedOntRxDbm.toFixed(2)} dBm
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span>{t('measured')}</span>
                    <span className="font-mono">
                      {result.measurement.measuredOntRxDbm.toFixed(2)} dBm
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm pt-1 border-t border-border mt-1">
                    <span>{t('difference')}</span>
                    <span
                      className={`font-mono font-semibold ${
                        result.measurement.diffClass === 'degraded'
                          ? 'text-red-600'
                          : result.measurement.diffClass === 'better'
                            ? 'text-emerald-600'
                            : 'text-text'
                      }`}
                    >
                      {result.measurement.diffDb > 0 ? '+' : ''}
                      {result.measurement.diffDb.toFixed(2)} dB
                    </span>
                  </div>
                  <p className="mt-2 text-2xs text-text-muted">
                    {result.measurement.diffClass === 'matches' &&
                      t('diffMatches')}
                    {result.measurement.diffClass === 'better' &&
                      t('diffBetter')}
                    {result.measurement.diffClass === 'degraded' &&
                      t('diffDegraded')}
                  </p>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

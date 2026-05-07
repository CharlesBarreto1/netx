'use client';

import { useState } from 'react';
import useSWR from 'swr';

import { Select } from '@/components/ui/Input';
import { InlineLoader } from '@/components/ui/Spinner';
import { radacctApi, type UsageResponse } from '@/lib/radacct-api';

/**
 * ContractUsageChart — gráfico simples de consumo diário (download +
 * upload) no contrato. CSS-only (barras stacked), sem libs.
 *
 * Período: 7 / 30 / 90 dias. Default 30.
 */
export function ContractUsageChart({ contractId }: { contractId: string }) {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useSWR<UsageResponse>(
    radacctApi.usagePath(contractId, days),
  );

  if (isLoading && !data) return <InlineLoader label="Cargando consumo…" />;
  if (!data || data.data.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-surface p-4 text-sm text-text-muted">
        Sin datos de consumo en el período. Verificá que el BNG esté
        enviando accounting al RADIUS.
      </div>
    );
  }

  // Escala: max do total (in+out) entre os dias.
  const maxDay = data.data.reduce(
    (m, d) => Math.max(m, d.inputBytes + d.outputBytes),
    1,
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-text-muted">
          <span>
            <span className="inline-block h-2 w-2 rounded-sm bg-sky-500" />{' '}
            Download {formatBytes(data.totals.input)}
          </span>
          <span>
            <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500" />{' '}
            Upload {formatBytes(data.totals.output)}
          </span>
        </div>
        <Select
          value={String(days)}
          onChange={(e) => setDays(Number(e.target.value))}
          className="w-32"
        >
          <option value="7">7 días</option>
          <option value="30">30 días</option>
          <option value="90">90 días</option>
        </Select>
      </div>

      <div className="space-y-1">
        {data.data.map((d) => {
          const total = d.inputBytes + d.outputBytes;
          const pct = (total / maxDay) * 100;
          const inPct = total > 0 ? (d.inputBytes / total) * pct : 0;
          const outPct = total > 0 ? (d.outputBytes / total) * pct : 0;
          return (
            <div
              key={d.date}
              className="flex items-center gap-2 text-xs"
            >
              <span className="w-20 text-text-muted tabular-nums">{d.date}</span>
              <div className="relative h-4 flex-1 overflow-hidden rounded-sm bg-surface-muted">
                <div
                  className="absolute left-0 top-0 h-full bg-sky-500"
                  style={{ width: `${inPct}%` }}
                />
                <div
                  className="absolute top-0 h-full bg-emerald-500"
                  style={{
                    left: `${inPct}%`,
                    width: `${outPct}%`,
                  }}
                />
              </div>
              <span className="w-24 text-right text-text-muted tabular-nums">
                {formatBytes(total)}
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-2xs text-text-muted">
        Datos agregados por día a partir de las sesiones encerradas. Sesiones
        en curso no aparecen acá hasta el próximo Acct-Stop / Interim-Update.
      </p>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n < 1024 ** 4) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  return `${(n / 1024 ** 4).toFixed(2)} TB`;
}

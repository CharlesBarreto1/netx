'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import {
  fibermapApi,
  type FibermapCtoSummary,
  type FibermapSubscriberPortRow,
} from '@/lib/fibermap-api';

/**
 * SubscriberPortPicker — picker reutilizável de CTO/porta de drop (FiberMap,
 * spec §11). Fonte de verdade do vínculo assinante ↔ planta.
 *
 *   Passo 1: busca de CTO por nome (debounce 300ms); com nearLat/nearLng o
 *            backend ordena por proximidade (KNN) e devolve distanceM.
 *   Passo 2: portas OUT dos splitters da CTO — FREE (verde) e CONNECTED
 *            (âmbar, fibra documentada sem contrato) são selecionáveis;
 *            ASSIGNED (cinza) mostra o contrato que já ocupa e fica bloqueada.
 *
 * O componente NÃO chama assign — só devolve a seleção via onChange. Quem
 * decide quando persistir (payload do install, pós-criação de contrato,
 * modal "Trocar porta") é o caller.
 */
export interface SubscriberPortSelection {
  portId: string;
  elementName: string;
  portNumber: number;
  /** Texto pronto do chip ("CTO · porta N"), já traduzido. */
  label: string;
}

export function SubscriberPortPicker({
  value,
  onChange,
  nearLat,
  nearLng,
  disabled,
}: {
  value: { portId: string; label: string } | null;
  onChange: (sel: SubscriberPortSelection | null) => void;
  nearLat?: number | null;
  nearLng?: number | null;
  disabled?: boolean;
}) {
  const t = useTranslations('fibermap.portPicker');

  // Passo 1 — busca com debounce (~300ms) pra não martelar o backend.
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(id);
  }, [query]);

  // Passo 2 — CTO escolhida (null = ainda buscando).
  const [selectedCto, setSelectedCto] = useState<FibermapCtoSummary | null>(null);

  const hasCoords = nearLat != null && nearLng != null;
  const showSearch = !value && !selectedCto && !disabled;

  const { data: ctos, isLoading: ctosLoading } = useSWR(
    showSearch
      ? ['fibermap-ctos', debounced, hasCoords ? `${nearLat},${nearLng}` : '']
      : null,
    () =>
      fibermapApi.searchCtos({
        search: debounced.trim() || undefined,
        nearLat: hasCoords ? nearLat! : undefined,
        nearLng: hasCoords ? nearLng! : undefined,
        limit: 20,
      }),
    { keepPreviousData: true },
  );

  const { data: portsResp, isLoading: portsLoading } = useSWR(
    selectedCto && !value ? ['fibermap-cto-ports', selectedCto.elementId] : null,
    () => fibermapApi.ctoPorts(selectedCto!.elementId),
  );

  // Agrupa por splitter — CTO pode ter mais de um (ex.: 2× 1x8).
  const deviceGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        deviceId: string;
        deviceName: string;
        deviceRatio: string | null;
        ports: FibermapSubscriberPortRow[];
      }
    >();
    for (const p of portsResp?.ports ?? []) {
      const g =
        map.get(p.deviceId) ??
        { deviceId: p.deviceId, deviceName: p.deviceName, deviceRatio: p.deviceRatio, ports: [] };
      g.ports.push(p);
      map.set(p.deviceId, g);
    }
    return [...map.values()];
  }, [portsResp]);

  function pickPort(p: FibermapSubscriberPortRow) {
    if (!portsResp) return;
    onChange({
      portId: p.portId,
      elementName: portsResp.element.name,
      portNumber: p.portNumber,
      label: t('chip', { cto: portsResp.element.name, port: p.portNumber }),
    });
    // Reseta o fluxo interno — se o caller limpar depois, volta na busca.
    setSelectedCto(null);
    setQuery('');
  }

  function formatDistance(m: number): string {
    return m < 1000
      ? t('distanceM', { value: m })
      : t('distanceKm', { value: (m / 1000).toFixed(1) });
  }

  // ── Seleção atual: chip "CTO · porta N" + limpar ─────────────────────────
  if (value) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-muted px-2.5 py-1 text-xs font-medium text-text">
        {value.label}
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          aria-label={t('clear')}
          className="rounded-full px-0.5 text-sm leading-none text-text-muted transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
        >
          ×
        </button>
      </span>
    );
  }

  // ── Passo 2: portas da CTO escolhida ─────────────────────────────────────
  if (selectedCto) {
    const total = portsResp?.ports.length ?? selectedCto.outPortsTotal;
    const free =
      portsResp?.ports.filter((p) => p.status === 'FREE').length ??
      selectedCto.outPortsFree;
    return (
      <div className="space-y-3 rounded-md border border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-text">
              {t('portsTitle', { name: selectedCto.name })}
            </p>
            <p className="text-xs text-text-muted">
              {t('freePorts', { free, total })}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={disabled}
            onClick={() => setSelectedCto(null)}
          >
            {t('changeCto')}
          </Button>
        </div>

        {portsLoading && !portsResp ? (
          <p className="text-xs text-text-muted">{t('portsLoading')}</p>
        ) : !portsResp || portsResp.ports.length === 0 ? (
          <p className="text-xs text-text-muted">{t('portsEmpty')}</p>
        ) : (
          <>
            {deviceGroups.map((g) => (
              <div key={g.deviceId} className="space-y-1.5">
                {deviceGroups.length > 1 && (
                  <p className="text-xs text-text-muted">
                    {g.deviceName}
                    {g.deviceRatio ? ` · ${g.deviceRatio}` : ''}
                  </p>
                )}
                <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                  {g.ports.map((p) => (
                    <PortCell
                      key={p.portId}
                      port={p}
                      disabled={disabled}
                      onPick={() => pickPort(p)}
                    />
                  ))}
                </div>
              </div>
            ))}
            {/* Legenda dos status */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-success" /> {t('statusFree')}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-warning" /> {t('statusConnected')}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-text-subtle" /> {t('statusAssigned')}
              </span>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Passo 1: busca de CTO ────────────────────────────────────────────────
  return (
    <div className="space-y-2">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('searchPlaceholder')}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
      />
      {!disabled && (
        <div className="max-h-56 overflow-y-auto rounded-md border border-border">
          {ctosLoading && !ctos ? (
            <p className="px-3 py-2 text-xs text-text-muted">{t('searching')}</p>
          ) : !ctos || ctos.length === 0 ? (
            <p className="px-3 py-2 text-xs text-text-muted">{t('empty')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {ctos.map((c) => (
                <li key={c.elementId}>
                  <button
                    type="button"
                    onClick={() => setSelectedCto(c)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-hover"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-text">
                        {c.name}
                      </span>
                      {c.address && (
                        <span className="block truncate text-xs text-text-muted">
                          {c.address}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {c.distanceM != null && (
                        <span className="text-xs text-text-muted">
                          {formatDistance(c.distanceM)}
                        </span>
                      )}
                      <span className="text-xs text-text-muted">
                        {t('freePorts', { free: c.outPortsFree, total: c.outPortsTotal })}
                      </span>
                      {/* Barrinha de ocupação — verde/âmbar/vermelho por faixa */}
                      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-muted">
                        <span
                          className={cn(
                            'block h-full rounded-full',
                            c.occupancyPct >= 90
                              ? 'bg-danger'
                              : c.occupancyPct >= 70
                                ? 'bg-warning'
                                : 'bg-success',
                          )}
                          style={{ width: `${Math.min(100, c.occupancyPct)}%` }}
                        />
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Célula de porta. ASSIGNED vira <span> (não-clicável) pro tooltip do Radix
 * funcionar — trigger em botão disabled não dispara pointer events.
 */
function PortCell({
  port,
  disabled,
  onPick,
}: {
  port: FibermapSubscriberPortRow;
  disabled?: boolean;
  onPick: () => void;
}) {
  const t = useTranslations('fibermap.portPicker');
  const base =
    'flex h-9 items-center justify-center rounded-md border text-xs font-semibold transition-colors';

  if (port.status === 'ASSIGNED') {
    return (
      <SimpleTooltip
        label={t('assignedTooltip', {
          code: port.contract?.code ?? '—',
          customer: port.contract?.customerName ?? '—',
        })}
      >
        <span
          aria-disabled
          className={cn(base, 'cursor-not-allowed border-transparent bg-surface-muted text-text-subtle')}
        >
          {port.portNumber}
        </span>
      </SimpleTooltip>
    );
  }

  const isConnected = port.status === 'CONNECTED';
  const btn = (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      aria-label={t('portLabel', { number: port.portNumber })}
      className={cn(
        base,
        'disabled:cursor-not-allowed disabled:opacity-50',
        isConnected
          ? 'border-transparent bg-warning-muted text-warning hover:border-warning'
          : 'border-transparent bg-success-muted text-success hover:border-success',
      )}
    >
      {port.portNumber}
    </button>
  );
  // CONNECTED: fibra documentada no grafo sem contrato — tooltip explica.
  return isConnected ? (
    <SimpleTooltip label={t('connectedTooltip')}>{btn}</SimpleTooltip>
  ) : (
    btn
  );
}

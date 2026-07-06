'use client';

/**
 * DeviceCreateModal — splitter/DIO/OLT no ponto de acesso (FM-3, spec §8.3).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * OLT (spec §11): só em elemento POP/CABINET e sempre vinculada a uma OLT do
 * inventário (/olts) — uma OLT do inventário só pode estar em UM lugar da
 * planta; as já colocadas aparecem desabilitadas com o elemento onde estão.
 */
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { fibermapApi, type FibermapInventoryOlt } from '@/lib/fibermap-api';

import { StudioModal } from '../studio/StudioModal';

const FIELD =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent';
const RATIOS = ['1x2', '1x4', '1x8', '1x16', '1x32', '1x64'] as const;

export function DeviceCreateModal({
  elementId,
  elementType,
  onClose,
  onCreated,
}: {
  elementId: string;
  elementType: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations('fibermap');
  const tc = useTranslations('common');
  const oltAllowed = elementType === 'POP' || elementType === 'CABINET';
  const [type, setType] = useState<'SPLITTER' | 'DIO' | 'OLT'>('SPLITTER');
  const [name, setName] = useState('');
  const [ratio, setRatio] = useState<(typeof RATIOS)[number]>('1x8');
  const [topology, setTopology] = useState<'BALANCED' | 'UNBALANCED'>('BALANCED');
  const [tap, setTap] = useState('10');
  const [ports, setPorts] = useState('12');
  const [netxOltId, setNetxOltId] = useState('');
  const [busy, setBusy] = useState(false);
  // Nome preenchido a partir da OLT escolhida — só sobrescreve se o operador
  // não digitou nada por conta própria.
  const autoNameRef = useRef('');

  const { data: inventoryOlts } = useSWR<FibermapInventoryOlt[]>(
    type === 'OLT' ? fibermapApi.listInventoryOltsPath : null,
  );

  function pickOlt(id: string) {
    setNetxOltId(id);
    const olt = inventoryOlts?.find((o) => o.id === id);
    if (olt && (!name.trim() || name === autoNameRef.current)) {
      setName(olt.name);
      autoNameRef.current = olt.name;
    }
  }

  async function submit() {
    if (type === 'OLT' && !netxOltId) {
      toast.error(t('ap.oltLinkRequired'));
      return;
    }
    if (!name.trim()) {
      toast.error(t('studio.form.errorNameRequired'));
      return;
    }
    const portsCount = Number(ports);
    if (type !== 'SPLITTER' && !(portsCount >= 1 && portsCount <= 576)) {
      toast.error(t('ap.devicePortsInvalid'));
      return;
    }
    setBusy(true);
    try {
      await fibermapApi.createDevice(elementId, {
        type,
        name: name.trim(),
        ...(type === 'SPLITTER'
          ? {
              ratio,
              topology,
              ...(topology === 'UNBALANCED' ? { tapPercent: Number(tap) } : {}),
            }
          : { portsCount }),
        ...(type === 'OLT' ? { netxOltId } : {}),
      });
      toast.success(t('ap.deviceCreated'));
      onCreated();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <StudioModal
      title={t('ap.newDevice')}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {tc('cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {tc('create')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text">{tc('type')}</span>
          <select
            className={FIELD}
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
          >
            <option value="SPLITTER">{t('ap.deviceSplitter')}</option>
            <option value="DIO">DIO</option>
            <option value="OLT" disabled={!oltAllowed}>
              {oltAllowed ? 'OLT' : `OLT — ${t('ap.oltOnlyPop')}`}
            </option>
          </select>
        </label>
        {type === 'OLT' && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-text">{t('ap.oltLink')}</span>
            {inventoryOlts && inventoryOlts.length === 0 ? (
              <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-text-muted">
                {t('ap.oltLinkEmpty')}
              </p>
            ) : (
              <select
                className={FIELD}
                value={netxOltId}
                onChange={(e) => pickOlt(e.target.value)}
              >
                <option value="">{t('ap.oltLinkPlaceholder')}</option>
                {(inventoryOlts ?? []).map((o) => (
                  <option key={o.id} value={o.id} disabled={o.placement !== null}>
                    {o.name} · {o.model}
                    {o.placement
                      ? ` — ${t('ap.oltLinkTaken', { element: o.placement.elementName })}`
                      : ''}
                  </option>
                ))}
              </select>
            )}
            <span className="text-xs text-text-muted">{t('ap.oltLinkHelp')}</span>
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text">{tc('name')}</span>
          <input
            className={FIELD}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={type === 'SPLITTER' ? 'SP-01 1x8' : type === 'DIO' ? 'DIO-01' : 'OLT-01'}
            autoFocus
          />
        </label>
        {type === 'SPLITTER' ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-text">{t('settings.specs.ratio')}</span>
              <select
                className={FIELD}
                value={ratio}
                onChange={(e) => setRatio(e.target.value as typeof ratio)}
              >
                {RATIOS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-text">{t('settings.specs.topology')}</span>
              <select
                className={FIELD}
                value={topology}
                onChange={(e) => setTopology(e.target.value as typeof topology)}
              >
                <option value="BALANCED">{t('settings.specs.topologyOptions.BALANCED')}</option>
                <option value="UNBALANCED">{t('settings.specs.topologyOptions.UNBALANCED')}</option>
              </select>
            </label>
            {topology === 'UNBALANCED' && (
              <label className="col-span-2 flex flex-col gap-1 text-sm">
                <span className="font-medium text-text">{t('settings.specs.tapPercent')}</span>
                <input
                  className={FIELD}
                  value={tap}
                  onChange={(e) => setTap(e.target.value)}
                  inputMode="numeric"
                />
              </label>
            )}
          </div>
        ) : (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-text">
              {type === 'OLT' ? t('ap.devicePons') : t('settings.specs.ports')}
            </span>
            <input
              className={FIELD}
              value={ports}
              onChange={(e) => setPorts(e.target.value)}
              inputMode="numeric"
            />
          </label>
        )}
      </div>
    </StudioModal>
  );
}

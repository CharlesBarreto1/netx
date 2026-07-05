'use client';

/**
 * BulkFuseModal — fusão em sequência (FM-3, spec §8.1).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * "Fibras N..N+k do cabo A nas M..M+k do cabo B" — pares 1:1; pontas
 * ocupadas/inexistentes são puladas e reportadas (o backend decide).
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { fibermapApi, type FibermapApCable } from '@/lib/fibermap-api';

import { StudioModal } from '../studio/StudioModal';

const FIELD =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent';

export function BulkFuseModal({
  elementId,
  cables,
  onClose,
  onDone,
}: {
  elementId: string;
  cables: FibermapApCable[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('fibermap');
  const tc = useTranslations('common');
  const [aCable, setACable] = useState(cables[0]?.id ?? '');
  const [bCable, setBCable] = useState(cables[1]?.id ?? cables[0]?.id ?? '');
  const [aStart, setAStart] = useState('1');
  const [bStart, setBStart] = useState('1');
  const [count, setCount] = useState('8');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const a = Number(aStart);
    const b = Number(bStart);
    const n = Number(count);
    if (!aCable || !bCable || !(a >= 1) || !(b >= 1) || !(n >= 1 && n <= 144)) {
      toast.error(t('ap.bulkInvalid'));
      return;
    }
    setBusy(true);
    try {
      const res = await fibermapApi.bulkFuse({
        elementId,
        aCableId: aCable,
        aStartFiber: a,
        bCableId: bCable,
        bStartFiber: b,
        count: n,
      });
      if (res.skipped.length === 0) {
        toast.success(t('ap.bulkDone', { created: res.created }));
      } else {
        toast.warning(
          t('ap.bulkPartial', { created: res.created, skipped: res.skipped.length }),
        );
      }
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  const cableSelect = (value: string, onChange: (v: string) => void) => (
    <select className={FIELD} value={value} onChange={(e) => onChange(e.target.value)}>
      {cables.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name} ({c.fiberCount} FO)
        </option>
      ))}
    </select>
  );

  return (
    <StudioModal
      title={t('ap.bulkFuse')}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {tc('cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {t('ap.bulkGo')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text">{t('ap.bulkCableA')}</span>
          {cableSelect(aCable, setACable)}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text">{t('ap.bulkStart')}</span>
          <input className={FIELD} value={aStart} onChange={(e) => setAStart(e.target.value)} inputMode="numeric" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text">{t('ap.bulkCableB')}</span>
          {cableSelect(bCable, setBCable)}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text">{t('ap.bulkStart')}</span>
          <input className={FIELD} value={bStart} onChange={(e) => setBStart(e.target.value)} inputMode="numeric" />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-sm">
          <span className="font-medium text-text">{t('ap.bulkCount')}</span>
          <input className={FIELD} value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" />
          <span className="text-xs text-text-subtle">{t('ap.bulkHelp')}</span>
        </label>
      </div>
    </StudioModal>
  );
}

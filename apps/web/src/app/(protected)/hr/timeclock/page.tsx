'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Label, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { hasPermission } from '@/lib/session';
import {
  hrApi,
  type Paginated,
  type TimeCorrection,
  type TimeCorrectionStatus,
} from '@/lib/hr-api';

export default function HrTimeclockPage() {
  const t = useTranslations('hr.timeclock');
  const te = useTranslations('hr.enums');
  const kindLabel: Record<string, string> = {
    ADD: t('kind.ADD'),
    EDIT: t('kind.EDIT'),
    REMOVE: t('kind.REMOVE'),
  };
  const statusLabel: Record<TimeCorrectionStatus, string> = {
    PENDING: t('status.PENDING'),
    APPROVED: t('status.APPROVED'),
    REJECTED: t('status.REJECTED'),
  };
  const canManage = hasPermission('hr.timeclock.manage');
  const [status, setStatus] = useState<TimeCorrectionStatus>('PENDING');
  const query = { status, pageSize: 100 };
  const { data, isLoading, mutate } = useSWR<Paginated<TimeCorrection>>(
    hrApi.correctionsPath(query),
    () => hrApi.listCorrections(query),
  );
  const [reviewing, setReviewing] = useState<TimeCorrection | null>(null);
  const rows = data?.data ?? [];

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('subtitle')}
        </p>
      </header>

      <div className="flex gap-2">
        {(['PENDING', 'APPROVED', 'REJECTED'] as TimeCorrectionStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1 text-sm ${
              status === s
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {statusLabel[s]}
          </button>
        ))}
      </div>

      {isLoading && <PageLoader />}
      {rows.length === 0 && !isLoading && (
        <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          {t('empty')}
        </p>
      )}

      <div className="space-y-2">
        {rows.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
            <div>
              <strong>{c.employee?.fullName}</strong>
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-700">
                {kindLabel[c.kind]}
              </span>
              <span className="ml-2 text-slate-500">{c.targetDate}</span>
              {c.proposedType && c.proposedTime && (
                <span className="ml-2 text-xs text-slate-500">
                  → {te(`entryType.${c.proposedType}`)} {new Date(c.proposedTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              <p className="mt-1 text-xs text-slate-500">{c.reason}</p>
            </div>
            {c.status === 'PENDING' && canManage && (
              <Button size="sm" onClick={() => setReviewing(c)}>{t('review')}</Button>
            )}
            {c.status !== 'PENDING' && (
              <span className="text-xs text-slate-400">{statusLabel[c.status]}</span>
            )}
          </div>
        ))}
      </div>

      {reviewing && (
        <ReviewModal
          correction={reviewing}
          onClose={() => setReviewing(null)}
          onDone={async () => { setReviewing(null); await mutate(); }}
        />
      )}
    </div>
  );
}

function ReviewModal({ correction, onClose, onDone }: { correction: TimeCorrection; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('hr.timeclock');
  const tc = useTranslations('common');
  const kindLabel: Record<string, string> = {
    ADD: t('kind.ADD'),
    EDIT: t('kind.EDIT'),
    REMOVE: t('kind.REMOVE'),
  };
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  async function decide(decision: 'APPROVED' | 'REJECTED') {
    setBusy(true);
    try {
      await hrApi.reviewCorrection(correction.id, { decision, reviewNotes: notes || null });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('modalTitle', { name: correction.employee?.fullName ?? '' })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tc('cancel')}</Button>
          <Button variant="danger" onClick={() => decide('REJECTED')} loading={busy}>{t('reject')}</Button>
          <Button onClick={() => decide('APPROVED')} loading={busy}>{t('approve')}</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p><strong>{kindLabel[correction.kind]}</strong> {t('on', { date: correction.targetDate })}</p>
        <p className="text-slate-500">{correction.reason}</p>
        <div>
          <Label>{t('notesLabel')}</Label>
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

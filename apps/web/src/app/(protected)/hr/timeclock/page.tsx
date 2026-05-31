'use client';

import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Label, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { hasPermission } from '@/lib/session';
import {
  hrApi,
  ENTRY_TYPE_LABELS,
  type Paginated,
  type TimeCorrection,
  type TimeCorrectionStatus,
} from '@/lib/hr-api';

const KIND_LABEL: Record<string, string> = { ADD: 'Adicionar', EDIT: 'Corrigir', REMOVE: 'Remover' };
const STATUS_LABEL: Record<TimeCorrectionStatus, string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
};

export default function HrTimeclockPage() {
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
        <h1 className="text-2xl font-bold tracking-tight">Ponto — correções</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Solicitações de correção enviadas pelos colaboradores. Aprovar materializa a
          marcação no espelho.
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
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {isLoading && <PageLoader />}
      {rows.length === 0 && !isLoading && (
        <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          Nenhuma solicitação.
        </p>
      )}

      <div className="space-y-2">
        {rows.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
            <div>
              <strong>{c.employee?.fullName}</strong>
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-700">
                {KIND_LABEL[c.kind]}
              </span>
              <span className="ml-2 text-slate-500">{c.targetDate}</span>
              {c.proposedType && c.proposedTime && (
                <span className="ml-2 text-xs text-slate-500">
                  → {ENTRY_TYPE_LABELS[c.proposedType]} {new Date(c.proposedTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              <p className="mt-1 text-xs text-slate-500">{c.reason}</p>
            </div>
            {c.status === 'PENDING' && canManage && (
              <Button size="sm" onClick={() => setReviewing(c)}>Avaliar</Button>
            )}
            {c.status !== 'PENDING' && (
              <span className="text-xs text-slate-400">{STATUS_LABEL[c.status]}</span>
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
      title={`Avaliar correção — ${correction.employee?.fullName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="danger" onClick={() => decide('REJECTED')} loading={busy}>Rejeitar</Button>
          <Button onClick={() => decide('APPROVED')} loading={busy}>Aprovar</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p><strong>{KIND_LABEL[correction.kind]}</strong> em {correction.targetDate}</p>
        <p className="text-slate-500">{correction.reason}</p>
        <div>
          <Label>Observações (opcional)</Label>
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

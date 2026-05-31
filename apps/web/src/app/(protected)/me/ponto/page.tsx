'use client';

import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import {
  hrApi,
  ENTRY_TYPE_LABELS,
  fmtMinutes,
  type Timesheet,
  type TimeCorrectionKind,
  type TimeEntryType,
} from '@/lib/hr-api';

function monthRange() {
  const n = new Date();
  const first = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1));
  const last = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

export default function MePontoPage() {
  const [range, setRange] = useState(monthRange());
  const { data } = useSWR<Timesheet>(
    `/v1/hr/me/timesheet?from=${range.from}&to=${range.to}`,
    () => hrApi.meTimesheet(range.from, range.to),
  );
  const [correcting, setCorrecting] = useState(false);

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Meu ponto</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Espelho do período + solicitação de correção.</p>
        </div>
        <Button onClick={() => setCorrecting(true)}>Solicitar correção</Button>
      </header>

      <div className="flex flex-wrap items-end gap-2">
        <div><Label>De</Label><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></div>
        <div><Label>Até</Label><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></div>
        {data && <span className="ml-auto text-sm text-slate-500">Total: <strong>{fmtMinutes(data.totalWorkedMinutes)}</strong></span>}
      </div>

      {!data && <PageLoader />}
      <div className="space-y-2">
        {data?.days.length === 0 && <p className="text-sm text-slate-500">Sem marcações no período.</p>}
        {data?.days.map((d) => (
          <div key={d.date} className="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="flex justify-between">
              <strong>{new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}</strong>
              <span className="text-slate-500">{fmtMinutes(d.workedMinutes)}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
              {d.entries.map((e, i) => (
                <span key={i} className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-700">
                  {ENTRY_TYPE_LABELS[e.type]} {new Date(e.occurredAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {correcting && <CorrectionModal onClose={() => setCorrecting(false)} onDone={() => setCorrecting(false)} />}
    </div>
  );
}

function CorrectionModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  // Portal solicita ADD (marcação esquecida). Corrigir/remover uma marcação
  // específica fica no RH (admin), que tem a lista com os ids das marcações.
  const [targetDate, setTargetDate] = useState(new Date().toISOString().slice(0, 10));
  const [proposedType, setProposedType] = useState<TimeEntryType>('CLOCK_IN');
  const [time, setTime] = useState('08:00');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reason.trim()) return setError('Descreva o motivo');
    setBusy(true);
    setError(null);
    try {
      const proposedTime = new Date(`${targetDate}T${time}:00`).toISOString();
      await hrApi.meCreateCorrection({
        kind: 'ADD' as TimeCorrectionKind,
        targetDate,
        proposedType,
        proposedTime,
        reason,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Solicitar correção de ponto"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} loading={busy}>Enviar para o RH</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {error && <div className="rounded-md bg-red-50 p-2 text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
        <p className="text-slate-500">
          Informe a marcação que faltou. A solicitação vai para aprovação do RH e só vira
          marcação depois de aprovada.
        </p>
        <div><Label>Data</Label><Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} /></div>
        <div className="flex gap-2">
          <div className="flex-1">
            <Label>Marcação</Label>
            <select className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900" value={proposedType} onChange={(e) => setProposedType(e.target.value as TimeEntryType)}>
              {(['CLOCK_IN', 'CLOCK_OUT', 'BREAK_START', 'BREAK_END'] as TimeEntryType[]).map((t) => (
                <option key={t} value={t}>{ENTRY_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div className="w-32"><Label>Hora</Label><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
        </div>
        <div><Label>Motivo</Label><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      </div>
    </Modal>
  );
}

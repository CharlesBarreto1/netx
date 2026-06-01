'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { Tabs } from '@/components/ui/Tabs';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  hrApi,
  fmtMinutes,
  type Employee,
  type EmployeeDocument,
  type EmployeeDocumentType,
  type Payslip,
  type Timesheet,
} from '@/lib/hr-api';

type Tab = 'data' | 'documents' | 'timesheet' | 'payslips';

export default function EmployeeDetailPage() {
  const t = useTranslations('hr.employeeDetail');
  const te = useTranslations('hr.enums');
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: emp, isLoading, mutate } = useSWR<Employee>(`/v1/hr/employees/${id}`, () => hrApi.getEmployee(id));
  const [tab, setTab] = useState<Tab>('data');

  if (isLoading) return <PageLoader />;
  if (!emp) return <p className="text-sm text-slate-500">{t('notFound')}</p>;

  return (
    <div className="space-y-5">
      <div className="text-sm text-slate-500">
        <Link href="/hr/employees" className="hover:underline">{t('breadcrumb')}</Link> / {emp.fullName}
      </div>
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{emp.fullName}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {[emp.position, emp.department, emp.registration].filter(Boolean).join(' · ')} ·{' '}
            {te(`employeeStatus.${emp.status}`)}
          </p>
        </div>
      </header>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'data', label: t('tabs.data') },
          { value: 'documents', label: t('tabs.documents') },
          { value: 'timesheet', label: t('tabs.timesheet') },
          { value: 'payslips', label: t('tabs.payslips') },
        ]}
      />

      {tab === 'data' && <DataTab emp={emp} onSaved={mutate} />}
      {tab === 'documents' && <DocumentsTab employeeId={id} />}
      {tab === 'timesheet' && <TimesheetTab employeeId={id} />}
      {tab === 'payslips' && <PayslipsTab employeeId={id} />}
    </div>
  );
}

// ── Aba: Dados ────────────────────────────────────────────────────────────────
function DataTab({ emp, onSaved }: { emp: Employee; onSaved: () => void }) {
  const t = useTranslations('hr.employeeDetail');
  const tm = useTranslations('miscComponents');
  const te = useTranslations('hr.enums');
  const tc = useTranslations('common');
  const canWrite = hasPermission('hr.write');
  const [form, setForm] = useState(emp);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skillsText, setSkillsText] = useState(emp.skills.join(', '));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await hrApi.updateEmployee(emp.id, {
        fullName: form.fullName,
        preferredName: form.preferredName,
        document: form.document,
        position: form.position,
        department: form.department,
        email: form.email,
        phone: form.phone,
        emergencyContact: form.emergencyContact,
        emergencyPhone: form.emergencyPhone,
        address: form.address,
        employmentType: form.employmentType,
        status: form.status,
        hiredAt: form.hiredAt,
        probationEndsAt: form.probationEndsAt,
        baseSalary: form.baseSalary,
        weeklyHours: form.weeklyHours,
        workSchedule: form.workSchedule,
        clockToleranceMin: form.clockToleranceMin,
        skills: skillsText.split(',').map((s) => s.trim()).filter(Boolean),
        notes: form.notes,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  const ro = !canWrite;
  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      {error && <div className="rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={tc('name')}><Input value={form.fullName} disabled={ro} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
        <Field label={t('fields.document')}><Input value={form.document ?? ''} disabled={ro} onChange={(e) => setForm({ ...form, document: e.target.value })} /></Field>
        <Field label={tc('phone')}><Input value={form.phone ?? ''} disabled={ro} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label={t('fields.position')}><Input value={form.position ?? ''} disabled={ro} onChange={(e) => setForm({ ...form, position: e.target.value })} /></Field>
        <Field label={t('fields.department')}><Input value={form.department ?? ''} disabled={ro} onChange={(e) => setForm({ ...form, department: e.target.value })} /></Field>
        <Field label={t('fields.employmentType')}>
          <span className="text-sm">{te(`employmentType.${form.employmentType}`)}</span>
        </Field>
        <Field label={t('fields.hiredAt')}><Input type="date" value={form.hiredAt ?? ''} disabled={ro} onChange={(e) => setForm({ ...form, hiredAt: e.target.value })} /></Field>
        <Field label={t('fields.probationEndsAt')}><Input type="date" value={form.probationEndsAt ?? ''} disabled={ro} onChange={(e) => setForm({ ...form, probationEndsAt: e.target.value })} /></Field>
        <Field label={t('fields.baseSalary')}><Input type="number" step="0.01" value={form.baseSalary ?? ''} disabled={ro} onChange={(e) => setForm({ ...form, baseSalary: e.target.value ? Number(e.target.value) : null })} /></Field>
        <Field label={t('fields.workSchedule')}><Input value={form.workSchedule ?? ''} disabled={ro} onChange={(e) => setForm({ ...form, workSchedule: e.target.value })} /></Field>
        <Field label={t('fields.clockTolerance')}><Input type="number" value={form.clockToleranceMin} disabled={ro} onChange={(e) => setForm({ ...form, clockToleranceMin: Number(e.target.value) || 0 })} /></Field>
        <Field label={t('fields.emergencyContact')}><Input value={form.emergencyContact ?? ''} disabled={ro} onChange={(e) => setForm({ ...form, emergencyContact: e.target.value })} /></Field>
      </div>
      <Field label={t('fields.skills')}>
        <Input value={skillsText} disabled={ro} onChange={(e) => setSkillsText(e.target.value)} placeholder={tm('employeeSkills.placeholder')} />
      </Field>
      <Field label={t('fields.notes')}>
        <Textarea rows={4} value={form.notes ?? ''} disabled={ro} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </Field>
      {canWrite && (
        <div className="flex justify-end">
          <Button onClick={save} loading={saving}>{t('saveChanges')}</Button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

// ── Aba: Documentos ──────────────────────────────────────────────────────────
const DOC_TYPES: EmployeeDocumentType[] = [
  'CONTRACT', 'AMENDMENT', 'MEDICAL_CERTIFICATE', 'WARNING', 'SUSPENSION',
  'ID_DOCUMENT', 'CERTIFICATE', 'PAYSLIP', 'PAYMENT_RECEIPT', 'OTHER',
];

function DocumentsTab({ employeeId }: { employeeId: string }) {
  const t = useTranslations('hr.employeeDetail');
  const te = useTranslations('hr.enums');
  const tc = useTranslations('common');
  const canManage = hasPermission('hr.documents.manage');
  const { data, mutate } = useSWR<EmployeeDocument[]>(
    hrApi.documentsPath(employeeId),
    () => hrApi.listDocuments(employeeId),
  );
  const [adding, setAdding] = useState(false);
  const docs = data ?? [];

  async function download(doc: EmployeeDocument) {
    const { url } = await hrApi.documentDownload(employeeId, doc.id);
    window.open(url, '_blank');
  }
  async function sign(doc: EmployeeDocument) {
    await hrApi.signDocument(employeeId, doc.id);
    await mutate();
  }
  async function remove(doc: EmployeeDocument) {
    await hrApi.deleteDocument(employeeId, doc.id);
    await mutate();
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)}>{t('attachDocument')}</Button>
        </div>
      )}
      {docs.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          {t('noDocuments')}
        </p>
      )}
      <div className="space-y-2">
        {docs.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
            <div>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                {te(`docType.${d.type}`)}
              </span>{' '}
              <strong>{d.title}</strong>
              {d.requiresSignature && (
                <span className={`ml-2 text-xs ${d.signature ? 'text-green-600' : 'text-amber-600'}`}>
                  {d.signature ? t('signed') : t('awaitingSignature')}
                </span>
              )}
              {d.expiresAt && <span className="ml-2 text-xs text-slate-400">{t('expiresAt', { date: d.expiresAt })}</span>}
            </div>
            <div className="flex gap-1">
              {d.storageKey && <Button size="sm" variant="ghost" onClick={() => download(d)}>{tc('download')}</Button>}
              {canManage && d.requiresSignature && !d.signature && (
                <Button size="sm" variant="ghost" onClick={() => sign(d)}>{t('registerAcknowledgment')}</Button>
              )}
              {canManage && <Button size="sm" variant="ghost" onClick={() => remove(d)}>{tc('delete')}</Button>}
            </div>
          </div>
        ))}
      </div>
      {adding && (
        <AddDocumentModal
          employeeId={employeeId}
          onClose={() => setAdding(false)}
          onSaved={async () => { setAdding(false); await mutate(); }}
        />
      )}
    </div>
  );
}

function AddDocumentModal({ employeeId, onClose, onSaved }: { employeeId: string; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('hr.employeeDetail');
  const te = useTranslations('hr.enums');
  const tc = useTranslations('common');
  const fileRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<EmployeeDocumentType>('OTHER');
  const [title, setTitle] = useState('');
  const [requiresSignature, setRequiresSignature] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError(t('titleRequired'));
    setBusy(true);
    setError(null);
    try {
      const file = fileRef.current?.files?.[0] ?? null;
      let storageKey: string | null = null;
      let fileName: string | null = null;
      if (file) {
        const { uploadUrl, storageKey: key } = await hrApi.uploadUrl(employeeId, {
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
        });
        const put = await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });
        if (!put.ok) throw new Error(t('uploadFailed'));
        storageKey = key;
        fileName = file.name;
      }
      await hrApi.createDocument(employeeId, {
        type,
        title,
        storageKey,
        fileName,
        requiresSignature,
        expiresAt: expiresAt || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : (err as Error).message || tc('error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('attachDocument')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tc('cancel')}</Button>
          <Button onClick={() => (document.getElementById('add-doc') as HTMLFormElement | null)?.requestSubmit()} loading={busy}>
            {t('attach')}
          </Button>
        </>
      }
    >
      <form id="add-doc" onSubmit={submit} className="space-y-3">
        {error && <div className="rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
        <div>
          <Label>{tc('type')}</Label>
          <select
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            value={type}
            onChange={(e) => setType(e.target.value as EmployeeDocumentType)}
          >
            {DOC_TYPES.map((dt) => <option key={dt} value={dt}>{te(`docType.${dt}`)}</option>)}
          </select>
        </div>
        <div><Label>{t('docTitle')}</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div><Label>{t('validity')}</Label><Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></div>
        <div><Label>{t('file')}</Label><input ref={fileRef} type="file" className="block w-full text-sm" /></div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={requiresSignature} onChange={(e) => setRequiresSignature(e.target.checked)} />
          {t('requiresSignature')}
        </label>
      </form>
    </Modal>
  );
}

// ── Aba: Ponto (espelho) ─────────────────────────────────────────────────────
function monthRange(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

function TimesheetTab({ employeeId }: { employeeId: string }) {
  const t = useTranslations('hr.employeeDetail');
  const te = useTranslations('hr.enums');
  const [range, setRange] = useState(monthRange());
  const { data } = useSWR<Timesheet>(
    `/v1/hr/timeclock/timesheet/${employeeId}?from=${range.from}&to=${range.to}`,
    () => hrApi.timesheet(employeeId, range.from, range.to),
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div><Label>{t('from')}</Label><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></div>
        <div><Label>{t('to')}</Label><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></div>
        {data && <span className="ml-auto text-sm text-slate-500">{t('total')}: <strong>{fmtMinutes(data.totalWorkedMinutes)}</strong></span>}
      </div>
      <div className="space-y-2">
        {data?.days.length === 0 && <p className="text-sm text-slate-500">{t('noEntries')}</p>}
        {data?.days.map((d) => (
          <div key={d.date} className="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="flex justify-between">
              <strong>{d.date}</strong>
              <span className="text-slate-500">{fmtMinutes(d.workedMinutes)}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
              {d.entries.map((e, i) => (
                <span key={i} className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-700">
                  {te(`entryType.${e.type}`)} {new Date(e.occurredAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Aba: Holerites ────────────────────────────────────────────────────────────
function PayslipsTab({ employeeId }: { employeeId: string }) {
  const t = useTranslations('hr.employeeDetail');
  const te = useTranslations('hr.enums');
  const { data } = useSWR(
    hrApi.payslipsPath({ employeeId, pageSize: 50 }),
    () => hrApi.listPayslips({ employeeId, pageSize: 50 }),
  );
  const rows = data?.data ?? [];
  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="text-sm text-slate-500">{t('noPayslips')}</p>}
      {rows.map((p: Payslip) => (
        <div key={p.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
          <div>
            <strong>{p.referenceMonth.slice(0, 7)}</strong>
            <span className="ml-2 text-xs text-slate-500">{te(`payslipStatus.${p.status}`)}</span>
          </div>
          <div className="font-mono">R$ {p.netAmount.toFixed(2)}</div>
        </div>
      ))}
    </div>
  );
}

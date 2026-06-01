'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Label } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  hrApi,
  type CreateEmployeeInput,
  type Employee,
  type EmployeeStatus,
  type EmploymentType,
  type Paginated,
} from '@/lib/hr-api';

const STATUSES: EmployeeStatus[] = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED'];
const TYPES: EmploymentType[] = ['CLT', 'PJ', 'INTERN', 'TEMPORARY', 'RELACION_DEPENDENCIA', 'OTHER'];

const STATUS_BADGE: Record<EmployeeStatus, string> = {
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  ON_LEAVE: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  SUSPENDED: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  TERMINATED: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};

export default function EmployeesPage() {
  const t = useTranslations('hr.employees');
  const tc = useTranslations('common');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<EmployeeStatus | ''>('');
  const query = { pageSize: 200, ...(search ? { search } : {}), ...(status ? { status } : {}) };
  const { data, isLoading, error, mutate } = useSWR<Paginated<Employee>>(
    hrApi.employeesPath(query),
    () => hrApi.listEmployees(query),
  );
  const canWrite = hasPermission('hr.write');
  const [creating, setCreating] = useState(false);
  const rows = data?.data ?? [];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('subtitle')}
          </p>
        </div>
        {canWrite && <Button onClick={() => setCreating(true)}>{t('new')}</Button>}
      </header>

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <select
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
          value={status}
          onChange={(e) => setStatus(e.target.value as EmployeeStatus | '')}
        >
          <option value="">{t('allStatuses')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{t(`status.${s}`)}</option>
          ))}
        </select>
      </div>

      {isLoading && <PageLoader />}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {t('loadError')}
        </div>
      )}

      {data && rows.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
          {t('empty')}
        </p>
      )}

      {rows.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-900/40">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3">{t('col.registration')}</th>
                  <th className="px-4 py-3">{tc('name')}</th>
                  <th className="px-4 py-3">{t('col.position')}</th>
                  <th className="px-4 py-3">{t('col.department')}</th>
                  <th className="px-4 py-3">{t('col.employmentType')}</th>
                  <th className="px-4 py-3">{t('col.login')}</th>
                  <th className="px-4 py-3">{tc('status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {rows.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{e.registration ?? '—'}</td>
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                      <Link href={`/hr/employees/${e.id}`} className="hover:underline">
                        {e.fullName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{e.position ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{e.department ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{t(`employmentType.${e.employmentType}`)}</td>
                    <td className="px-4 py-3 text-xs">
                      {e.user ? (
                        <span className="text-green-700 dark:text-green-400">{e.user.email}</span>
                      ) : (
                        <span className="text-slate-400">{t('noLogin')}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[e.status]}`}>
                        {t(`status.${e.status}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {creating && (
        <EmployeeCreateModal
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await mutate();
          }}
        />
      )}
    </div>
  );
}

function EmployeeCreateModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('hr.employees');
  const tc = useTranslations('common');
  const [form, setForm] = useState<CreateEmployeeInput>({
    fullName: '',
    document: '',
    position: '',
    department: '',
    email: '',
    phone: '',
    employmentType: 'CLT',
    status: 'ACTIVE',
    hiredAt: '',
    baseSalary: null,
    workSchedule: '',
    provisionUser: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<{ email: string; initialPassword: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fullName.trim()) return setError(t('error.nameRequired'));
    if (form.provisionUser && !form.email?.trim())
      return setError(t('error.emailRequiredForLogin'));
    setSubmitting(true);
    setError(null);
    try {
      const payload: CreateEmployeeInput = {
        ...form,
        document: form.document || null,
        position: form.position || null,
        department: form.department || null,
        email: form.email || null,
        phone: form.phone || null,
        hiredAt: form.hiredAt || null,
        workSchedule: form.workSchedule || null,
      };
      const res = await hrApi.createEmployee(payload);
      if (res.provisionedUser) {
        setCredentials({
          email: res.provisionedUser.email,
          initialPassword: res.provisionedUser.initialPassword,
        });
      } else {
        onSaved();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : t('error.save'));
    } finally {
      setSubmitting(false);
    }
  }

  if (credentials) {
    return (
      <Modal open onClose={onSaved} title={t('credentials.title')}>
        <div className="space-y-3 text-sm">
          <p className="text-slate-600 dark:text-slate-300">
            {t('credentials.help')}
          </p>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 font-mono dark:border-slate-700 dark:bg-slate-900/40">
            <div>{tc('email')}: <strong>{credentials.email}</strong></div>
            <div>{t('credentials.password')}: <strong>{credentials.initialPassword}</strong></div>
          </div>
          <div className="flex justify-end">
            <Button onClick={onSaved}>{t('credentials.gotIt')}</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={t('new')} size="lg">
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Label htmlFor="fullName">{t('field.fullName')} *</Label>
            <Input id="fullName" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required />
          </div>
          <div>
            <Label htmlFor="document">{t('field.document')}</Label>
            <Input id="document" value={form.document ?? ''} onChange={(e) => setForm({ ...form, document: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="phone">{tc('phone')}</Label>
            <Input id="phone" value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="position">{t('field.position')}</Label>
            <Input id="position" value={form.position ?? ''} onChange={(e) => setForm({ ...form, position: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="department">{t('field.department')}</Label>
            <Input id="department" value={form.department ?? ''} onChange={(e) => setForm({ ...form, department: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="employmentType">{t('field.employmentType')}</Label>
            <select
              id="employmentType"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={form.employmentType}
              onChange={(e) => setForm({ ...form, employmentType: e.target.value as EmploymentType })}
            >
              {TYPES.map((type) => <option key={type} value={type}>{t(`employmentType.${type}`)}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="hiredAt">{t('field.hiredAt')}</Label>
            <Input id="hiredAt" type="date" value={form.hiredAt ?? ''} onChange={(e) => setForm({ ...form, hiredAt: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="baseSalary">{t('field.baseSalary')}</Label>
            <Input
              id="baseSalary"
              type="number"
              step="0.01"
              value={form.baseSalary ?? ''}
              onChange={(e) => setForm({ ...form, baseSalary: e.target.value ? Number(e.target.value) : null })}
            />
          </div>
          <div>
            <Label htmlFor="workSchedule">{t('field.workSchedule')}</Label>
            <Input id="workSchedule" placeholder={t('field.workSchedulePlaceholder')} value={form.workSchedule ?? ''} onChange={(e) => setForm({ ...form, workSchedule: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="email">{t('field.email')}</Label>
            <Input id="email" type="email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={form.provisionUser ?? false}
            onChange={(e) => setForm({ ...form, provisionUser: e.target.checked })}
          />
          {t('provisionUser')}
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>{tc('cancel')}</Button>
          <Button type="submit" loading={submitting}>{tc('save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

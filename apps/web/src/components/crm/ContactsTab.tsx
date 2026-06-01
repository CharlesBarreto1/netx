'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { FieldError, Input, Label, Select } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { api, ApiError } from '@/lib/api';
import { formatPhone } from '@/lib/format';
import { hasPermission } from '@/lib/session';
import {
  CONTACT_TYPES,
  CONTACT_TYPE_LABEL,
  type ContactType,
  type CustomerContact,
} from '@/lib/crm-types';

function contactValueDisplay(c: CustomerContact): string {
  if (c.type === 'PHONE' || c.type === 'MOBILE' || c.type === 'WHATSAPP') {
    return formatPhone(c.value);
  }
  return c.value;
}

export function ContactsTab({ customerId }: { customerId: string }) {
  const key = `/v1/customers/${customerId}/contacts`;
  const { data, isLoading, error, mutate } = useSWR<CustomerContact[]>(key);
  const canWrite = hasPermission('customers.update');
  const t = useTranslations('crmTabs');
  const tc = useTranslations('common');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerContact | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CustomerContact | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(c: CustomerContact) {
    setDeleting(true);
    try {
      await api.delete(`${key}/${c.id}`);
      await mutate();
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  if (isLoading) return <PageLoader />;
  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        {t('contacts.loadError')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {t('contacts.count', { count: data?.length ?? 0 })}
        </h3>
        {canWrite && (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            {t('contacts.add')}
          </Button>
        )}
      </div>

      {(!data || data.length === 0) && (
        <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
          {t('contacts.empty')}
        </p>
      )}

      <ul className="space-y-2">
        {data?.map((c) => (
          <li
            key={c.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="info">{CONTACT_TYPE_LABEL[c.type]}</Badge>
                {c.isPrimary && <Badge tone="success">{t('contacts.primary')}</Badge>}
                {c.isVerified && <Badge tone="brand">{t('contacts.verified')}</Badge>}
                {c.optIn && <Badge tone="neutral">{t('contacts.optIn')}</Badge>}
                {c.label && (
                  <span className="text-xs text-slate-500 dark:text-slate-400">· {c.label}</span>
                )}
              </div>
              <p className="mt-1 truncate text-sm text-slate-800 dark:text-slate-100">
                {contactValueDisplay(c)}
              </p>
            </div>
            {canWrite && (
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(c);
                    setOpen(true);
                  }}
                >
                  {tc('edit')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(c)}>
                  {tc('delete')}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <ContactFormModal
        open={open}
        onClose={() => setOpen(false)}
        customerId={customerId}
        contact={editing}
        onSaved={() => {
          setOpen(false);
          void mutate();
        }}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) return handleDelete(confirmDelete);
        }}
        title={t('contacts.deleteTitle')}
        message={t('contacts.deleteMessage', { value: confirmDelete?.value ?? '' })}
        confirmLabel={tc('delete')}
        variant="danger"
        loading={deleting}
      />
    </div>
  );
}

function ContactFormModal({
  open,
  onClose,
  customerId,
  contact,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  customerId: string;
  contact: CustomerContact | null;
  onSaved: () => void;
}) {
  const t = useTranslations('crmTabs');
  const tc = useTranslations('common');
  const [type, setType] = useState<ContactType>(contact?.type ?? 'EMAIL');
  const [value, setValue] = useState(contact?.value ?? '');
  const [label, setLabel] = useState(contact?.label ?? '');
  const [isPrimary, setIsPrimary] = useState(contact?.isPrimary ?? false);
  const [optIn, setOptIn] = useState(contact?.optIn ?? false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});

  useEffect(() => {
    setType(contact?.type ?? 'EMAIL');
    setValue(contact?.value ?? '');
    setLabel(contact?.label ?? '');
    setIsPrimary(contact?.isPrimary ?? false);
    setOptIn(contact?.optIn ?? false);
    setErr(null);
    setFieldErr({});
  }, [contact, open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setFieldErr({});
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        type,
        value,
        label: label || null,
        isPrimary,
        optIn,
      };
      if (contact) {
        await api.patch(`/v1/customers/${customerId}/contacts/${contact.id}`, body);
      } else {
        await api.post(`/v1/customers/${customerId}/contacts`, body);
      }
      onSaved();
    } catch (e) {
      if (e instanceof ApiError) {
        setErr(e.friendlyMessage);
        if (e.problem.errors) {
          const m: Record<string, string> = {};
          for (const f of e.problem.errors) m[f.path] = f.message;
          setFieldErr(m);
        }
      } else {
        setErr((e as Error).message);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={contact ? t('contacts.editTitle') : t('contacts.newTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {tc('cancel')}
          </Button>
          <Button form="contact-form" type="submit" loading={saving}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form id="contact-form" onSubmit={submit} className="space-y-3">
        {err && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {err}
          </div>
        )}
        <div>
          <Label required>{tc('type')}</Label>
          <Select value={type} onChange={(e) => setType(e.target.value as ContactType)}>
            {CONTACT_TYPES.map((ct) => (
              <option key={ct} value={ct}>
                {CONTACT_TYPE_LABEL[ct]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label required>{t('contacts.value')}</Label>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            placeholder={type === 'EMAIL' ? t('contacts.emailPlaceholder') : '+55 11 99999-8888'}
          />
          <FieldError>{fieldErr.value}</FieldError>
        </div>
        <div>
          <Label>{t('contacts.label')}</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('contacts.labelPlaceholder')} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isPrimary}
            onChange={(e) => setIsPrimary(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          {t('contacts.primaryOfType')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={optIn}
            onChange={(e) => setOptIn(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          {t('contacts.optInLabel')}
        </label>
      </form>
    </Modal>
  );
}

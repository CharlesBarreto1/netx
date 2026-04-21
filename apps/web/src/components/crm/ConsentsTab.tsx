'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FieldError, Input, Label, Select, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { hasPermission } from '@/lib/session';
import {
  CONSENT_METHOD_LABEL,
  CONSENT_METHODS,
  CONSENT_PURPOSE_LABEL,
  CONSENT_PURPOSES,
  CONSENT_STATUS_LABEL,
  CONSENT_STATUSES,
  type ConsentMethod,
  type ConsentPurpose,
  type ConsentStatus,
  type CustomerConsent,
} from '@/lib/crm-types';

function consentTone(s: ConsentStatus) {
  switch (s) {
    case 'GRANTED':
      return 'success' as const;
    case 'REVOKED':
      return 'danger' as const;
    case 'EXPIRED':
      return 'warning' as const;
    default:
      return 'neutral' as const;
  }
}

export function ConsentsTab({ customerId }: { customerId: string }) {
  const key = `/v1/customers/${customerId}/consents`;
  const { data, isLoading, error, mutate } = useSWR<CustomerConsent[]>(key);
  const canManage = hasPermission('customers.consents.manage');
  const [open, setOpen] = useState(false);

  if (isLoading) return <PageLoader />;
  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        Falha ao carregar consentimentos.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Histórico imutável — {data?.length ?? 0} registro(s)
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Cada registro é uma evidência LGPD/GDPR com IP e User-Agent capturados.
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setOpen(true)}>
            Registrar consentimento
          </Button>
        )}
      </div>

      {(!data || data.length === 0) && (
        <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
          Nenhum consentimento registrado.
        </p>
      )}

      <ul className="space-y-2">
        {data?.map((c) => (
          <li
            key={c.id}
            className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={consentTone(c.status)}>{CONSENT_STATUS_LABEL[c.status]}</Badge>
              <strong className="text-sm">{CONSENT_PURPOSE_LABEL[c.purpose]}</strong>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                via {CONSENT_METHOD_LABEL[c.method]}
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Registrado em {formatDateTime(c.createdAt)}
              {c.grantedAt && ` · Concedido em ${formatDateTime(c.grantedAt)}`}
              {c.revokedAt && ` · Revogado em ${formatDateTime(c.revokedAt)}`}
              {c.expiresAt && ` · Expira em ${formatDateTime(c.expiresAt)}`}
            </div>
            {c.policyVersion && (
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Política: <code className="font-mono">{c.policyVersion}</code>
              </div>
            )}
            {c.notes && (
              <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">{c.notes}</p>
            )}
            {(c.sourceIp || c.sourceUserAgent) && (
              <details className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                <summary className="cursor-pointer select-none">Evidência técnica</summary>
                <div className="mt-1 space-y-0.5">
                  {c.sourceIp && <div>IP: {c.sourceIp}</div>}
                  {c.sourceUserAgent && (
                    <div className="break-all">User-Agent: {c.sourceUserAgent}</div>
                  )}
                  {c.evidenceUrl && (
                    <div>
                      URL:{' '}
                      <a href={c.evidenceUrl} className="underline" target="_blank" rel="noreferrer">
                        {c.evidenceUrl}
                      </a>
                    </div>
                  )}
                </div>
              </details>
            )}
          </li>
        ))}
      </ul>

      <ConsentFormModal
        open={open}
        onClose={() => setOpen(false)}
        customerId={customerId}
        onSaved={() => {
          setOpen(false);
          void mutate();
        }}
      />
    </div>
  );
}

function ConsentFormModal({
  open,
  onClose,
  customerId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  customerId: string;
  onSaved: () => void;
}) {
  const [purpose, setPurpose] = useState<ConsentPurpose>('MARKETING_EMAIL');
  const [status, setStatus] = useState<ConsentStatus>('GRANTED');
  const [method, setMethod] = useState<ConsentMethod>('WEB_FORM');
  const [policyVersion, setPolicyVersion] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setPurpose('MARKETING_EMAIL');
      setStatus('GRANTED');
      setMethod('WEB_FORM');
      setPolicyVersion('');
      setEvidenceUrl('');
      setNotes('');
      setExpiresAt('');
      setErr(null);
      setFieldErr({});
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setFieldErr({});
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        purpose,
        status,
        method,
        policyVersion: policyVersion || null,
        evidenceUrl: evidenceUrl || null,
        notes: notes || null,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      };
      await api.post(`/v1/customers/${customerId}/consents`, body);
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
      title="Registrar consentimento"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button form="consent-form" type="submit" loading={saving}>
            Registrar
          </Button>
        </>
      }
    >
      <form id="consent-form" onSubmit={submit} className="space-y-3">
        {err && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {err}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <Label required>Finalidade</Label>
            <Select value={purpose} onChange={(e) => setPurpose(e.target.value as ConsentPurpose)}>
              {CONSENT_PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {CONSENT_PURPOSE_LABEL[p]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label required>Status</Label>
            <Select value={status} onChange={(e) => setStatus(e.target.value as ConsentStatus)}>
              {CONSENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {CONSENT_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Método de captura</Label>
            <Select value={method} onChange={(e) => setMethod(e.target.value as ConsentMethod)}>
              {CONSENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {CONSENT_METHOD_LABEL[m]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Versão da política</Label>
            <Input
              value={policyVersion}
              onChange={(e) => setPolicyVersion(e.target.value)}
              placeholder="v2026.1"
            />
          </div>
          <div className="md:col-span-2">
            <Label>URL de evidência</Label>
            <Input
              value={evidenceUrl}
              onChange={(e) => setEvidenceUrl(e.target.value)}
              placeholder="https://…"
            />
            <FieldError>{fieldErr.evidenceUrl}</FieldError>
          </div>
          <div>
            <Label>Expira em</Label>
            <Input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
          <div className="md:col-span-3">
            <Label>Observações</Label>
            <Textarea rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </form>
    </Modal>
  );
}

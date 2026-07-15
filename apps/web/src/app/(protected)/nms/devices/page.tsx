'use client';

/**
 * /nms/devices — Roteadores gerenciados pelo NMS, DENTRO do shell do NetX.
 *
 * É o módulo NMS (apps/nms) embutido no ecossistema: as chamadas vão pro gateway
 * em /v1/nms/* (canal 4), com SSO (o JWT do operador do NetX é aceito pelo NMS)
 * e entitlement netx-nms checado no gateway. Cadastra Juniper e Mikrotik —
 * mesmo MK que o NetX usa como BNG, aqui como device de rede (saúde/backup/SSH).
 *
 * Ver docs/ecosystem/INTEGRATION-RUNBOOK.md §A.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { FieldHelp, Input, Label, Select } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  NMS_VENDORS,
  nmsApi,
  type CreateNmsDeviceRequest,
  type NmsDevice,
  type NmsVendor,
  type UpdateNmsDeviceRequest,
} from '@/lib/nms-api';

interface FormState {
  hostname: string;
  mgmtIp: string;
  vendor: NmsVendor;
  model: string;
  site: string;
  username: string;
  password: string;
  snmpCommunity: string;
}

const EMPTY_FORM: FormState = {
  hostname: '',
  mgmtIp: '',
  vendor: 'mikrotik',
  model: '',
  site: '',
  username: '',
  password: '',
  snmpCommunity: '',
};

function vendorLabel(v: NmsVendor): string {
  return NMS_VENDORS.find((x) => x.value === v)?.label ?? v;
}

export default function NmsDevicesPage() {
  const t = useTranslations('nms');
  const tCommon = useTranslations('common');
  const canManage = hasPermission('users.write') || hasPermission('network.write');
  const { data, error, isLoading, mutate } = useSWR<NmsDevice[], unknown>(
    'nms-devices',
    () => nmsApi.listDevices(),
    { shouldRetryOnError: false },
  );

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<NmsDevice | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<NmsDevice | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(d: NmsDevice) {
    setEditing(d);
    // Credenciais não voltam do cofre — ficam em branco; preencher só se quiser trocar.
    setForm({
      hostname: d.hostname,
      mgmtIp: d.mgmtIp,
      vendor: d.vendor,
      model: d.model ?? '',
      site: d.site ?? '',
      username: '',
      password: '',
      snmpCommunity: '',
    });
    setOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.hostname.trim() || !form.mgmtIp.trim()) {
      toast.error(t('toast.hostnameIpRequired'));
      return;
    }
    setSaving(true);
    try {
      const fields = {
        hostname: form.hostname.trim(),
        mgmtIp: form.mgmtIp.trim(),
        vendor: form.vendor,
        model: form.model.trim() || undefined,
        site: form.site.trim() || undefined,
      };

      let device: NmsDevice;
      if (editing) {
        device = await nmsApi.updateDevice(editing.id, fields satisfies UpdateNmsDeviceRequest);
      } else {
        device = await nmsApi.createDevice(fields satisfies CreateNmsDeviceRequest);
      }

      // Credenciais opcionais; se preencheu usuário, (re)grava no cofre do NMS.
      if (form.username.trim()) {
        await nmsApi.setCredentials(device.id, {
          username: form.username.trim(),
          password: form.password.trim() || undefined,
          snmpCommunity: form.snmpCommunity.trim() || undefined,
        });
      }
      toast.success(
        editing
          ? t('toast.updated', { hostname: device.hostname })
          : t('toast.created', { hostname: device.hostname }),
      );
      setOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      await mutate();
    } catch (err) {
      const fallback = editing ? t('toast.updateFailed') : t('toast.createFailed');
      toast.error(err instanceof ApiError ? err.message : fallback);
    } finally {
      setSaving(false);
    }
  }

  async function onTest(d: NmsDevice) {
    setTesting(d.id);
    try {
      const r = await nmsApi.connectivityTest(d.id);
      const parts = (['ssh', 'netconf', 'snmp'] as const)
        .filter((k) => r[k])
        .map((k) => `${k.toUpperCase()}: ${r[k]?.ok ? t('test.ok') : t('test.failed')}`);
      toast.success(
        t('toast.testResult', {
          hostname: d.hostname,
          result: parts.join(' · ') || t('test.queued'),
        }),
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('toast.testFailed'));
    } finally {
      setTesting(null);
    }
  }

  async function onDelete() {
    if (!toDelete) return;
    try {
      await nmsApi.deleteDevice(toDelete.id);
      toast.success(t('toast.removed', { hostname: toDelete.hostname }));
      await mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('toast.removeFailed'));
    } finally {
      setToDelete(null);
    }
  }

  // Estados de borda: módulo não licenciado (403) ou NMS fora do ar (502).
  const apiErr = error as ApiError | undefined;
  const notEntitled = apiErr?.status === 403;
  const unreachable = apiErr?.status === 502 || apiErr?.status === 503;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
          <p className="text-sm text-text-muted">{t('subtitle')}</p>
        </div>
        {canManage && !notEntitled && !unreachable && (
          <Button variant="primary" onClick={openCreate}>
            {t('addRouter')}
          </Button>
        )}
      </header>

      {isLoading && <PageLoader />}

      {notEntitled && (
        <div className="rounded-md border border-border bg-surface-muted p-6 text-sm text-text-muted">
          {t.rich('notEntitled', { strong: (chunks) => <strong>{chunks}</strong> })}
        </div>
      )}

      {unreachable && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-6 text-sm text-text">
          {t.rich('unreachable', { strong: (chunks) => <strong>{chunks}</strong> })}
        </div>
      )}

      {data && !isLoading && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">{t('table.hostname')}</th>
                <th className="px-4 py-2 font-medium">{t('table.mgmtIp')}</th>
                <th className="px-4 py-2 font-medium">{t('table.vendor')}</th>
                <th className="px-4 py-2 font-medium">{t('table.model')}</th>
                <th className="px-4 py-2 font-medium">{t('table.site')}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-text-muted">
                    {t('emptyState')}
                  </td>
                </tr>
              )}
              {data.map((d) => (
                <tr key={d.id} className="border-t border-border">
                  <td className="px-4 py-2 font-medium">
                    <Link
                      href={`/nms/devices/${d.id}`}
                      className="text-brand-700 hover:underline dark:text-brand-300"
                    >
                      {d.hostname}
                    </Link>
                  </td>
                  <td className="px-4 py-2 font-mono text-text-muted">{d.mgmtIp}</td>
                  <td className="px-4 py-2">{vendorLabel(d.vendor)}</td>
                  <td className="px-4 py-2 text-text-muted">{d.model || '—'}</td>
                  <td className="px-4 py-2 text-text-muted">{d.site || '—'}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/nms/devices/${d.id}`}
                        className="inline-flex items-center rounded-md px-2 py-1 text-sm font-medium text-brand-700 hover:bg-slate-100 dark:text-brand-300 dark:hover:bg-slate-800"
                      >
                        Abrir painel
                      </Link>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={testing === d.id}
                        onClick={() => void onTest(d)}
                      >
                        {t('testConnection')}
                      </Button>
                      {canManage && (
                        <Button variant="ghost" size="sm" onClick={() => openEdit(d)}>
                          {tCommon('edit')}
                        </Button>
                      )}
                      {canManage && (
                        <Button variant="ghost" size="sm" onClick={() => setToDelete(d)}>
                          {tCommon('delete')}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? t('modal.editTitle') : t('modal.title')}
        description={t('modal.description')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button variant="primary" loading={saving} onClick={onSubmit}>
              {editing ? tCommon('save') : t('modal.submit')}
            </Button>
          </div>
        }
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{t('form.hostname')}</Label>
              <Input
                value={form.hostname}
                onChange={(e) => set('hostname', e.target.value)}
                placeholder="rb-core-01"
                autoFocus
              />
            </div>
            <div>
              <Label>{t('form.mgmtIp')}</Label>
              <Input
                value={form.mgmtIp}
                onChange={(e) => set('mgmtIp', e.target.value)}
                placeholder="10.0.0.1"
              />
            </div>
            <div>
              <Label>{t('form.vendor')}</Label>
              <Select value={form.vendor} onChange={(e) => set('vendor', e.target.value as NmsVendor)}>
                {NMS_VENDORS.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>{t('form.model')}</Label>
              <Input
                value={form.model}
                onChange={(e) => set('model', e.target.value)}
                placeholder="CCR2004 / MX80"
              />
            </div>
            <div className="col-span-2">
              <Label>{t('form.site')}</Label>
              <Input
                value={form.site}
                onChange={(e) => set('site', e.target.value)}
                placeholder={t('form.sitePlaceholder')}
              />
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <p className="mb-2 text-sm font-medium text-text">{t('form.credentials')}</p>
            <FieldHelp>{t('form.credentialsHelp')}</FieldHelp>
            <div className="mt-3 grid grid-cols-3 gap-4">
              <div>
                <Label>{t('form.sshUser')}</Label>
                <Input value={form.username} onChange={(e) => set('username', e.target.value)} />
              </div>
              <div>
                <Label>{t('form.password')}</Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                />
              </div>
              <div>
                <Label>{t('form.snmpCommunity')}</Label>
                <Input
                  value={form.snmpCommunity}
                  onChange={(e) => set('snmpCommunity', e.target.value)}
                  placeholder="public"
                />
              </div>
            </div>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={onDelete}
        title={t('confirmDelete.title')}
        message={t('confirmDelete.message', { hostname: toDelete?.hostname ?? '' })}
        confirmLabel={t('confirmDelete.confirm')}
        variant="danger"
      />
    </div>
  );
}

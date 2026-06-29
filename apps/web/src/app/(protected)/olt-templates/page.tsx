'use client';

/**
 * /olt-templates — CRUD de templates de provisionamento de OLT (Fase 2).
 *
 * O template é estruturado: perfis de banda por NOME (que já existem na OLT) +
 * lista de VLANs com papel (dados/gerência) + protocolo. O driver Zyxel
 * renderiza o bloco CLI a partir disso. Vínculo: default por OLT (no cadastro
 * da OLT) e override por plano. Restrito a `olts.admin`.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Input, Label, Select } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  provisioningProfilesApi,
  type CreateProvisioningProfileRequest,
  type ProfileVlan,
  type ProvisioningProfile,
} from '@/lib/provisioning-api';

type VlanDraft = Omit<ProfileVlan, 'id'>;

function blankProfile(): CreateProvisioningProfileRequest {
  return {
    name: '',
    description: '',
    vendor: 'ZYXEL',
    ontPassword: 'DEFAULT',
    fullBridge: false,
    bwUpProfileName: 'ZUX-MAX-US',
    bwDownProfileName: 'ZUX-MAX-DS',
    bwGroupId: 1,
    uniPort: '2-1',
    serviceProtocol: 'PPPOE',
    queueTc: 1,
    queuePriority: 0,
    queueWeight: 0,
    ingressProfile: 'DEFVAL',
    vlans: [
      { vid: 333, role: 'DATA', tagged: true, isPvid: true, isProtocolBased: true, order: 0 },
      { vid: 33, role: 'MGMT', tagged: true, isPvid: false, isProtocolBased: false, order: 1 },
    ],
  };
}

export default function OltTemplatesPage() {
  const t = useTranslations('oltTemplates');
  const tCommon = useTranslations('common');
  const canAdmin = hasPermission('olts.admin');
  const { data, isLoading, mutate } = useSWR('olt-provisioning-profiles', () =>
    provisioningProfilesApi.list({ pageSize: 100 }),
  );
  const [editing, setEditing] = useState<ProvisioningProfile | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ProvisioningProfile | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (isLoading) return <PageLoader />;
  const profiles = data?.data ?? [];

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await provisioningProfilesApi.remove(confirmDelete.id);
      toast.success(t('toast.deleted', { name: confirmDelete.name }));
      setConfirmDelete(null);
      await mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : t('toast.deleteError'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('subtitle')}
          </p>
        </div>
        {canAdmin && <Button onClick={() => setCreating(true)}>{t('newTemplate')}</Button>}
      </header>

      {profiles.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          {t('empty')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{tCommon('name')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('table.vendor')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('table.bandwidth')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('table.vlans')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('table.usage')}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2 font-medium">{p.name}</td>
                  <td className="px-3 py-2">{p.vendor}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {p.bwUpProfileName} / {p.bwDownProfileName}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {p.vlans
                      .map((v) => `${v.vid}${v.isPvid ? '*' : ''}${v.role === 'MGMT' ? '(m)' : ''}`)
                      .join(', ')}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {t('usage.olts', { count: p.defaultForOltsCount ?? 0 })} ·{' '}
                    {t('usage.plans', { count: p.plansCount ?? 0 })}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {canAdmin && (
                      <>
                        <button className="text-blue-600 hover:underline" onClick={() => setEditing(p)}>
                          {tCommon('edit')}
                        </button>
                        <button
                          className="ml-3 text-red-600 hover:underline"
                          onClick={() => setConfirmDelete(p)}
                        >
                          {tCommon('delete')}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <TemplateFormModal
          profile={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            await mutate();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          open
          title={t('deleteDialog.title')}
          message={t('deleteDialog.message', { name: confirmDelete.name })}
          confirmLabel={tCommon('delete')}
          variant="danger"
          loading={deleting}
          onConfirm={handleDelete}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

interface FormProps {
  profile: ProvisioningProfile | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

function TemplateFormModal({ profile, onClose, onSaved }: FormProps) {
  const t = useTranslations('oltTemplates');
  const tCommon = useTranslations('common');
  const [form, setForm] = useState<CreateProvisioningProfileRequest>(() =>
    profile
      ? {
          name: profile.name,
          description: profile.description ?? '',
          vendor: profile.vendor,
          ontPassword: profile.ontPassword,
          fullBridge: profile.fullBridge,
          bwUpProfileName: profile.bwUpProfileName,
          bwDownProfileName: profile.bwDownProfileName,
          bwGroupId: profile.bwGroupId,
          uniPort: profile.uniPort,
          serviceProtocol: profile.serviceProtocol,
          queueTc: profile.queueTc,
          queuePriority: profile.queuePriority,
          queueWeight: profile.queueWeight,
          ingressProfile: profile.ingressProfile,
          vlans: profile.vlans.map((v) => ({
            vid: v.vid,
            role: v.role,
            tagged: v.tagged,
            isPvid: v.isPvid,
            isProtocolBased: v.isProtocolBased,
            order: v.order,
          })),
        }
      : blankProfile(),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof CreateProvisioningProfileRequest>(
    k: K,
    v: CreateProvisioningProfileRequest[K],
  ) => setForm((f) => ({ ...f, [k]: v }));

  const setVlan = (i: number, patch: Partial<VlanDraft>) =>
    setForm((f) => ({
      ...f,
      vlans: f.vlans.map((v, idx) => (idx === i ? { ...v, ...patch } : v)),
    }));

  const addVlan = () =>
    setForm((f) => ({
      ...f,
      vlans: [
        ...f.vlans,
        { vid: 0, role: 'DATA', tagged: true, isPvid: false, isProtocolBased: false, order: f.vlans.length },
      ],
    }));

  const removeVlan = (i: number) =>
    setForm((f) => ({ ...f, vlans: f.vlans.filter((_, idx) => idx !== i) }));

  // PVID e protocol-based são exclusivos (no máx 1 cada) — marcar um desmarca os outros.
  const setExclusive = (i: number, key: 'isPvid' | 'isProtocolBased', value: boolean) =>
    setForm((f) => ({
      ...f,
      vlans: f.vlans.map((v, idx) => ({
        ...v,
        [key]: idx === i ? value : value ? false : v[key],
      })),
    }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (profile) {
        await provisioningProfilesApi.update(profile.id, form);
      } else {
        await provisioningProfilesApi.create(form);
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('form.saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={profile ? t('form.editTitle') : t('form.createTitle')}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="name">{t('form.name')}</Label>
            <Input id="name" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="ZUX Residencial PPPoE" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="desc">{tCommon('description')}</Label>
            <Input id="desc" value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="bwUp">{t('form.bwUp')}</Label>
            <Input id="bwUp" required value={form.bwUpProfileName} onChange={(e) => set('bwUpProfileName', e.target.value)} placeholder="ZUX-MAX-US" />
          </div>
          <div>
            <Label htmlFor="bwDown">{t('form.bwDown')}</Label>
            <Input id="bwDown" required value={form.bwDownProfileName} onChange={(e) => set('bwDownProfileName', e.target.value)} placeholder="ZUX-MAX-DS" />
          </div>
          <div>
            <Label htmlFor="proto">{t('form.protocol')}</Label>
            <Select id="proto" value={form.serviceProtocol} onChange={(e) => set('serviceProtocol', e.target.value as CreateProvisioningProfileRequest['serviceProtocol'])}>
              <option value="PPPOE">PPPoE</option>
              <option value="IPOE">IPoE</option>
              <option value="BRIDGE">Bridge</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="uniPort">{t('form.uniPort')}</Label>
            <Input id="uniPort" value={form.uniPort} onChange={(e) => set('uniPort', e.target.value)} placeholder="2-1" />
          </div>
          <div>
            <Label htmlFor="ontPass">{t('form.ontPassword')}</Label>
            <Input id="ontPass" value={form.ontPassword} onChange={(e) => set('ontPassword', e.target.value)} placeholder="DEFAULT" />
          </div>
          <div>
            <Label htmlFor="ingprof">{t('form.ingressProfile')}</Label>
            <Input id="ingprof" value={form.ingressProfile} onChange={(e) => set('ingressProfile', e.target.value)} placeholder="DEFVAL" />
          </div>
        </div>

        <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase text-slate-500">{t('vlans.heading')}</h3>
            <button type="button" className="text-xs text-blue-600 hover:underline" onClick={addVlan}>
              {t('vlans.add')}
            </button>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-2 text-[10px] font-medium uppercase text-slate-400">
              <span className="col-span-2">VID</span>
              <span className="col-span-3">{t('vlans.role')}</span>
              <span className="col-span-2">Tag</span>
              <span className="col-span-2">PVID</span>
              <span className="col-span-2">Proto</span>
              <span className="col-span-1"></span>
            </div>
            {form.vlans.map((v, i) => (
              <div key={i} className="grid grid-cols-12 items-center gap-2">
                <Input
                  className="col-span-2"
                  type="number"
                  value={v.vid || ''}
                  onChange={(e) => setVlan(i, { vid: Number(e.target.value) })}
                  placeholder="333"
                />
                <Select
                  className="col-span-3"
                  value={v.role}
                  onChange={(e) => setVlan(i, { role: e.target.value as ProfileVlan['role'] })}
                >
                  <option value="DATA">{t('vlans.roleData')}</option>
                  <option value="MGMT">{t('vlans.roleMgmt')}</option>
                </Select>
                <label className="col-span-2 flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={v.tagged} onChange={(e) => setVlan(i, { tagged: e.target.checked })} />
                  tag
                </label>
                <label className="col-span-2 flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={v.isPvid} onChange={(e) => setExclusive(i, 'isPvid', e.target.checked)} />
                  pvid
                </label>
                <label className="col-span-2 flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={v.isProtocolBased}
                    onChange={(e) => setExclusive(i, 'isProtocolBased', e.target.checked)}
                  />
                  proto
                </label>
                <button
                  type="button"
                  className="col-span-1 text-red-500 hover:text-red-700"
                  onClick={() => removeVlan(i)}
                  aria-label={t('vlans.remove')}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            {t('vlans.hint')}
          </p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>{tCommon('cancel')}</Button>
          <Button type="submit" disabled={saving}>{saving ? tCommon('saving') : tCommon('save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

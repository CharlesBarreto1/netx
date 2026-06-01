'use client';

import dynamic from 'next/dynamic';
import { CheckCircle2, Plus, Plug, RefreshCw, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import type { LatLng } from '@/components/mapping/LocationPicker';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { FieldHelp, Input, Label, Select, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  networkApi,
  type DisconnectStrategy,
  type EquipmentType,
  type EquipmentVendor,
  type NetworkEquipment,
  type NetworkPop,
  type CreateEquipmentInput,
  type TestConnectionStrategyResult,
} from '@/lib/network-api';
import { hasPermission } from '@/lib/session';

const LocationPicker = dynamic(
  () =>
    import('@/components/mapping/LocationPicker').then((m) => m.LocationPicker),
  {
    ssr: false,
    loading: () => (
      <div className="h-[320px] animate-pulse rounded-md bg-surface-muted" />
    ),
  },
);

const DISCONNECT_STRATEGIES: { value: DisconnectStrategy; labelKey: string; helpKey: string }[] = [
  { value: 'AUTO', labelKey: 'strategyAuto', helpKey: 'strategyAutoHelp' },
  { value: 'COA', labelKey: 'strategyCoa', helpKey: 'strategyCoaHelp' },
  { value: 'MIKROTIK_API', labelKey: 'strategyRouterOs', helpKey: 'strategyRouterOsHelp' },
  { value: 'SSH', labelKey: 'strategySsh', helpKey: 'strategySshHelp' },
];

const TYPES: EquipmentType[] = ['BNG', 'OLT', 'ROUTER', 'SWITCH', 'OTHER'];
const TYPE_LABEL_KEY: Record<EquipmentType, string> = {
  BNG: 'typeBng',
  OLT: 'typeOlt',
  ROUTER: 'typeRouter',
  SWITCH: 'typeSwitch',
  OTHER: 'typeOther',
};
const TYPE_TONE: Record<EquipmentType, 'success' | 'info' | 'warning' | 'neutral'> = {
  BNG: 'success',
  OLT: 'info',
  ROUTER: 'warning',
  SWITCH: 'neutral',
  OTHER: 'neutral',
};
const VENDORS: EquipmentVendor[] = [
  'MIKROTIK',
  'HUAWEI',
  'ZTE',
  'FIBERHOME',
  'CISCO',
  'JUNIPER',
  'OTHER',
];

export default function EquipmentPage() {
  const t = useTranslations('network.equipment');
  const tc = useTranslations('common');
  const canWrite = hasPermission('network.write');
  const canDelete = hasPermission('network.delete');

  const [typeFilter, setTypeFilter] = useState<EquipmentType | ''>('');
  const { data, isLoading, mutate } = useSWR<NetworkEquipment[]>(
    networkApi.equipmentListPath(typeFilter ? { type: typeFilter } : undefined),
  );
  const { data: pops } = useSWR<NetworkPop[]>(networkApi.popsListPath());
  const [editing, setEditing] = useState<NetworkEquipment | 'new' | null>(null);
  const [deleting, setDeleting] = useState<NetworkEquipment | null>(null);

  if (isLoading && !data) return <PageLoader />;
  const items = data ?? [];

  async function resync() {
    try {
      const res = await networkApi.resyncBngs();
      toast.success(t('resyncDone', { synced: res.synced, total: res.totalBngs }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-text-muted">{t('subtitle')}</p>
        </div>
        <div className="flex gap-2">
          {canWrite && (
            <Button variant="outline" size="sm" onClick={resync} title={t('resyncTooltip')}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t('resyncRadius')}
            </Button>
          )}
          {canWrite && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="h-3.5 w-3.5" />
              {t('newEquipment')}
            </Button>
          )}
        </div>
      </header>

      <div className="flex gap-3">
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as EquipmentType | '')}
          className="w-44"
        >
          <option value="">{t('allTypes')}</option>
          {TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {t(TYPE_LABEL_KEY[ty])}
            </option>
          ))}
        </Select>
      </div>

      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <tr>
              <th className="px-3 py-2">{tc('type')}</th>
              <th className="px-3 py-2">{tc('name')}</th>
              <th className="px-3 py-2">{t('vendor')}</th>
              <th className="px-3 py-2">{t('ip')}</th>
              <th className="px-3 py-2">{t('pop')}</th>
              <th className="px-3 py-2">{tc('status')}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-text-muted">
                  {t('empty')}
                </td>
              </tr>
            ) : (
              items.map((e) => (
                <tr key={e.id} className="hover:bg-surface-hover">
                  <td className="px-3 py-2">
                    <Badge tone={TYPE_TONE[e.type]}>{t(TYPE_LABEL_KEY[e.type])}</Badge>
                  </td>
                  <td className="px-3 py-2 font-medium">{e.name}</td>
                  <td className="px-3 py-2 text-xs text-text-muted">{e.vendor}</td>
                  <td className="px-3 py-2 font-mono text-xs">{e.ipAddress}</td>
                  <td className="px-3 py-2 text-xs text-text-muted">
                    {e.pop?.name ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={e.isActive ? 'success' : 'neutral'}>
                      {e.isActive ? t('active') : t('inactive')}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canWrite && (
                      <Button size="xs" variant="ghost" onClick={() => setEditing(e)}>
                        {tc('edit')}
                      </Button>
                    )}
                    {canDelete && (
                      <Button size="xs" variant="ghost" onClick={() => setDeleting(e)}>
                        {tc('delete')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <EquipmentFormDialog
          initial={editing === 'new' ? null : editing}
          pops={pops ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            void mutate();
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await networkApi.deleteEquipment(deleting.id);
            toast.success(t('deleted'));
            setDeleting(null);
            await mutate();
          } catch (err) {
            toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
          }
        }}
        title={t('deleteTitle')}
        message={
          deleting?.type === 'BNG'
            ? t('deleteBngConfirm', { name: deleting?.name ?? '' })
            : t('deleteConfirm', { name: deleting?.name ?? '' })
        }
        confirmLabel={tc('delete')}
        variant="danger"
      />
    </div>
  );
}

function EquipmentFormDialog({
  initial,
  pops,
  onClose,
  onSaved,
}: {
  initial: NetworkEquipment | null;
  pops: NetworkPop[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('network.equipment');
  const tc = useTranslations('common');
  const isNew = !initial;
  const [form, setForm] = useState<CreateEquipmentInput>({
    type: initial?.type ?? 'BNG',
    vendor: initial?.vendor ?? 'MIKROTIK',
    name: initial?.name ?? '',
    hostname: initial?.hostname ?? '',
    ipAddress: initial?.ipAddress ?? '',
    popId: initial?.popId ?? null,
    radiusSecret: initial?.radiusSecret ?? '',
    radiusNasType: initial?.radiusNasType ?? 'mikrotik',
    snmpCommunity: initial?.snmpCommunity ?? '',
    snmpVersion: initial?.snmpVersion ?? 'v2c',
    disconnectStrategy: initial?.disconnectStrategy ?? 'AUTO',
    coaPort: initial?.coaPort ?? null,
    apiHost: initial?.apiHost ?? '',
    apiPort: initial?.apiPort ?? 8728,
    apiUser: initial?.apiUser ?? '',
    apiPassword: '',
    apiTlsEnabled: initial?.apiTlsEnabled ?? false,
    sshHost: initial?.sshHost ?? '',
    sshPort: initial?.sshPort ?? 22,
    sshUser: initial?.sshUser ?? '',
    sshPassword: '',
    sshKeyName: initial?.sshKeyName ?? '',
    sshDisconnectCmd: initial?.sshDisconnectCmd ?? '',
    notes: initial?.notes ?? '',
    isActive: initial?.isActive ?? true,
  });
  // Geolocalização do equipamento (módulo Rede). Independente do POP — admin
  // pode marcar coord exata mesmo que o POP-pai tenha outra.
  const [location, setLocation] = useState<LatLng | null>(
    initial?.latitude != null && initial?.longitude != null
      ? { latitude: initial.latitude, longitude: initial.longitude }
      : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<TestConnectionStrategyResult[] | null>(null);

  async function handleTestConnection() {
    if (!initial) {
      toast.error(t('saveFirstToTest'));
      return;
    }
    setTesting(true);
    setTestResults(null);
    try {
      const res = await networkApi.testConnection(initial.id);
      setTestResults(res.results);
      const allOk = res.results.every((r) => r.ok);
      if (allOk) toast.success(t('allStrategiesOk'));
      else toast.error(t('someStrategiesFailed'));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setTesting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return setError(t('errNameRequired'));
    if (!form.ipAddress.trim()) return setError(t('errIpRequired'));
    if (form.type === 'BNG' && (!form.radiusSecret || form.radiusSecret.length < 4)) {
      return setError(t('errRadiusSecret'));
    }
    setSubmitting(true);
    try {
      // Senhas vazias = não tocar no que está cifrado no banco
      // (undefined = "manter atual", string vazia também — backend trata).
      const payload: CreateEquipmentInput = {
        ...form,
        apiPassword: form.apiPassword || undefined,
        sshPassword: form.sshPassword || undefined,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
      };

      if (isNew) {
        await networkApi.createEquipment(payload);
      } else {
        await networkApi.updateEquipment(initial!.id, payload);
      }
      toast.success(isNew ? t('created') : t('updated'));
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? t('newTitle') : t('editTitle', { name: initial!.name })}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {tc('cancel')}
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label required>{tc('type')}</Label>
            <Select
              value={form.type}
              onChange={(e) =>
                setForm({ ...form, type: e.target.value as EquipmentType })
              }
            >
              {TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t(TYPE_LABEL_KEY[ty])}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>{t('vendor')}</Label>
            <Select
              value={form.vendor}
              onChange={(e) =>
                setForm({ ...form, vendor: e.target.value as EquipmentVendor })
              }
            >
              {VENDORS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label required>{tc('name')}</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="BNG-Asuncion-01"
              autoFocus
            />
          </div>
          <div>
            <Label>{t('hostname')}</Label>
            <Input
              value={form.hostname}
              onChange={(e) => setForm({ ...form, hostname: e.target.value })}
              placeholder="bng01.netx.local"
            />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label required>{t('mgmtIp')}</Label>
            <Input
              value={form.ipAddress}
              onChange={(e) => setForm({ ...form, ipAddress: e.target.value })}
              placeholder="10.33.33.102"
            />
            <FieldHelp>{t('mgmtIpHelp')}</FieldHelp>
          </div>
          <div>
            <Label>{t('pop')}</Label>
            <Select
              value={form.popId ?? ''}
              onChange={(e) =>
                setForm({ ...form, popId: e.target.value || null })
              }
            >
              <option value="">{t('noPop')}</option>
              {pops.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* Bloco RADIUS — só pra BNG */}
        {form.type === 'BNG' && (
          <div className="rounded-md border border-dashed border-border bg-surface-muted p-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              RADIUS
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label required>{t('sharedSecret')}</Label>
                <Input
                  value={form.radiusSecret}
                  onChange={(e) =>
                    setForm({ ...form, radiusSecret: e.target.value })
                  }
                  placeholder={t('sharedSecretPlaceholder')}
                />
                <FieldHelp>{t('sharedSecretHelp')}</FieldHelp>
              </div>
              <div>
                <Label>{t('nasType')}</Label>
                <Select
                  value={form.radiusNasType ?? 'mikrotik'}
                  onChange={(e) =>
                    setForm({ ...form, radiusNasType: e.target.value })
                  }
                >
                  <option value="mikrotik">mikrotik</option>
                  <option value="cisco">cisco</option>
                  <option value="juniper">juniper</option>
                  <option value="huawei">huawei</option>
                  <option value="other">other</option>
                </Select>
              </div>
            </div>
            <p className="rounded bg-surface px-2 py-1.5 text-xs text-text-muted">
              {t.rich('radiusNasNote', {
                code: (chunks) => <code className="font-mono">{chunks}</code>,
              })}
            </p>
          </div>
        )}

        {/* Bloco SNMP — pra OLT/Router (futuro) */}
        {(form.type === 'OLT' || form.type === 'ROUTER' || form.type === 'SWITCH') && (
          <div className="rounded-md border border-dashed border-border bg-surface-muted p-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              {t('snmpOptional')}
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>{t('community')}</Label>
                <Input
                  value={form.snmpCommunity}
                  onChange={(e) =>
                    setForm({ ...form, snmpCommunity: e.target.value })
                  }
                  placeholder="public"
                />
              </div>
              <div>
                <Label>{t('version')}</Label>
                <Select
                  value={form.snmpVersion ?? 'v2c'}
                  onChange={(e) =>
                    setForm({ ...form, snmpVersion: e.target.value })
                  }
                >
                  <option value="v2c">v2c</option>
                  <option value="v3">v3</option>
                </Select>
              </div>
            </div>
          </div>
        )}

        {/* Acceso (Disconnect multi-vendor) — só pra BNG */}
        {form.type === 'BNG' && (
          <div className="rounded-md border border-dashed border-border bg-surface-muted p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {t('accessDisconnect')}
              </p>
              {!isNew && (
                <Button
                  size="xs"
                  variant="outline"
                  type="button"
                  loading={testing}
                  onClick={handleTestConnection}
                >
                  <Plug className="h-3 w-3" />
                  {t('testConnectivity')}
                </Button>
              )}
            </div>

            <div>
              <Label>{t('disconnectStrategy')}</Label>
              <Select
                value={form.disconnectStrategy ?? 'AUTO'}
                onChange={(e) =>
                  setForm({
                    ...form,
                    disconnectStrategy: e.target.value as DisconnectStrategy,
                  })
                }
              >
                {DISCONNECT_STRATEGIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {t(s.labelKey)}
                  </option>
                ))}
              </Select>
              <FieldHelp>
                {(() => {
                  const s = DISCONNECT_STRATEGIES.find(
                    (s) => s.value === (form.disconnectStrategy ?? 'AUTO'),
                  );
                  return s ? t(s.helpKey) : '';
                })()}
              </FieldHelp>
            </div>

            {/* RouterOS API — Mikrotik */}
            {form.vendor === 'MIKROTIK' && (
              <div className="rounded bg-surface p-3 space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  {t('routerOsApi')}
                </p>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="md:col-span-2">
                    <Label>{t('apiHost')}</Label>
                    <Input
                      value={form.apiHost ?? ''}
                      onChange={(e) =>
                        setForm({ ...form, apiHost: e.target.value || null })
                      }
                      placeholder={t('defaultPlaceholder', {
                        value: form.ipAddress || t('mgmtIp'),
                      })}
                    />
                  </div>
                  <div>
                    <Label>{t('port')}</Label>
                    <Input
                      type="number"
                      value={form.apiPort ?? ''}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          apiPort: e.target.value
                            ? Number(e.target.value)
                            : null,
                        })
                      }
                      placeholder={form.apiTlsEnabled ? '8729' : '8728'}
                    />
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <Label>{t('apiUser')}</Label>
                    <Input
                      value={form.apiUser ?? ''}
                      onChange={(e) =>
                        setForm({ ...form, apiUser: e.target.value || null })
                      }
                      placeholder="netx-coa"
                    />
                  </div>
                  <div>
                    <Label>{t('apiPassword')}</Label>
                    <Input
                      type="password"
                      value={form.apiPassword ?? ''}
                      onChange={(e) =>
                        setForm({ ...form, apiPassword: e.target.value })
                      }
                      placeholder={
                        initial?.hasApiPassword
                          ? t('passwordKeep')
                          : t('passwordPlaceholder')
                      }
                      autoComplete="new-password"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={form.apiTlsEnabled ?? false}
                    onChange={(e) =>
                      setForm({ ...form, apiTlsEnabled: e.target.checked })
                    }
                  />
                  {t('tlsEnabled')}
                </label>
              </div>
            )}

            {/* SSH — fallback genérico */}
            <details className="rounded bg-surface p-3">
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                {t('sshOverride')}
              </summary>
              <div className="mt-3 space-y-3">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="md:col-span-2">
                    <Label>{t('sshHost')}</Label>
                    <Input
                      value={form.sshHost ?? ''}
                      onChange={(e) =>
                        setForm({ ...form, sshHost: e.target.value || null })
                      }
                      placeholder={t('defaultPlaceholder', {
                        value: form.ipAddress || t('mgmtIp'),
                      })}
                    />
                  </div>
                  <div>
                    <Label>{t('sshPort')}</Label>
                    <Input
                      type="number"
                      value={form.sshPort ?? 22}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          sshPort: e.target.value
                            ? Number(e.target.value)
                            : 22,
                        })
                      }
                      placeholder="22"
                    />
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <Label>{t('sshUser')}</Label>
                    <Input
                      value={form.sshUser ?? ''}
                      onChange={(e) =>
                        setForm({ ...form, sshUser: e.target.value || null })
                      }
                    />
                  </div>
                  <div>
                    <Label>{t('sshPassword')}</Label>
                    <Input
                      type="password"
                      value={form.sshPassword ?? ''}
                      onChange={(e) =>
                        setForm({ ...form, sshPassword: e.target.value })
                      }
                      placeholder={
                        initial?.hasSshPassword
                          ? t('passwordKeep')
                          : t('passwordPlaceholder')
                      }
                      autoComplete="new-password"
                    />
                  </div>
                </div>
                <div>
                  <Label>{t('disconnectCmd')}</Label>
                  <Textarea
                    rows={2}
                    value={form.sshDisconnectCmd ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        sshDisconnectCmd: e.target.value || null,
                      })
                    }
                    placeholder="/ip dhcp-server lease remove [find mac-address={{macAddress}}]"
                  />
                  <FieldHelp>
                    {t('placeholdersLabel')}{' '}
                    <code className="font-mono">{`{{macAddress}}`}</code>,{' '}
                    <code className="font-mono">{`{{framedIp}}`}</code>,{' '}
                    <code className="font-mono">{`{{username}}`}</code>,{' '}
                    <code className="font-mono">{`{{acctSessionId}}`}</code>,{' '}
                    <code className="font-mono">{`{{nasIp}}`}</code>
                  </FieldHelp>
                </div>
              </div>
            </details>

            {/* CoA port custom (raro mexer) */}
            <details className="rounded bg-surface p-3">
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                {t('coaAdvanced')}
              </summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <Label>{t('coaPort')}</Label>
                  <Input
                    type="number"
                    value={form.coaPort ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        coaPort: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    placeholder="3799 (default RFC 5176)"
                  />
                </div>
              </div>
            </details>

            {/* Resultados do Test Connection */}
            {testResults && (
              <div className="space-y-1 rounded border border-border bg-surface p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  {t('testResult')}
                </p>
                {testResults.length === 0 ? (
                  <p className="text-xs text-text-muted">
                    {t('noStrategyConfigured')}
                  </p>
                ) : (
                  testResults.map((r) => (
                    <div
                      key={r.strategy}
                      className="flex items-start gap-2 text-xs"
                    >
                      {r.ok ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
                      ) : (
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
                      )}
                      <div>
                        <span className="font-mono font-semibold">
                          {r.strategy}
                        </span>{' '}
                        — {r.message ?? (r.ok ? t('ok') : t('failed'))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Última conectividad confirmada */}
            {!isNew && initial?.lastReachableAt && (
              <p className="text-[11px] text-text-muted">
                {t('lastReachable', {
                  when: new Date(initial.lastReachableAt).toLocaleString(),
                })}
              </p>
            )}
          </div>
        )}

        <div>
          <Label>{t('mapLocation')}</Label>
          <FieldHelp>{t('mapLocationHelp')}</FieldHelp>
          <LocationPicker value={location} onChange={setLocation} />
        </div>

        <div>
          <Label>{tc('notes')}</Label>
          <Textarea
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive ?? true}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            {t('active')}
          </label>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}

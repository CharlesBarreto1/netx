'use client';

import { Plus, RefreshCw, LogOut, Trash2, FileText, Users, Pencil } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  createInstance,
  deleteInstance,
  listInstanceGroups,
  listInstances,
  logoutInstance,
  reconnectInstance,
  setCaptureGroups,
  syncTemplates,
  updateInstance,
  type CreateInstanceInput,
  type UpdateInstanceInput,
  type WaChannel,
  type WaGroup,
  type WaInstance,
} from '@/lib/whatsapp-api';

/**
 * /settings/whatsapp — admin de instâncias Evolution.
 *
 * Permissão: chat.admin. Mostra lista, permite criar nova, exibe QR pra
 * escanear quando aguardando conexão, status em tempo real (refetch 5s).
 */
export default function WhatsappSettingsPage() {
  const t = useTranslations('chat.admin');
  const tCommon = useTranslations('common');
  const canAdmin = hasPermission('chat.admin');

  const [showForm, setShowForm] = useState(false);

  const query = useSWR<WaInstance[]>('/whatsapp/instances', () => listInstances(), {
    refreshInterval: 5000, // poll status até estabilizar
  });

  if (!canAdmin) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
        {t('noPermission')}
      </div>
    );
  }

  if (query.isLoading) return <PageLoader />;

  const instances = query.data ?? [];

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('subtitle')}</p>
        </div>
        {!showForm && instances.length === 0 && (
          <Button onClick={() => setShowForm(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t('create')}
          </Button>
        )}
      </header>

      {showForm && <NewInstanceForm onCancel={() => setShowForm(false)} onCreated={() => { void query.mutate(); setShowForm(false); }} />}

      <div className="space-y-3">
        {instances.length === 0 && !showForm && (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-text-muted dark:border-slate-700">
            {t('empty')}
          </div>
        )}
        {instances.map((inst) => (
          <InstanceCard key={inst.id} instance={inst} onChange={() => void query.mutate()} />
        ))}
      </div>
    </div>
  );
}

function NewInstanceForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations('chat.admin');
  const tCommon = useTranslations('common');
  const [channel, setChannel] = useState<WaChannel>('WAHA');
  const [form, setForm] = useState({
    name: 'Atendimento Principal',
    instanceName: 'atendimento-principal',
    // WAHA
    evolutionUrl: 'http://localhost:3010',
    apiKey: '',
    // Meta Cloud
    wabaId: '',
    phoneNumberId: '',
    accessToken: '',
    appSecret: '',
    verifyToken: '',
  });
  const [busy, setBusy] = useState(false);

  const valid =
    channel === 'WAHA'
      ? Boolean(form.name.trim() && form.instanceName.trim()) // URL/key vêm do servidor
      : Boolean(form.phoneNumberId && form.accessToken && form.appSecret);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !valid) return;
    setBusy(true);
    try {
      const payload: CreateInstanceInput =
        channel === 'WAHA'
          ? {
              // URL e X-Api-Key do WAHA são config do servidor — o backend resolve.
              name: form.name,
              channel: 'WAHA',
              instanceName: form.instanceName,
            }
          : {
              name: form.name,
              channel: 'META_CLOUD',
              instanceName: form.instanceName,
              wabaId: form.wabaId || undefined,
              phoneNumberId: form.phoneNumberId,
              accessToken: form.accessToken,
              appSecret: form.appSecret,
              verifyToken: form.verifyToken || undefined,
            };
      await createInstance(payload);
      toast.success(t('created'));
      onCreated();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800"
    >
      <h2 className="text-base font-semibold">{t('formTitle')}</h2>

      {/* Seletor de canal */}
      <div className="flex gap-2">
        {(['WAHA', 'META_CLOUD'] as WaChannel[]).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setChannel(c)}
            className={`flex-1 rounded-lg border p-3 text-left text-sm transition ${
              channel === c
                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            <span className="block font-semibold">{t(`channel.${c}.label`)}</span>
            <span className="block text-xs text-text-muted">{t(`channel.${c}.hint`)}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="i-name" required>
            {t('field.name')}
          </Label>
          <Input
            id="i-name"
            value={form.name}
            onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
          />
        </div>
        <div>
          <Label htmlFor="i-instanceName" required>
            {t('field.instanceName')}
          </Label>
          <Input
            id="i-instanceName"
            value={form.instanceName}
            onChange={(e) =>
              setForm((s) => ({ ...s, instanceName: e.target.value.replace(/\s+/g, '-').toLowerCase() }))
            }
            placeholder="atendimento-principal"
          />
        </div>

        {channel === 'WAHA' ? (
          <div className="md:col-span-2 rounded-lg bg-slate-50 p-3 text-xs text-text-muted dark:bg-slate-700/40">
            {t('field.wahaAuto')}
          </div>
        ) : (
          <>
            <div>
              <Label htmlFor="i-phoneNumberId" required>
                {t('field.phoneNumberId')}
              </Label>
              <Input
                id="i-phoneNumberId"
                value={form.phoneNumberId}
                onChange={(e) => setForm((s) => ({ ...s, phoneNumberId: e.target.value }))}
                placeholder="1234567890"
              />
            </div>
            <div>
              <Label htmlFor="i-wabaId">{t('field.wabaId')}</Label>
              <Input
                id="i-wabaId"
                value={form.wabaId}
                onChange={(e) => setForm((s) => ({ ...s, wabaId: e.target.value }))}
                placeholder="WABA id (p/ sync de templates)"
              />
            </div>
            <div>
              <Label htmlFor="i-accessToken" required>
                {t('field.accessToken')}
              </Label>
              <Input
                id="i-accessToken"
                type="password"
                value={form.accessToken}
                onChange={(e) => setForm((s) => ({ ...s, accessToken: e.target.value }))}
                autoComplete="off"
              />
            </div>
            <div>
              <Label htmlFor="i-appSecret" required>
                {t('field.appSecret')}
              </Label>
              <Input
                id="i-appSecret"
                type="password"
                value={form.appSecret}
                onChange={(e) => setForm((s) => ({ ...s, appSecret: e.target.value }))}
                autoComplete="off"
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="i-verifyToken">{t('field.verifyToken')}</Label>
              <Input
                id="i-verifyToken"
                value={form.verifyToken}
                onChange={(e) => setForm((s) => ({ ...s, verifyToken: e.target.value }))}
                placeholder={t('field.verifyTokenHint')}
              />
            </div>
          </>
        )}
      </div>
      <p className="text-xs text-text-muted">
        {channel === 'WAHA' ? t('formHelp') : t('formHelpMeta')}
      </p>
      <div className="flex justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          {tCommon('cancel')}
        </Button>
        <Button type="submit" loading={busy} disabled={!valid}>
          {t('createBtn')}
        </Button>
      </div>
    </form>
  );
}

function InstanceCard({
  instance,
  onChange,
}: {
  instance: WaInstance;
  onChange: () => void;
}) {
  const t = useTranslations('chat.admin');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const statusColor: Record<string, string> = {
    CONNECTED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    CONNECTING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    DISCONNECTED: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
    ERROR: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  };

  async function action(fn: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      toast.success(success);
      onChange();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <header className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold">{instance.name}</h3>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                instance.channel === 'META_CLOUD'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                  : 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
              }`}
            >
              {t(`channel.${instance.channel}.label`)}
            </span>
          </div>
          <p className="text-xs text-text-muted">
            {instance.channel === 'META_CLOUD'
              ? `${instance.instanceName} · phone_id ${instance.phoneNumberId ?? '—'}`
              : `${instance.instanceName} · ${instance.evolutionUrl}`}
          </p>
          {instance.phoneE164 && (
            <p className="mt-1 text-sm font-medium">{instance.phoneE164}</p>
          )}
        </div>
        <span className={`rounded-md px-2 py-1 text-xs font-medium ${statusColor[instance.status]}`}>
          {t(`status.${instance.status}`)}
        </span>
      </header>

      {instance.status === 'CONNECTING' && instance.qrCode && (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-lg bg-slate-50 p-4 dark:bg-slate-700">
          <p className="text-xs text-text-muted">{t('qrHelp')}</p>
          <img
            src={instance.qrCode.startsWith('data:') ? instance.qrCode : `data:image/png;base64,${instance.qrCode}`}
            alt="QR Code"
            className="h-56 w-56 rounded bg-white p-2"
          />
        </div>
      )}

      {instance.lastError && (
        <div className="mt-3 rounded bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
          {instance.lastError}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => action(() => reconnectInstance(instance.id), t('reconnected'))}
          disabled={busy}
        >
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          {t('reconnect')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)} disabled={busy}>
          <Pencil className="mr-1 h-3.5 w-3.5" />
          {t('edit')}
        </Button>
        {instance.channel === 'WAHA' && instance.status === 'CONNECTED' && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => action(() => logoutInstance(instance.id), t('loggedOut'))}
            disabled={busy}
          >
            <LogOut className="mr-1 h-3.5 w-3.5" />
            {t('logout')}
          </Button>
        )}
        {instance.channel === 'META_CLOUD' && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              action(async () => {
                const r = await syncTemplates(instance.id);
                return r;
              }, t('templatesSynced'))
            }
            disabled={busy}
          >
            <FileText className="mr-1 h-3.5 w-3.5" />
            {t('syncTemplates')}
          </Button>
        )}
        <Button
          size="sm"
          variant="danger"
          onClick={() => {
            if (confirm(t('deleteConfirm'))) {
              void action(() => deleteInstance(instance.id), t('deleted'));
            }
          }}
          disabled={busy}
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          {t('delete')}
        </Button>
      </div>

      {editing && (
        <EditInstanceForm
          instance={instance}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChange();
          }}
        />
      )}

      {instance.channel === 'WAHA' && <GroupsSection instance={instance} onChange={onChange} />}
    </article>
  );
}

/**
 * Form de edição inline da instância. Corrige nome + IDs/segredos sem apagar.
 * Segredos ficam em branco (placeholder) — preencher só se for trocar.
 */
function EditInstanceForm({
  instance,
  onCancel,
  onSaved,
}: {
  instance: WaInstance;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('chat.admin');
  const tCommon = useTranslations('common');
  const isMeta = instance.channel === 'META_CLOUD';
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: instance.name,
    phoneNumberId: instance.phoneNumberId ?? '',
    wabaId: instance.wabaId ?? '',
    verifyToken: '',
    accessToken: '',
    appSecret: '',
    evolutionUrl: instance.evolutionUrl ?? '',
    apiKey: '',
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const payload: UpdateInstanceInput = { name: form.name.trim() };
      if (isMeta) {
        if (form.phoneNumberId.trim()) payload.phoneNumberId = form.phoneNumberId.trim();
        payload.wabaId = form.wabaId.trim() || null;
        if (form.verifyToken.trim()) payload.verifyToken = form.verifyToken.trim();
        if (form.accessToken.trim()) payload.accessToken = form.accessToken.trim();
        if (form.appSecret.trim()) payload.appSecret = form.appSecret.trim();
      } else {
        if (form.evolutionUrl.trim()) payload.evolutionUrl = form.evolutionUrl.trim();
        if (form.apiKey.trim()) payload.apiKey = form.apiKey.trim();
      }
      await updateInstance(instance.id, payload);
      toast.success(t('updated'));
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-700/30"
    >
      <h4 className="text-sm font-semibold">{t('editTitle')}</h4>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label htmlFor={`e-name-${instance.id}`} required>
            {t('field.name')}
          </Label>
          <Input id={`e-name-${instance.id}`} value={form.name} onChange={set('name')} />
        </div>

        {isMeta ? (
          <>
            <div>
              <Label htmlFor={`e-pnid-${instance.id}`}>{t('field.phoneNumberId')}</Label>
              <Input
                id={`e-pnid-${instance.id}`}
                value={form.phoneNumberId}
                onChange={set('phoneNumberId')}
                placeholder="1085842974619872"
              />
            </div>
            <div>
              <Label htmlFor={`e-waba-${instance.id}`}>{t('field.wabaId')}</Label>
              <Input id={`e-waba-${instance.id}`} value={form.wabaId} onChange={set('wabaId')} />
            </div>
            <div>
              <Label htmlFor={`e-token-${instance.id}`}>{t('field.accessToken')}</Label>
              <Input
                id={`e-token-${instance.id}`}
                type="password"
                value={form.accessToken}
                onChange={set('accessToken')}
                placeholder={t('keepSecret')}
                autoComplete="off"
              />
            </div>
            <div>
              <Label htmlFor={`e-secret-${instance.id}`}>{t('field.appSecret')}</Label>
              <Input
                id={`e-secret-${instance.id}`}
                type="password"
                value={form.appSecret}
                onChange={set('appSecret')}
                placeholder={t('keepSecret')}
                autoComplete="off"
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor={`e-verify-${instance.id}`}>{t('field.verifyToken')}</Label>
              <Input
                id={`e-verify-${instance.id}`}
                value={form.verifyToken}
                onChange={set('verifyToken')}
                placeholder={t('keepSecret')}
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <Label htmlFor={`e-url-${instance.id}`}>{t('field.evolutionUrl')}</Label>
              <Input id={`e-url-${instance.id}`} value={form.evolutionUrl} onChange={set('evolutionUrl')} />
            </div>
            <div>
              <Label htmlFor={`e-key-${instance.id}`}>{t('field.apiKey')}</Label>
              <Input
                id={`e-key-${instance.id}`}
                type="password"
                value={form.apiKey}
                onChange={set('apiKey')}
                placeholder={t('keepSecret')}
                autoComplete="off"
              />
            </div>
          </>
        )}
      </div>
      <p className="text-xs text-text-muted">{t('editHelp')}</p>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={busy}>
          {tCommon('cancel')}
        </Button>
        <Button type="submit" size="sm" loading={busy}>
          {tCommon('save')}
        </Button>
      </div>
    </form>
  );
}

/**
 * Seção de grupos do WhatsApp (canal WAHA/QR). Toggle de captura (opt-in) +
 * listagem sob demanda dos grupos da conta conectada.
 */
function GroupsSection({
  instance,
  onChange,
}: {
  instance: WaInstance;
  onChange: () => void;
}) {
  const t = useTranslations('chat.admin');
  const [busy, setBusy] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [groups, setGroups] = useState<WaGroup[] | null>(null);
  const capture = instance.captureGroups === true;

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      await setCaptureGroups(instance.id, !capture);
      toast.success(!capture ? t('groups.enabled') : t('groups.disabled'));
      onChange();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function loadGroups() {
    if (loadingGroups) return;
    setLoadingGroups(true);
    try {
      const r = await listInstanceGroups(instance.id);
      setGroups(r.groups);
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(msg);
    } finally {
      setLoadingGroups(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Users className="h-4 w-4 text-text-muted" />
            {t('groups.title')}
          </p>
          <p className="text-xs text-text-muted">{t('groups.hint')}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={capture}
          aria-label={t('groups.title')}
          onClick={toggle}
          disabled={busy}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
            capture ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
          } ${busy ? 'opacity-50' : ''}`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
              capture ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={loadGroups}
          loading={loadingGroups}
          disabled={instance.status !== 'CONNECTED'}
        >
          <Users className="mr-1 h-3.5 w-3.5" />
          {t('groups.list')}
        </Button>
        {instance.status !== 'CONNECTED' && (
          <span className="text-xs text-text-muted">{t('groups.needConnected')}</span>
        )}
      </div>

      {groups && (
        <div className="mt-3 max-h-64 space-y-1 overflow-y-auto">
          {groups.length === 0 ? (
            <p className="py-2 text-center text-xs text-text-muted">{t('groups.empty')}</p>
          ) : (
            groups.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between gap-2 rounded border border-slate-100 px-2 py-1.5 text-sm dark:border-slate-700"
              >
                <span className="min-w-0 flex-1 truncate">{g.subject ?? g.id}</span>
                {g.participantsCount != null && (
                  <span className="shrink-0 text-xs text-text-muted">
                    {t('groups.participants', { count: g.participantsCount })}
                  </span>
                )}
                {g.captured && (
                  <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                    {t('groups.captured')}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

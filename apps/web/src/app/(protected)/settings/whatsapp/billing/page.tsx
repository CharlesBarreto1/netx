'use client';

import { Plus, Pencil, Trash2, Play, Clock, Send } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Input';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  getBillingConfig,
  setBillingConfig,
  createBillingRule,
  updateBillingRule,
  deleteBillingRule,
  runBilling,
  listTemplates,
  type BillingChannel,
  type WaBillingConfig,
  type WaBillingRule,
  type WaBillingRuleInput,
  type WaTemplate,
} from '@/lib/whatsapp-api';

/** offsetDays → { quando, dias }. <0 antes, 0 no dia, >0 depois. */
function offsetToTiming(offset: number): { when: 'before' | 'on' | 'after'; days: number } {
  if (offset < 0) return { when: 'before', days: -offset };
  if (offset > 0) return { when: 'after', days: offset };
  return { when: 'on', days: 0 };
}
function timingToOffset(when: 'before' | 'on' | 'after', days: number): number {
  if (when === 'before') return -Math.abs(days);
  if (when === 'after') return Math.abs(days);
  return 0;
}

const CHANNEL_LABELS: Record<BillingChannel, string> = {
  WHATSAPP_META: 'WhatsApp (Meta oficial)',
  WHATSAPP_WAHA: 'WhatsApp (WAHA)',
  SMS: 'SMS',
  EMAIL: 'E-mail',
};

/**
 * /settings/whatsapp/billing — régua de cobrança: liga/desliga, modo teste e
 * uma LISTA de regras (envie o template X, N dias antes/no/depois do vencimento,
 * pelo canal C). Permissão chat.admin.
 */
export default function BillingRulesPage() {
  const t = useTranslations('chat.billingAdmin');
  const tCommon = useTranslations('common');
  const canAdmin = hasPermission('chat.admin');

  const query = useSWR<WaBillingConfig>('/whatsapp/billing/config', () => getBillingConfig());
  const templatesQuery = useSWR<WaTemplate[]>('/whatsapp/templates', () => listTemplates());

  const [editing, setEditing] = useState<WaBillingRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<WaBillingRule | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);

  if (!canAdmin) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
        {t('noPermission')}
      </div>
    );
  }
  if (query.isLoading) return <PageLoader />;

  const data = query.data;
  const cfg = data?.config ?? { enabled: false, testRecipient: null };
  const rules = data?.rules ?? [];
  const supported = data?.supportedChannels ?? ['WHATSAPP_META'];
  const channels = data?.channels ?? ['WHATSAPP_META', 'WHATSAPP_WAHA', 'SMS', 'EMAIL'];
  const templates = templatesQuery.data ?? [];

  async function saveConfig(patch: { enabled?: boolean; testRecipient?: string | null }) {
    setBusy(true);
    try {
      await setBillingConfig(patch);
      await query.mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doRun(dryRun: boolean) {
    setRunning(true);
    try {
      const r = await runBilling(dryRun);
      toast.success(
        t('runResult', { sent: r.sent, due: r.due, skipped: r.skipped, failed: r.failed }) +
          (r.testRedirect ? ` · ${t('testRedirect', { phone: r.testRedirect })}` : ''),
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">{t('subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void doRun(true)} loading={running}>
            <Clock className="mr-1 h-4 w-4" /> {t('simulate')}
          </Button>
          <Button variant="outline" onClick={() => void doRun(false)} loading={running}>
            <Play className="mr-1 h-4 w-4" /> {t('runNow')}
          </Button>
        </div>
      </header>

      {/* Config-mestre */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="text-sm font-medium">{t('enabled')}</span>
            <span className="mt-0.5 block text-xs text-text-muted">{t('enabledHint')}</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={cfg.enabled}
            disabled={busy}
            onClick={() => void saveConfig({ enabled: !cfg.enabled })}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
              cfg.enabled ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                cfg.enabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </label>

        <div className="mt-4 max-w-sm">
          <Label htmlFor="test-recipient">{t('testRecipientLabel')}</Label>
          <TestRecipientField
            initial={cfg.testRecipient ?? ''}
            onSave={(v) => void saveConfig({ testRecipient: v || null })}
            busy={busy}
          />
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{t('testRecipientHint')}</p>
        </div>
      </section>

      {/* Régua de regras */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('rulesTitle')}</h2>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" /> {t('addRule')}
          </Button>
        </div>
        {rules.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-text-muted dark:border-slate-700">
            {t('rulesEmpty')}
          </div>
        ) : (
          <ul className="space-y-2">
            {rules.map((r) => (
              <RuleRow
                key={r.id}
                rule={r}
                templates={templates}
                onToggle={async (enabled) => {
                  try {
                    await updateBillingRule(r.id, { enabled });
                    await query.mutate();
                  } catch (err) {
                    toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
                  }
                }}
                onEdit={() => setEditing(r)}
                onDelete={() => setToDelete(r)}
              />
            ))}
          </ul>
        )}
      </section>

      {(creating || editing) && (
        <RuleModal
          initial={editing}
          templates={templates}
          channels={channels}
          supported={supported}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            void query.mutate();
          }}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        variant="danger"
        title={t('deleteTitle')}
        message={t('deleteMsg')}
        confirmLabel={tCommon('delete')}
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await deleteBillingRule(toDelete.id);
            setToDelete(null);
            await query.mutate();
          } catch (err) {
            toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
          }
        }}
      />
    </div>
  );
}

/** Campo do número de teste com botão salvar (evita salvar a cada tecla). */
function TestRecipientField({
  initial,
  onSave,
  busy,
}: {
  initial: string;
  onSave: (v: string) => void;
  busy: boolean;
}) {
  const tCommon = useTranslations('common');
  const [v, setV] = useState(initial);
  return (
    <div className="flex gap-2">
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder="+595..." />
      <Button variant="outline" disabled={busy || v === initial} onClick={() => onSave(v.trim())}>
        {tCommon('save')}
      </Button>
    </div>
  );
}

function RuleRow({
  rule,
  templates,
  onToggle,
  onEdit,
  onDelete,
}: {
  rule: WaBillingRule;
  templates: WaTemplate[];
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('chat.billingAdmin');
  const { when, days } = offsetToTiming(rule.offsetDays);
  const timing =
    when === 'on' ? t('timing.on') : when === 'before' ? t('timing.before', { days }) : t('timing.after', { days });
  const tplLabel = templates.find((x) => x.name === rule.templateName)?.name ?? rule.templateName;
  const channelLabel = CHANNEL_LABELS[rule.channel as BillingChannel] ?? rule.channel;

  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={rule.enabled}
          onClick={() => onToggle(!rule.enabled)}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
            rule.enabled ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
              rule.enabled ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
              <Send className="h-3 w-3" /> {tplLabel}
            </span>
            <span className="text-sm font-medium">{timing}</span>
          </div>
          <p className="mt-0.5 text-xs text-text-muted">
            {channelLabel} · {rule.language}
            {rule.label ? ` · ${rule.label}` : ''}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <button type="button" onClick={onEdit} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">
          <Pencil className="h-4 w-4" />
        </button>
        <button type="button" onClick={onDelete} className="rounded-md p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-700">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

function RuleModal({
  initial,
  templates,
  channels,
  supported,
  onClose,
  onSaved,
}: {
  initial: WaBillingRule | null;
  templates: WaTemplate[];
  channels: BillingChannel[];
  supported: BillingChannel[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('chat.billingAdmin');
  const tCommon = useTranslations('common');
  const initTiming = initial ? offsetToTiming(initial.offsetDays) : { when: 'before' as const, days: 3 };
  const [when, setWhen] = useState<'before' | 'on' | 'after'>(initTiming.when);
  const [days, setDays] = useState(initTiming.days || 3);
  const [channel, setChannel] = useState<string>(initial?.channel ?? 'WHATSAPP_META');
  const [templateName, setTemplateName] = useState(initial?.templateName ?? '');
  const [language, setLanguage] = useState(initial?.language ?? 'pt_BR');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [busy, setBusy] = useState(false);

  const valid = templateName.trim().length > 0 && supported.includes(channel as BillingChannel);

  function pickTemplate(name: string) {
    setTemplateName(name);
    const tpl = templates.find((x) => x.name === name);
    if (tpl) setLanguage(tpl.language);
  }

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const input: WaBillingRuleInput = {
        offsetDays: timingToOffset(when, when === 'on' ? 0 : days),
        channel,
        templateName: templateName.trim(),
        language: language.trim() || 'pt_BR',
        label: label.trim() || null,
      };
      if (initial) await updateBillingRule(initial.id, input);
      else await createBillingRule(input);
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? t('editRule') : t('newRule')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!valid}>
            {tCommon('save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Quando */}
        <div>
          <Label>{t('whenLabel')}</Label>
          <div className="flex items-center gap-2">
            <Select value={when} onChange={(e) => setWhen(e.target.value as 'before' | 'on' | 'after')} className="flex-1">
              <option value="before">{t('when.before')}</option>
              <option value="on">{t('when.on')}</option>
              <option value="after">{t('when.after')}</option>
            </Select>
            {when !== 'on' && (
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={days}
                  onChange={(e) => setDays(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
                  className="w-20"
                />
                <span className="text-sm text-text-muted">{t('days')}</span>
              </div>
            )}
          </div>
        </div>

        {/* Canal */}
        <div>
          <Label>{t('channelLabel')}</Label>
          <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
            {channels.map((c) => {
              const ok = supported.includes(c);
              return (
                <option key={c} value={c} disabled={!ok}>
                  {CHANNEL_LABELS[c]}
                  {ok ? '' : ` — ${t('soon')}`}
                </option>
              );
            })}
          </Select>
        </div>

        {/* Template */}
        <div>
          <Label required>{t('templateLabel')}</Label>
          {templates.length > 0 ? (
            <Select value={templateName} onChange={(e) => pickTemplate(e.target.value)}>
              <option value="">{t('templatePlaceholder')}</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.name}>
                  {tpl.name} · {tpl.language}
                </option>
              ))}
            </Select>
          ) : (
            <div className="flex gap-2">
              <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="cobros_chat_5949" />
              <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="pt_BR" className="w-28" />
            </div>
          )}
          <p className="mt-1 text-xs text-text-muted">{t('templateHint')}</p>
        </div>

        {/* Rótulo */}
        <div>
          <Label htmlFor="rule-label">{t('ruleLabel')}</Label>
          <Input id="rule-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('ruleLabelPlaceholder')} maxLength={120} />
        </div>
      </div>
    </Modal>
  );
}

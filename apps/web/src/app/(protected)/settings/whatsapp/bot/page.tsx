'use client';

import { Bot, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  BOT_TOOLS,
  getBotConfig,
  updateBotConfig,
  type BotConfig,
  type BotMenuOption,
} from '@/lib/whatsapp-bot-api';

/**
 * /settings/whatsapp/bot — configuração do chatbot de atendimento (chat.admin).
 * Híbrido: menu determinístico + IA agêntica opcional. O bot só conduz conversas
 * sem atendente humano; ao assumir/transferir, o humano assume.
 */
export default function ChatbotSettingsPage() {
  const t = useTranslations('chatBot');
  const tCommon = useTranslations('common');
  const canAdmin = hasPermission('chat.admin');

  const query = useSWR<BotConfig>('/whatsapp/bot', () => getBotConfig(), {
    revalidateOnFocus: false,
  });
  const [form, setForm] = useState<BotConfig | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (query.data && !form) setForm(query.data);
  }, [query.data, form]);

  if (!canAdmin) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
        {t('noPermission')}
      </div>
    );
  }
  if (query.isLoading || !form) return <PageLoader />;

  const set = <K extends keyof BotConfig>(k: K, v: BotConfig[K]) =>
    setForm((s) => (s ? { ...s, [k]: v } : s));

  const setOption = (i: number, patch: Partial<BotMenuOption>) =>
    setForm((s) =>
      s ? { ...s, options: s.options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)) } : s,
    );

  const addOption = () =>
    setForm((s) =>
      s
        ? {
            ...s,
            options: [
              ...s.options,
              { key: String(s.options.length + 1), label: '', action: 'tool', tool: 'segunda_via' },
            ],
          }
        : s,
    );

  const removeOption = (i: number) =>
    setForm((s) => (s ? { ...s, options: s.options.filter((_, idx) => idx !== i) } : s));

  async function save() {
    if (!form || busy) return;
    setBusy(true);
    try {
      const saved = await updateBotConfig(form);
      setForm(saved);
      void query.mutate(saved, false);
      toast.success(t('saved'));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Bot className="h-6 w-6 text-brand-600" /> {t('title')}
          </h1>
          <p className="mt-1 text-sm text-text-muted">{t('subtitle')}</p>
        </div>
        <Button onClick={save} loading={busy}>
          <Save className="mr-1 h-4 w-4" /> {tCommon('save')}
        </Button>
      </header>

      {/* Toggles */}
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <ToggleRow
          label={t('enable')}
          hint={t('enableHint')}
          checked={form.enabled}
          onChange={(v) => set('enabled', v)}
        />
        <ToggleRow
          label={t('ai')}
          hint={t('aiHint')}
          checked={form.aiEnabled}
          onChange={(v) => set('aiEnabled', v)}
        />
      </section>

      {/* Textos */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <TextArea label={t('greeting')} value={form.greeting} onChange={(v) => set('greeting', v)} />
        <TextArea label={t('fallback')} value={form.fallbackText} onChange={(v) => set('fallbackText', v)} />
        <TextArea label={t('handoff')} value={form.handoffText} onChange={(v) => set('handoffText', v)} />
        <TextArea label={t('unknown')} value={form.unknownText} onChange={(v) => set('unknownText', v)} />
      </section>

      {/* Menu */}
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">{t('menu')}</h2>
            <p className="text-xs text-text-muted">{t('menuHint')}</p>
          </div>
          <Button size="sm" variant="outline" onClick={addOption}>
            <Plus className="mr-1 h-3.5 w-3.5" /> {t('addOption')}
          </Button>
        </div>

        <div className="space-y-2">
          {form.options.map((o, i) => (
            <div
              key={i}
              className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-100 p-3 dark:border-slate-700"
            >
              <div className="w-16">
                <Label>{t('optionKey')}</Label>
                <Input value={o.key} onChange={(e) => setOption(i, { key: e.target.value })} />
              </div>
              <div className="min-w-[160px] flex-1">
                <Label>{t('optionLabel')}</Label>
                <Input value={o.label} onChange={(e) => setOption(i, { label: e.target.value })} />
              </div>
              <div className="w-40">
                <Label>{t('optionAction')}</Label>
                <select
                  value={o.action}
                  onChange={(e) => setOption(i, { action: e.target.value as BotMenuOption['action'] })}
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                >
                  <option value="tool">{t('action.tool')}</option>
                  <option value="reply">{t('action.reply')}</option>
                  <option value="ai">{t('action.ai')}</option>
                  <option value="handoff">{t('action.handoff')}</option>
                </select>
              </div>
              {o.action === 'tool' && (
                <div className="w-48">
                  <Label>{t('optionTool')}</Label>
                  <select
                    value={o.tool ?? BOT_TOOLS[0]}
                    onChange={(e) => setOption(i, { tool: e.target.value })}
                    className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                  >
                    {BOT_TOOLS.map((tool) => (
                      <option key={tool} value={tool}>
                        {t(`tool.${tool}`)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {o.action === 'reply' && (
                <div className="min-w-[200px] flex-1">
                  <Label>{t('optionReply')}</Label>
                  <Input value={o.reply ?? ''} onChange={(e) => setOption(i, { reply: e.target.value })} />
                </div>
              )}
              <button
                type="button"
                onClick={() => removeOption(i)}
                aria-label={tCommon('delete')}
                className="mb-0.5 grid h-9 w-9 place-items-center rounded-md text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={save} loading={busy}>
          <Save className="mr-1 h-4 w-4" /> {tCommon('save')}
        </Button>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-text-muted">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
          checked ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

function TextArea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
      />
    </div>
  );
}

'use client';

import {
  ArrowLeft,
  Bot,
  Eye,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
  CheckCircle2,
  User as UserIcon,
  UserCheck,
  Users,
  ArrowRightLeft,
  FileText,
  Plus,
  Settings,
  Mic,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { CustomerPanel } from '@/components/chat/CustomerPanel';
import { Button } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { hasPermission, getSession } from '@/lib/session';
import { useWhatsappNotify } from '@/lib/use-whatsapp-notify';
import { useWhatsappStream } from '@/lib/use-whatsapp-stream';
import {
  assignConversation,
  getAgentSettings,
  getConversation,
  getConversationCounts,
  getWaInsights,
  listAgents,
  listConversations,
  updateAgentSettings,
  listTemplates,
  resolveConversation,
  resolveMediaUrl,
  sendMessage,
  sendAudioMessage,
  sendOutboundTemplate,
  sendTemplateMessage,
  suggestWaReply,
  timeAgo,
  transcribeMessage,
  type InboxFilter,
  type WaAiInsightsResponse,
  type WaAgent,
  type WaAgentSettings,
  type WaConversationCounts,
  type WaConversationDetail,
  type WaConversationListItem,
  type WaMessage,
  type WaTemplate,
} from '@/lib/whatsapp-api';

/**
 * /chat — Inbox de Atendimento (WhatsApp via Evolution API).
 *
 * Layout 3 colunas:
 *   - Esquerda: lista de conversas (filtros: minhas / não atribuídas / todas)
 *   - Centro: thread com bolhas + composer
 *   - Direita: contexto do cliente (se reconhecido) com atalho pro hub
 *
 * Realtime via SSE — chega mensagem nova, refetch automático e notificação
 * (browser + áudio). Permissão chat.read pra abrir; chat.send pra enviar.
 */
export default function ChatPage() {
  const t = useTranslations('chat');
  const tCommon = useTranslations('common');
  const session = getSession();
  const canSend = hasPermission('chat.send');
  const canAssign = hasPermission('chat.assign');
  const canAudit = hasPermission('chat.audit');

  const [filter, setFilter] = useState<InboxFilter>('andamento');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Painel do cliente como drawer fora do desktop (lg). Fecha ao trocar de conversa.
  const [panelOpen, setPanelOpen] = useState(false);
  useEffect(() => setPanelOpen(false), [selectedId]);

  const inboxQuery = useSWR<WaConversationListItem[]>(
    `/whatsapp/conversations?${filter}`,
    () => listConversations(filter),
    { refreshInterval: 0 }, // realtime via SSE
  );

  const countsQuery = useSWR<WaConversationCounts>(
    '/whatsapp/conversations/counts',
    () => getConversationCounts(),
    { refreshInterval: 0 },
  );

  const detailQuery = useSWR<WaConversationDetail>(
    selectedId ? `/whatsapp/conversations/${selectedId}` : null,
    () => (selectedId ? getConversation(selectedId) : Promise.reject()),
    { refreshInterval: 0 },
  );

  const { notify, soundEnabled, setSoundEnabled } = useWhatsappNotify();

  // SSE — atualiza inbox e thread em tempo real, e dispara notif quando msg
  // nova chega em conversa que não é a aberta no momento.
  useWhatsappStream(true, (e) => {
    if (e.type === 'message.created') {
      const p = e.payload as {
        conversationId: string;
        direction: string;
        body: string | null;
        isGroup?: boolean;
      };
      // Sempre atualiza inbox + contadores das abas
      void inboxQuery.mutate();
      void countsQuery.mutate();
      // Se for da conversa aberta, atualiza o detalhe.
      if (p.conversationId === selectedId) {
        void detailQuery.mutate();
      }
      // Toca som em TODA mensagem recebida (aberta ou não); a notificação do
      // browser só aparece quando a aba não está em foco (tratado no hook).
      // Grupos não tocam (são barulhentos; aparecem na aba Grupos).
      if (p.direction === 'IN' && !p.isGroup) {
        notify({
          title: t('notification.newMessage'),
          body: p.body ?? t('notification.media'),
          tag: p.conversationId,
          onClick: p.conversationId === selectedId ? undefined : () => setSelectedId(p.conversationId),
        });
      }
    } else if (
      e.type === 'conversation.updated' ||
      e.type === 'conversation.assigned' ||
      e.type === 'conversation.resolved'
    ) {
      void inboxQuery.mutate();
      void countsQuery.mutate();
      if ((e.payload as { id?: string }).id === selectedId) {
        void detailQuery.mutate();
      }
    }
  });

  const refetchAll = () => {
    void detailQuery.mutate();
    void inboxQuery.mutate();
    void countsQuery.mutate();
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 md:grid-cols-[clamp(260px,30vw,340px)_1fr] lg:grid-cols-[clamp(280px,24vw,340px)_1fr_clamp(320px,26vw,380px)]">
      {/* Inbox — no mobile some quando uma conversa está aberta */}
      <div className={`min-h-0 min-w-0 ${selectedId ? 'hidden md:block' : ''}`}>
        <ChatInbox
          filter={filter}
          setFilter={setFilter}
          selectedId={selectedId}
          onSelect={setSelectedId}
          items={inboxQuery.data}
          loading={inboxQuery.isLoading}
          counts={countsQuery.data}
          soundEnabled={soundEnabled}
          setSoundEnabled={setSoundEnabled}
          canSend={canSend}
          onCreated={(id) => {
            void inboxQuery.mutate();
            setSelectedId(id);
          }}
        />
      </div>

      {/* Conversa — no mobile só aparece quando há uma selecionada */}
      <div className={`min-h-0 min-w-0 ${selectedId ? '' : 'hidden md:block'}`}>
        <ChatThread
          conversation={detailQuery.data}
          loading={detailQuery.isLoading}
          canSend={canSend}
          canAssign={canAssign}
          canAudit={canAudit}
          currentUserId={session?.user.id ?? null}
          onBack={() => setSelectedId(null)}
          onOpenPanel={() => setPanelOpen(true)}
          onSent={refetchAll}
          onAssigned={refetchAll}
          onResolved={() => {
            refetchAll();
            setSelectedId(null);
          }}
        />
      </div>

      {/* Painel do cliente — 3ª coluna no desktop (lg) */}
      <div className="hidden min-h-0 min-w-0 lg:block">
        <CustomerPanel conversation={detailQuery.data} onChanged={refetchAll} />
      </div>

      {/* Painel como drawer fora do desktop */}
      {panelOpen && detailQuery.data && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPanelOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-[min(92vw,380px)] p-2">
            <CustomerPanel
              conversation={detailQuery.data}
              onChanged={refetchAll}
              onClose={() => setPanelOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Inbox column
// =============================================================================

function ChatInbox({
  filter,
  setFilter,
  selectedId,
  onSelect,
  items,
  loading,
  counts,
  soundEnabled,
  setSoundEnabled,
  canSend,
  onCreated,
}: {
  filter: InboxFilter;
  setFilter: (f: InboxFilter) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  items: WaConversationListItem[] | undefined;
  loading: boolean;
  counts: WaConversationCounts | undefined;
  soundEnabled: boolean;
  setSoundEnabled: (v: boolean) => void;
  canSend: boolean;
  onCreated: (conversationId: string) => void;
}) {
  const t = useTranslations('chat');
  const tx = useTranslations('chatExtra');
  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const tabs: Array<{ key: InboxFilter; label: string; count?: number }> = [
    { key: 'andamento', label: t('inbox.filter.andamento'), count: counts?.andamento },
    { key: 'espera', label: t('inbox.filter.espera'), count: counts?.espera },
    { key: 'automacao', label: t('inbox.filter.automacao'), count: counts?.automacao },
    { key: 'resolved', label: t('inbox.filter.resolved'), count: counts?.resolved },
    { key: 'groups', label: t('inbox.filter.groups') },
  ];

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      {/* tabs */}
      <div className="flex items-center gap-4 overflow-x-auto border-b border-slate-200 px-4 pt-3 dark:border-slate-700">
        {tabs.map((tab) => {
          const on = filter === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilter(tab.key)}
              className={`relative whitespace-nowrap pb-2.5 text-[13px] font-medium transition ${
                on ? 'text-brand-600 dark:text-brand-300' : 'text-text-muted hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span
                  className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    on ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-600 dark:bg-slate-600 dark:text-slate-200'
                  }`}
                >
                  {tab.count}
                </span>
              )}
              {on && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-brand-600" />}
            </button>
          );
        })}
      </div>

      {/* status + ações */}
      <div className="flex items-center gap-2 px-4 py-2 text-xs text-text-muted">
        <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]" />
        {t('inbox.connected')}
        <div className="ml-auto flex items-center gap-1">
          {canSend && (
            <button
              type="button"
              aria-label={t('newConversation.button')}
              title={t('newConversation.button')}
              onClick={() => setShowNew(true)}
              className="rounded-md p-1.5 text-brand-600 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-slate-700"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            aria-label={t('agentSettings.title')}
            title={t('agentSettings.title')}
            onClick={() => setShowSettings(true)}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <Settings className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={soundEnabled ? t('sound.disable') : t('sound.enable')}
            title={soundEnabled ? t('sound.disable') : t('sound.enable')}
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {showNew && (
        <NewConversationModal
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            setShowNew(false);
            onCreated(id);
          }}
        />
      )}
      {showSettings && <AgentSettingsModal onClose={() => setShowSettings(false)} />}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-xs text-text-muted">{t('loading')}</div>
        ) : !items || items.length === 0 ? (
          <div className="p-6 text-center text-xs text-text-muted">{t('inbox.empty')}</div>
        ) : (
          items.map((c) => {
            const last = c.messages[0];
            const isSelected = c.id === selectedId;
            const isGroup = c.contact.isGroup === true;
            const name =
              c.contact.customer?.displayName ??
              c.contact.pushName ??
              c.contact.phoneE164 ??
              tx('group');
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect(c.id)}
                className={`flex w-full items-start gap-3 border-b border-l-[3px] border-slate-100 px-3 py-3 text-left transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/50 ${
                  isSelected
                    ? 'border-l-brand-600 bg-brand-50 dark:bg-slate-700'
                    : 'border-l-transparent'
                }`}
              >
                <div className="relative shrink-0">
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-full text-sm font-semibold text-white"
                    style={{ background: isGroup ? '#64748b' : avatarColor(name) }}
                  >
                    {isGroup ? <Users className="h-5 w-5" /> : name.charAt(0).toUpperCase()}
                  </div>
                  {c.unreadCount > 0 && (
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-emerald-500 px-1 text-[10px] font-semibold text-white dark:border-slate-800">
                      {c.unreadCount}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{name}</span>
                    <span className="shrink-0 text-[11px] text-text-muted">{timeAgo(c.lastMessageAt)}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-[12.5px] text-text-muted">
                    {last
                      ? last.direction === 'OUT'
                        ? `→ ${last.body ?? tx('media')}`
                        : last.body ?? tx('media')
                      : '—'}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-[11px] text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                      {c.instance.name}
                    </span>
                    {c.botActive && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-violet-100 px-2 py-0.5 text-[11px] text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                        <Bot className="h-3 w-3" /> {t('inbox.filter.automacao')}
                      </span>
                    )}
                    {c.contact.customer && (
                      <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                        {tx('customerBadge')}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

/** Cor estável do avatar a partir do nome (hash → paleta). */
const AVATAR_COLORS = [
  '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899',
  '#f59e0b', '#10b981', '#0d9488', '#ef4444', '#14b8a6',
];
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** Modal de preferências do operador: saudação automática + mostrar nome. */
function AgentSettingsModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations('chat');
  const tCommon = useTranslations('common');
  const [greeting, setGreeting] = useState('');
  const [showName, setShowName] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getAgentSettings()
      .then((s: WaAgentSettings) => {
        setGreeting(s.greeting ?? '');
        setShowName(s.showName !== false);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      await updateAgentSettings({ greeting: greeting.trim(), showName });
      toast.success(t('agentSettings.saved'));
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800">
        <h3 className="text-base font-semibold">{t('agentSettings.title')}</h3>
        <p className="mt-1 text-xs text-text-muted">{t('agentSettings.hint')}</p>
        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted">
              {t('agentSettings.greeting')}
            </label>
            <textarea
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              rows={3}
              disabled={!loaded}
              placeholder={t('agentSettings.greetingPlaceholder')}
              className="w-full resize-none rounded-lg border border-slate-300 p-2.5 text-sm focus:border-brand-500 focus:outline-hidden dark:border-slate-600 dark:bg-slate-700"
            />
            <p className="mt-1 text-[11px] text-text-muted">{t('agentSettings.greetingVars')}</p>
          </div>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">{t('agentSettings.showName')}</span>
            <button
              type="button"
              role="switch"
              aria-checked={showName}
              onClick={() => setShowName((v) => !v)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                showName ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                  showName ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {tCommon('cancel')}
          </Button>
          <Button size="sm" loading={busy} disabled={!loaded} onClick={() => void save()}>
            {tCommon('save')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Modal "Nova conversa": inicia uma conversa do zero disparando um template
 * aprovado para um telefone (canal oficial Meta exige template no 1º contato).
 * Coleta as variáveis ({{n}}) do template, igual ao picker do chat.
 */
function NewConversationModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const t = useTranslations('chat');
  const tCommon = useTranslations('common');
  const [phone, setPhone] = useState('+595');
  const [name, setName] = useState('');
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [tplName, setTplName] = useState('');
  const [tplVars, setTplVars] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listTemplates()
      .then((tpls) => {
        setTemplates(tpls);
        if (tpls.length === 1) selectTemplate(tpls[0], tpls);
      })
      .catch((err) =>
        toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = templates.find((x) => x.name === tplName) ?? null;

  function selectTemplate(tpl: WaTemplate, pool: WaTemplate[] = templates) {
    void pool;
    setTplName(tpl.name);
    setTplVars(Array.from({ length: templateVarCount(tpl) }, () => ''));
  }

  const phoneDigits = phone.replace(/\D/g, '');
  const valid =
    phoneDigits.length >= 10 &&
    Boolean(selected) &&
    tplVars.every((v) => v.trim().length > 0);
  const disabledReason =
    phoneDigits.length < 10
      ? t('newConversation.invalidPhone')
      : !selected
        ? t('newConversation.pickTemplateFirst')
        : tplVars.some((v) => !v.trim())
          ? t('newConversation.fillVars')
          : '';

  async function submit() {
    if (!selected || busy || !valid) return;
    setBusy(true);
    try {
      const res = await sendOutboundTemplate({
        phoneE164: `+${phoneDigits}`,
        templateName: selected.name,
        language: selected.language,
        variables: tplVars.length ? tplVars : undefined,
        name: name.trim() || undefined,
        previewBody: renderTemplateBody(selected, tplVars),
      });
      toast.success(t('newConversation.success'));
      onCreated(res.conversationId);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800">
        <h3 className="text-base font-semibold">{t('newConversation.title')}</h3>
        <p className="mt-1 text-xs text-text-muted">{t('newConversation.hint')}</p>

        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-text-muted">
                {t('newConversation.phone')}
              </label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+595984053260"
                className="w-full rounded border border-slate-300 p-1.5 text-sm focus:border-brand-500 focus:outline-hidden dark:border-slate-600 dark:bg-slate-700"
              />
              <p className="mt-0.5 text-[10px] text-text-muted">{t('newConversation.phoneHint')}</p>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-text-muted">
                {t('newConversation.name')}
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('newConversation.namePlaceholder')}
                className="w-full rounded border border-slate-300 p-1.5 text-sm focus:border-brand-500 focus:outline-hidden dark:border-slate-600 dark:bg-slate-700"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-text-muted">
              {t('newConversation.template')}
            </label>
            <select
              value={tplName}
              onChange={(e) => {
                const tpl = templates.find((x) => x.name === e.target.value);
                if (tpl) selectTemplate(tpl);
                else {
                  setTplName('');
                  setTplVars([]);
                }
              }}
              className="w-full rounded border border-slate-300 p-1.5 text-sm focus:border-brand-500 focus:outline-hidden dark:border-slate-600 dark:bg-slate-700"
            >
              <option value="">{t('newConversation.templatePlaceholder')}</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.name}>
                  {tpl.name} · {tpl.language}
                </option>
              ))}
            </select>
            {templates.length === 0 && (
              <p className="mt-1 text-[11px] text-text-muted">{t('templates.empty')}</p>
            )}
          </div>

          {selected &&
            tplVars.map((val, i) => (
              <div key={i}>
                <label className="block text-[11px] font-medium text-text-muted">{`{{${i + 1}}}`}</label>
                <input
                  value={val}
                  onChange={(e) =>
                    setTplVars((s) => s.map((v, j) => (j === i ? e.target.value : v)))
                  }
                  placeholder={t('templates.varPlaceholder', { n: i + 1 })}
                  className="w-full rounded border border-slate-300 p-1.5 text-sm focus:border-brand-500 focus:outline-hidden dark:border-slate-600 dark:bg-slate-700"
                />
              </div>
            ))}

          {selected && (
            <p className="rounded bg-slate-50 p-2 text-[11px] text-text-muted dark:bg-slate-900/40">
              {renderTemplateBody(selected, tplVars)}
            </p>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-3">
          {disabledReason && (
            <span className="mr-auto text-[11px] text-amber-600 dark:text-amber-400">
              {disabledReason}
            </span>
          )}
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {tCommon('cancel')}
          </Button>
          <Button size="sm" loading={busy} disabled={!valid} onClick={() => void submit()}>
            {t('newConversation.send')}
          </Button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Thread column
// =============================================================================

function ChatThread({
  conversation,
  loading,
  canSend,
  canAssign,
  canAudit,
  currentUserId,
  onBack,
  onOpenPanel,
  onSent,
  onAssigned,
  onResolved,
}: {
  conversation: WaConversationDetail | undefined;
  loading: boolean;
  canSend: boolean;
  canAssign: boolean;
  canAudit: boolean;
  currentUserId: string | null;
  onBack: () => void;
  onOpenPanel: () => void;
  onSent: () => void;
  onAssigned: () => void;
  onResolved: () => void;
}) {
  const t = useTranslations('chat');
  const tCommon = useTranslations('common');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [insights, setInsights] = useState<WaAiInsightsResponse | null>(null);
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  // Template selecionado p/ preencher variáveis ({{1}}, {{2}}...) antes de enviar.
  const [selectedTpl, setSelectedTpl] = useState<WaTemplate | null>(null);
  const [tplVars, setTplVars] = useState<string[]>([]);
  const [agents, setAgents] = useState<WaAgent[] | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferBusy, setTransferBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll pro fim quando trocar de conversa ou chegar msg nova
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation?.messages.length, conversation?.id]);

  // Limpa insights e pickers (template/transferência) ao trocar de conversa.
  useEffect(() => {
    setInsights(null);
    setShowTemplates(false);
    setShowTransfer(false);
  }, [conversation?.id]);

  // IA conselheira: sugere resposta (preenche o composer) e resume a conversa.
  async function doSuggest() {
    if (aiBusy) return;
    setAiBusy(true);
    try {
      const r = await suggestWaReply(conversation!.id);
      setText(r.suggestion);
      toast.success(`Sugestão da IA (${r.provider}${r.usedFallback ? ' · nuvem' : ''})`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
    } finally {
      setAiBusy(false);
    }
  }

  async function doInsights() {
    if (aiBusy) return;
    setAiBusy(true);
    try {
      setInsights(await getWaInsights(conversation!.id));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
    } finally {
      setAiBusy(false);
    }
  }

  if (!conversation) {
    return (
      <section className="flex h-full items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-text-muted dark:border-slate-700 dark:bg-slate-800">
        {loading ? t('loading') : t('thread.empty')}
      </section>
    );
  }

  const isMine = conversation.assignedUserId === currentUserId;
  const isUnassigned = !conversation.assignedUserId;
  const isObserving = !isMine && !isUnassigned;
  const canType = canSend && (isMine || isUnassigned) && conversation.instance.status === 'CONNECTED';
  const name =
    conversation.contact.customer?.displayName ??
    conversation.contact.pushName ??
    conversation.contact.phoneE164;

  async function doSend() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await sendMessage(conversation!.id, text.trim());
      setText('');
      onSent();
    } catch (err) {
      // Meta fora da janela de 24h → backend pede template. Abre o picker.
      if (err instanceof ApiError && (err.problem as { requiresTemplate?: boolean })?.requiresTemplate) {
        toast.message(t('templates.windowClosed'));
        await openTemplatePicker();
        return;
      }
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function openTemplatePicker() {
    try {
      const tpls = await listTemplates();
      setTemplates(tpls);
      setShowTemplates(true);
      if (!tpls.length) toast.error(t('templates.empty'));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
    }
  }

  // Seleciona o template: se tiver variáveis ({{1}}...), abre o form pra
  // preencher; sem variáveis, envia direto. Evita o erro #132000 da Meta
  // (qtd de parâmetros enviada tem que bater com a do template).
  function pickTemplate(tpl: WaTemplate) {
    const n = templateVarCount(tpl);
    if (n === 0) {
      void doSendTemplate(tpl, []);
      return;
    }
    setSelectedTpl(tpl);
    setTplVars(Array.from({ length: n }, () => ''));
  }

  async function doSendTemplate(tpl: WaTemplate, variables: string[]) {
    if (busy) return;
    setBusy(true);
    try {
      await sendTemplateMessage(conversation!.id, {
        templateName: tpl.name,
        language: tpl.language,
        variables: variables.length ? variables : undefined,
        previewBody: renderTemplateBody(tpl, variables),
      });
      setShowTemplates(false);
      setSelectedTpl(null);
      setTplVars([]);
      setText('');
      onSent();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doAssignToMe() {
    if (!currentUserId) return;
    try {
      await assignConversation(conversation!.id, currentUserId);
      toast.success(t('actions.assignedToMe'));
      onAssigned();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(msg);
    }
  }

  async function doResolve() {
    try {
      await resolveConversation(conversation!.id);
      toast.success(t('actions.resolved'));
      onResolved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(msg);
    }
  }

  async function openTransfer() {
    if (showTransfer) {
      setShowTransfer(false);
      return;
    }
    setShowTransfer(true);
    if (!agents) {
      try {
        setAgents(await listAgents());
      } catch (err) {
        toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
        setShowTransfer(false);
      }
    }
  }

  async function doTransfer(userId: string) {
    if (transferBusy) return;
    setTransferBusy(true);
    try {
      await assignConversation(conversation!.id, userId);
      toast.success(t('actions.transferred'));
      setShowTransfer(false);
      onAssigned();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
    } finally {
      setTransferBusy(false);
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-3 dark:border-slate-700 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={onBack}
            aria-label="Voltar"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 md:hidden dark:hover:bg-slate-700"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
            style={{ background: avatarColor(name ?? conversation.contact.phoneE164 ?? '?') }}
          >
            {(name ?? conversation.contact.phoneE164 ?? '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold leading-tight">{name}</h2>
            <p className="truncate text-xs text-text-muted">
              {conversation.instance.name} · {conversation.contact.phoneE164}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="subtle" onClick={onOpenPanel} className="lg:hidden">
            <UserIcon className="mr-1 h-3.5 w-3.5" /> Cliente
          </Button>
          <Button size="sm" variant="subtle" onClick={doInsights} disabled={aiBusy}>
            <Sparkles className="mr-1 h-3.5 w-3.5" /> {aiBusy ? 'IA…' : 'Insights IA'}
          </Button>
          {isObserving && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              <Eye className="h-3.5 w-3.5" /> {t('thread.observing')}
            </span>
          )}
          {conversation.assignedUser && (
            <span className="text-xs text-text-muted">
              {t('thread.assignedTo', { name: `${conversation.assignedUser.firstName} ${conversation.assignedUser.lastName}` })}
            </span>
          )}
          {isUnassigned && canAssign && (
            <Button size="sm" variant="primary" onClick={doAssignToMe}>
              <UserCheck className="mr-1 h-3.5 w-3.5" /> {t('actions.takeIt')}
            </Button>
          )}
          {canAssign && (
            <div className="relative">
              <Button size="sm" variant="subtle" onClick={openTransfer}>
                <ArrowRightLeft className="mr-1 h-3.5 w-3.5" /> {t('actions.transfer')}
              </Button>
              {showTransfer && (
                <div className="absolute right-0 z-20 mt-1 max-h-72 w-60 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                  {!agents ? (
                    <p className="px-3 py-2 text-xs text-text-muted">{t('loading')}</p>
                  ) : (
                    (() => {
                      const others = agents.filter((a) => a.id !== conversation.assignedUserId);
                      if (others.length === 0) {
                        return (
                          <p className="px-3 py-2 text-xs text-text-muted">
                            {t('transfer.empty')}
                          </p>
                        );
                      }
                      return others.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          disabled={transferBusy}
                          onClick={() => doTransfer(a.id)}
                          className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-700"
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-700 dark:bg-slate-600 dark:text-slate-200">
                            {a.firstName.charAt(0).toUpperCase()}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {a.firstName} {a.lastName}
                            {a.id === currentUserId && ` ${t('transfer.you')}`}
                          </span>
                        </button>
                      ));
                    })()
                  )}
                </div>
              )}
            </div>
          )}
          {isMine && canAssign && (
            <Button size="sm" variant="subtle" onClick={doResolve}>
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> {t('actions.resolve')}
            </Button>
          )}
        </div>
      </header>

      {insights && (
        <div className="border-b border-violet-200 bg-violet-50 px-4 py-2 text-xs dark:border-violet-900/40 dark:bg-violet-900/20">
          <div className="mb-1 flex items-center gap-2 font-medium text-violet-800 dark:text-violet-300">
            <Sparkles className="h-3.5 w-3.5" /> Insights da IA
            <span className="ml-auto font-normal opacity-70">
              {insights.provider}
              {insights.usedFallback ? ' · nuvem' : ''}
            </span>
          </div>
          <p className="text-text-muted">{insights.summary}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <span className="rounded bg-violet-100 px-1.5 py-0.5 dark:bg-violet-900/40">
              intenção: {insights.intent}
            </span>
            <span className="rounded bg-violet-100 px-1.5 py-0.5 dark:bg-violet-900/40">
              sentimento: {insights.sentiment}
            </span>
            <span className="rounded bg-violet-100 px-1.5 py-0.5 dark:bg-violet-900/40">
              urgência: {insights.urgency}
            </span>
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-slate-50 px-4 py-4 sm:px-10 dark:bg-slate-900/40"
        style={{
          backgroundImage: 'radial-gradient(rgba(120,135,160,0.12) 1px, transparent 0)',
          backgroundSize: '20px 20px',
        }}
      >
        {conversation.messages.length === 0 ? (
          <div className="text-center text-xs text-text-muted">{t('thread.noMessages')}</div>
        ) : (
          <div className="space-y-1.5">
            {conversation.messages.map((m) => (
              <MessageBubble key={m.id} message={m} conversationId={conversation.id} />
            ))}
          </div>
        )}
      </div>

      <footer className="border-t border-slate-200 p-2 dark:border-slate-700">
        {!canType && (
          <div className="mb-2 rounded bg-slate-100 p-2 text-xs text-text-muted dark:bg-slate-700">
            {conversation.instance.status !== 'CONNECTED'
              ? t('thread.disconnected')
              : isObserving
              ? t('thread.readonly')
              : t('thread.unassigned')}
          </div>
        )}
        {showTemplates && (
          <div className="mb-2 max-h-56 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900/40">
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="text-xs font-semibold">{t('templates.title')}</span>
              <button
                type="button"
                className="text-xs text-text-muted hover:underline"
                onClick={() => {
                  setShowTemplates(false);
                  setSelectedTpl(null);
                  setTplVars([]);
                }}
              >
                {tCommon('cancel')}
              </button>
            </div>
            {selectedTpl ? (
              // Form de variáveis do template escolhido ({{1}}, {{2}}...).
              <div className="space-y-2 px-1">
                <button
                  type="button"
                  className="text-xs text-text-muted hover:underline"
                  onClick={() => {
                    setSelectedTpl(null);
                    setTplVars([]);
                  }}
                >
                  ← {selectedTpl.name} · {selectedTpl.language}
                </button>
                {tplVars.map((val, i) => (
                  <div key={i}>
                    <label className="block text-[11px] font-medium text-text-muted">{`{{${i + 1}}}`}</label>
                    <input
                      value={val}
                      onChange={(e) =>
                        setTplVars((s) => s.map((v, j) => (j === i ? e.target.value : v)))
                      }
                      className="w-full rounded border border-slate-300 p-1.5 text-xs focus:border-brand-500 focus:outline-hidden dark:border-slate-600 dark:bg-slate-700"
                      placeholder={t('templates.varPlaceholder', { n: i + 1 })}
                    />
                  </div>
                ))}
                <p className="rounded bg-white p-2 text-[11px] text-text-muted dark:bg-slate-800">
                  {renderTemplateBody(selectedTpl, tplVars)}
                </p>
                <Button
                  size="sm"
                  className="w-full"
                  loading={busy}
                  disabled={tplVars.some((v) => !v.trim())}
                  onClick={() => void doSendTemplate(selectedTpl, tplVars)}
                >
                  {t('templates.send')}
                </Button>
              </div>
            ) : templates.length === 0 ? (
              <p className="px-1 py-2 text-xs text-text-muted">{t('templates.empty')}</p>
            ) : (
              <ul className="space-y-1">
                {templates.map((tpl) => (
                  <li key={tpl.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => pickTemplate(tpl)}
                      className="w-full rounded p-2 text-left text-xs hover:bg-white disabled:opacity-50 dark:hover:bg-slate-800"
                    >
                      <span className="font-medium">{tpl.name}</span>
                      <span className="ml-1 text-text-muted">· {tpl.language}</span>
                      {tpl.bodyText && (
                        <span className="mt-0.5 block truncate text-text-muted">{tpl.bodyText}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!canType || busy}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void doSend();
              }
            }}
            placeholder={t('thread.placeholder')}
            rows={2}
            className="flex-1 resize-none rounded-md border border-slate-300 p-2 text-sm focus:border-brand-500 focus:outline-hidden disabled:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
          />
          {conversation.instance.channel === 'META_CLOUD' && (
            <Button
              onClick={() => void openTemplatePicker()}
              disabled={!canType || busy}
              size="sm"
              variant="subtle"
              title={t('templates.title')}
            >
              <FileText className="h-4 w-4" />
            </Button>
          )}
          <Button
            onClick={doSuggest}
            disabled={!canType || aiBusy || busy}
            size="sm"
            variant="subtle"
            title="Sugerir resposta com IA"
          >
            <Sparkles className="h-4 w-4" />
          </Button>
          {canType && (
            <AudioRecorder
              disabled={busy}
              onRecorded={async (blob) => {
                try {
                  await sendAudioMessage(conversation.id, blob);
                  onSent();
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
                }
              }}
            />
          )}
          <Button onClick={doSend} disabled={!canType || !text.trim() || busy} size="sm">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </footer>
    </section>
  );
}

/** Nº de variáveis do template = maior índice {{n}} no corpo (0 se não houver). */
function templateVarCount(tpl: WaTemplate): number {
  const body = tpl.bodyText ?? '';
  let max = 0;
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  return max;
}

/** Renderiza o corpo do template substituindo {{n}} pelos valores (preview/inbox). */
function renderTemplateBody(tpl: WaTemplate, variables: string[]): string {
  const body = tpl.bodyText ?? `[template: ${tpl.name}]`;
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, d) => {
    const v = variables[Number(d) - 1];
    return v && v.trim() ? v : `{{${d}}}`;
  });
}

/** Gravador de nota de voz no compositor (MediaRecorder → webm → backend). */
function AudioRecorder({
  onRecorded,
  disabled,
}: {
  onRecorded: (blob: Blob) => Promise<void>;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelRef = useRef(false);

  function cleanup() {
    if (timerRef.current) clearInterval(timerRef.current);
    recRef.current?.stream.getTracks().forEach((t) => t.stop());
  }
  useEffect(() => () => cleanup(), []);

  async function start() {
    if (disabled || busy) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      cancelRef.current = false;
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        cleanup();
        if (cancelRef.current) return;
        const blob = new Blob(chunksRef.current, { type: mime });
        if (blob.size < 800) return;
        setBusy(true);
        try {
          await onRecorded(blob);
        } finally {
          setBusy(false);
        }
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      toast.error('Não consegui acessar o microfone. Permita o acesso no navegador.');
    }
  }

  function stop(cancel: boolean) {
    cancelRef.current = cancel;
    setRecording(false);
    try {
      recRef.current?.stop();
    } catch {
      cleanup();
    }
  }

  if (busy) return <span className="px-2 text-xs text-text-muted">enviando…</span>;
  if (recording) {
    const mm = Math.floor(seconds / 60);
    const ss = String(seconds % 60).padStart(2, '0');
    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => stop(true)}
          title="Cancelar"
          className="rounded-md p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-700"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        <span className="flex items-center gap-1 text-xs font-medium text-rose-600">
          <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
          {mm}:{ss}
        </span>
        <Button onClick={() => stop(false)} size="sm" title="Enviar áudio">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    );
  }
  return (
    <Button onClick={start} disabled={disabled} size="sm" variant="subtle" title="Gravar áudio">
      <Mic className="h-4 w-4" />
    </Button>
  );
}

function MessageBubble({ message, conversationId }: { message: WaMessage; conversationId: string }) {
  const tx = useTranslations('chatExtra');
  const isOut = message.direction === 'OUT';
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const mediaUrl = resolveMediaUrl(message.mediaUrl);
  const [transcription, setTranscription] = useState<string | null>(message.transcription ?? null);
  const [transcribing, setTranscribing] = useState(false);

  async function doTranscribe() {
    if (transcribing) return;
    setTranscribing(true);
    try {
      const r = await transcribeMessage(conversationId, message.id);
      setTranscription(r.transcription);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
    } finally {
      setTranscribing(false);
    }
  }
  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] min-w-0 rounded-2xl px-3 py-2 text-sm shadow-sm sm:max-w-[70%] ${
          isOut
            ? 'rounded-tr-sm bg-brand-50 text-slate-800 ring-1 ring-brand-100 dark:bg-brand-900/30 dark:text-slate-100 dark:ring-brand-900/50'
            : 'rounded-tl-sm bg-white text-slate-800 ring-1 ring-slate-200 dark:bg-slate-700 dark:text-slate-100 dark:ring-slate-600'
        }`}
      >
        {!isOut && message.authorName && (
          <p className="mb-0.5 text-xs font-semibold text-brand-700 dark:text-brand-300">
            {message.authorName}
          </p>
        )}
        {isOut && message.fromUser && message.fromUser.chatPrefs?.showName !== false && (
          <p className="mb-0.5 text-xs font-semibold text-brand-700 dark:text-brand-300">
            {[message.fromUser.firstName, message.fromUser.lastName].filter(Boolean).join(' ')}
          </p>
        )}
        {message.type === 'IMAGE' && mediaUrl && (
          <img src={mediaUrl} alt="" className="mb-1 rounded max-w-full" />
        )}
        {message.type === 'STICKER' && mediaUrl && (
          <img src={mediaUrl} alt="" className="mb-1 h-32 w-32 object-contain" />
        )}
        {message.type === 'AUDIO' && mediaUrl && (
          <div className="mb-1">
            <audio controls src={mediaUrl} className="max-w-full" />
            {transcription ? (
              <p className="mt-1 rounded-md bg-black/5 px-2 py-1 text-xs italic text-slate-600 dark:bg-white/10 dark:text-slate-300">
                <span className="mr-1 not-italic">📝</span>“{transcription}”
              </p>
            ) : (
              <button
                type="button"
                onClick={doTranscribe}
                disabled={transcribing}
                className="mt-1 inline-flex items-center gap-1 text-xs text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-300"
              >
                📝 {transcribing ? tx('transcribing') : tx('transcribe')}
              </button>
            )}
          </div>
        )}
        {message.type === 'VIDEO' && mediaUrl && (
          <video controls src={mediaUrl} className="mb-1 max-w-full" />
        )}
        {message.type === 'DOCUMENT' && mediaUrl && (
          <a href={mediaUrl} target="_blank" rel="noopener noreferrer" className="underline">
            📎 {message.body ?? tx('document')}
          </a>
        )}
        {message.body && (
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.body}</p>
        )}
        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-400 dark:text-slate-400">
          {isOut && message.isBot && (
            <span className="mr-0.5 inline-flex items-center gap-0.5 font-medium">
              <Bot className="h-3 w-3" /> {tx('bot')}
            </span>
          )}
          <span>{time}</span>
          {isOut && (
            <span className={message.status === 'READ' ? 'text-brand-500' : ''}>
              {message.status === 'READ' || message.status === 'DELIVERED'
                ? '✓✓'
                : message.status === 'SENT'
                  ? '✓'
                  : message.status === 'FAILED'
                    ? '✗'
                    : '⌛'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Context column (cliente reconhecido)



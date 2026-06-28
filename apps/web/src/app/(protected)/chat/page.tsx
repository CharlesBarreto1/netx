'use client';

import {
  ArrowLeft,
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
  getConversation,
  getWaInsights,
  listConversations,
  listTemplates,
  resolveConversation,
  resolveMediaUrl,
  sendMessage,
  sendTemplateMessage,
  suggestWaReply,
  timeAgo,
  type InboxFilter,
  type WaAiInsightsResponse,
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

  const [filter, setFilter] = useState<InboxFilter>('mine');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Painel do cliente como drawer fora do desktop (lg). Fecha ao trocar de conversa.
  const [panelOpen, setPanelOpen] = useState(false);
  useEffect(() => setPanelOpen(false), [selectedId]);

  const inboxQuery = useSWR<WaConversationListItem[]>(
    `/whatsapp/conversations?${filter}`,
    () => listConversations(filter),
    { refreshInterval: 0 }, // realtime via SSE
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
      // Sempre atualiza inbox
      void inboxQuery.mutate();
      // Se for da conversa aberta, atualiza detalhe
      if (p.conversationId === selectedId) {
        void detailQuery.mutate();
      } else if (p.direction === 'IN' && !p.isGroup) {
        // Notif pra mensagem que chegou em outra conversa (grupos não notificam —
        // são barulhentos; aparecem na aba Grupos sem som).
        notify({
          title: t('notification.newMessage'),
          body: p.body ?? t('notification.media'),
          tag: p.conversationId,
          onClick: () => setSelectedId(p.conversationId),
        });
      }
    } else if (
      e.type === 'conversation.updated' ||
      e.type === 'conversation.assigned' ||
      e.type === 'conversation.resolved'
    ) {
      void inboxQuery.mutate();
      if ((e.payload as { id?: string }).id === selectedId) {
        void detailQuery.mutate();
      }
    }
  });

  const refetchAll = () => {
    void detailQuery.mutate();
    void inboxQuery.mutate();
  };

  return (
    <div className="grid h-[calc(100dvh-150px)] grid-cols-1 gap-3 md:grid-cols-[clamp(260px,30vw,340px)_1fr] lg:grid-cols-[clamp(280px,24vw,340px)_1fr_clamp(320px,26vw,380px)]">
      {/* Inbox — no mobile some quando uma conversa está aberta */}
      <div className={`min-w-0 ${selectedId ? 'hidden md:block' : ''}`}>
        <ChatInbox
          filter={filter}
          setFilter={setFilter}
          selectedId={selectedId}
          onSelect={setSelectedId}
          items={inboxQuery.data}
          loading={inboxQuery.isLoading}
          soundEnabled={soundEnabled}
          setSoundEnabled={setSoundEnabled}
        />
      </div>

      {/* Conversa — no mobile só aparece quando há uma selecionada */}
      <div className={`min-w-0 ${selectedId ? '' : 'hidden md:block'}`}>
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
      <div className="hidden min-w-0 lg:block">
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
  soundEnabled,
  setSoundEnabled,
}: {
  filter: InboxFilter;
  setFilter: (f: InboxFilter) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  items: WaConversationListItem[] | undefined;
  loading: boolean;
  soundEnabled: boolean;
  setSoundEnabled: (v: boolean) => void;
}) {
  const t = useTranslations('chat');
  const tx = useTranslations('chatExtra');
  const filters: Array<{ key: InboxFilter; label: string }> = [
    { key: 'mine', label: t('inbox.filter.mine') },
    { key: 'unassigned', label: t('inbox.filter.unassigned') },
    { key: 'all', label: t('inbox.filter.all') },
    { key: 'resolved', label: t('inbox.filter.resolved') },
    { key: 'groups', label: t('inbox.filter.groups') },
  ];

  return (
    <aside className="flex h-full flex-col rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <header className="flex items-center justify-between border-b border-slate-200 p-3 dark:border-slate-700">
        <h2 className="text-sm font-semibold">{t('inbox.title')}</h2>
        <button
          type="button"
          aria-label={soundEnabled ? t('sound.disable') : t('sound.enable')}
          title={soundEnabled ? t('sound.disable') : t('sound.enable')}
          onClick={() => setSoundEnabled(!soundEnabled)}
          className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
        >
          {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </button>
      </header>

      <div className="flex flex-wrap gap-1 border-b border-slate-200 p-2 dark:border-slate-700">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`flex-1 rounded-md px-2 py-1 text-xs ${
              filter === f.key
                ? 'bg-brand-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
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
                className={`flex w-full items-start gap-3 border-b border-slate-100 px-3 py-3 text-left hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700 ${
                  isSelected ? 'bg-brand-50 dark:bg-slate-700' : ''
                }`}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-slate-600 dark:text-slate-200">
                  {isGroup ? <Users className="h-4 w-4" /> : name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1 truncate text-sm font-medium">
                      {isGroup && <Users className="h-3 w-3 shrink-0 text-text-muted" />}
                      <span className="truncate">{name}</span>
                    </span>
                    <span className="shrink-0 text-[10px] text-text-muted">
                      {timeAgo(c.lastMessageAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="line-clamp-1 flex-1 text-xs text-text-muted">
                      {last
                        ? last.direction === 'OUT'
                          ? `→ ${last.body ?? tx('media')}`
                          : last.body ?? tx('media')
                        : '—'}
                    </span>
                    {c.unreadCount > 0 && (
                      <span className="shrink-0 rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {c.unreadCount}
                      </span>
                    )}
                  </div>
                  {c.contact.customer && (
                    <span className="mt-1 inline-block rounded bg-emerald-100 px-1 py-0.5 text-[9px] uppercase tracking-wider text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                      {tx('customerBadge')}
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
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
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll pro fim quando trocar de conversa ou chegar msg nova
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation?.messages.length, conversation?.id]);

  // Limpa insights e picker de template ao trocar de conversa.
  useEffect(() => {
    setInsights(null);
    setShowTemplates(false);
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

  async function doSendTemplate(tpl: WaTemplate) {
    if (busy) return;
    setBusy(true);
    try {
      await sendTemplateMessage(conversation!.id, {
        templateName: tpl.name,
        language: tpl.language,
        previewBody: tpl.bodyText ?? `[template: ${tpl.name}]`,
      });
      setShowTemplates(false);
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

  return (
    <section className="flex h-full flex-col rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-3 dark:border-slate-700 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={onBack}
            aria-label="Voltar"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 md:hidden dark:hover:bg-slate-700"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{name}</h2>
            <p className="truncate text-xs text-text-muted">{conversation.contact.phoneE164}</p>
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

      <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto p-4">
        {conversation.messages.length === 0 ? (
          <div className="text-center text-xs text-text-muted">{t('thread.noMessages')}</div>
        ) : (
          <div className="space-y-2">
            {conversation.messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
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
                onClick={() => setShowTemplates(false)}
              >
                {tCommon('cancel')}
              </button>
            </div>
            {templates.length === 0 ? (
              <p className="px-1 py-2 text-xs text-text-muted">{t('templates.empty')}</p>
            ) : (
              <ul className="space-y-1">
                {templates.map((tpl) => (
                  <li key={tpl.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void doSendTemplate(tpl)}
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
          <Button onClick={doSend} disabled={!canType || !text.trim() || busy} size="sm">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </footer>
    </section>
  );
}

function MessageBubble({ message }: { message: WaMessage }) {
  const tx = useTranslations('chatExtra');
  const isOut = message.direction === 'OUT';
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const mediaUrl = resolveMediaUrl(message.mediaUrl);
  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] min-w-0 rounded-lg px-3 py-2 text-sm shadow-sm sm:max-w-[75%] ${
          isOut
            ? 'bg-brand-600 text-white'
            : 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-100'
        }`}
      >
        {!isOut && message.authorName && (
          <p className="mb-0.5 text-xs font-semibold text-brand-700 dark:text-brand-300">
            {message.authorName}
          </p>
        )}
        {message.type === 'IMAGE' && mediaUrl && (
          <img src={mediaUrl} alt="" className="mb-1 rounded max-w-full" />
        )}
        {message.type === 'AUDIO' && mediaUrl && (
          <audio controls src={mediaUrl} className="mb-1 max-w-full" />
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
        <div
          className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
            isOut ? 'text-white/70' : 'text-text-muted'
          }`}
        >
          <span>{time}</span>
          {isOut && (
            <span>
              {message.status === 'READ' ? '✓✓' : message.status === 'DELIVERED' ? '✓✓' : message.status === 'SENT' ? '✓' : message.status === 'FAILED' ? '✗' : '⌛'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Context column (cliente reconhecido)



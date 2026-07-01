'use client';

import { AlarmClock, Bell, CheckCheck, CheckSquare, MessageSquare, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useNotifications } from '@/lib/use-notifications';
import type { AppNotification } from '@/lib/notifications-api';
import { cn } from '@/lib/cn';

/** Ícone por tipo/hint. `icon` livre vindo do módulo emissor. */
function iconFor(n: AppNotification) {
  const key = n.icon ?? n.type.split('.')[0];
  if (key === 'message' || key === 'chat') return MessageSquare;
  if (key === 'alarm' || key === 'nms') return AlarmClock;
  if (key === 'task') return CheckSquare;
  return Bell;
}

function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'agora';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * Sino global de notificações — à esquerda da busca no topbar. Aparece SÓ quando
 * há não-lidas (some quando limpo); balança e muda de cor pra chamar atenção.
 * Presente em todas as telas (montado no AppShell).
 */
export function NotificationBell() {
  const t = useTranslations('notifications');
  const router = useRouter();
  const { items, unread, markRead, markAllRead, clearOne, clearAll } = useNotifications(true);
  const [open, setOpen] = useState(false);

  // "some quando limpo": sem não-lidas e fechado → não renderiza nada.
  if (unread === 0 && !open) return null;

  function openItem(n: AppNotification) {
    if (!n.readAt) void markRead(n.id);
    setOpen(false);
    if (n.href) router.push(n.href);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('title')}
        title={t('title')}
        className={cn(
          'relative inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors',
          unread > 0
            ? 'text-amber-500 hover:bg-amber-500/10'
            : 'text-text-muted hover:bg-surface-hover',
        )}
      >
        <Bell className={cn('h-5 w-5', unread > 0 && 'origin-top animate-bell-swing')} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-surface">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-[min(92vw,360px)] overflow-hidden rounded-xl border border-border bg-surface shadow-pop">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-sm font-semibold text-text">{t('title')}</span>
              <div className="flex items-center gap-1">
                {unread > 0 && (
                  <button
                    type="button"
                    onClick={() => void markAllRead()}
                    title={t('markAllRead')}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-text-muted hover:bg-surface-hover"
                  >
                    <CheckCheck className="h-3.5 w-3.5" /> {t('markAllRead')}
                  </button>
                )}
                {items.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void clearAll()}
                    title={t('clearAll')}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-text-muted hover:bg-surface-hover"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="max-h-[70vh] overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-3 py-8 text-center text-xs text-text-muted">{t('empty')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {items.map((n) => {
                    const Icon = iconFor(n);
                    return (
                      <li
                        key={n.id}
                        className={cn(
                          'group relative flex cursor-pointer gap-2.5 px-3 py-2.5 hover:bg-surface-hover',
                          !n.readAt && 'bg-amber-500/5',
                        )}
                        onClick={() => openItem(n)}
                      >
                        <span
                          className={cn(
                            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                            n.readAt ? 'bg-surface-hover text-text-muted' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className={cn('truncate text-sm', n.readAt ? 'text-text-muted' : 'font-semibold text-text')}>
                              {n.title}
                            </p>
                            <span className="shrink-0 text-[10px] text-text-subtle">{ago(n.createdAt)}</span>
                          </div>
                          {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-text-muted">{n.body}</p>}
                        </div>
                        {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />}
                        <button
                          type="button"
                          aria-label={t('clear')}
                          onClick={(e) => {
                            e.stopPropagation();
                            void clearOne(n.id);
                          }}
                          className="absolute right-1 top-1 hidden rounded p-1 text-text-subtle hover:bg-surface-hover hover:text-text group-hover:block"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

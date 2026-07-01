'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  clearNotification,
  clearAllNotifications,
  type AppNotification,
} from './notifications-api';

const ACCESS_TOKEN_KEY = 'netx.accessToken';

/**
 * Estado global do sino de notificações. Busca a lista no mount, assina o SSE
 * `/v1/notifications/stream` pra realtime e faz poll leve de fallback (caso o
 * SSE caia). Exponde as ações (marcar lida / limpar). Usado pelo NotificationBell
 * no AppShell — presente em todas as telas.
 */
export function useNotifications(enabled: boolean) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await listNotifications();
      setItems(r.items);
      setUnread(r.unread);
    } catch {
      /* silencioso — mantém o estado atual */
    }
  }, []);

  // Fetch inicial + poll de fallback (45s).
  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    void refresh().finally(() => setLoading(false));
    const iv = setInterval(() => void refresh(), 45_000);
    return () => clearInterval(iv);
  }, [enabled, refresh]);

  // SSE realtime: qualquer evento re-sincroniza (volume baixo, simples e correto).
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const token = localStorage.getItem(ACCESS_TOKEN_KEY);
    if (!token) return;
    const base = (process.env.NEXT_PUBLIC_API_URL ?? '/api').replace(/\/$/, '');
    const url = `${base}/v1/notifications/stream?access_token=${encodeURIComponent(token)}`;
    let es: EventSource | null = null;
    try {
      es = new EventSource(url);
    } catch {
      return;
    }
    const onEvt = () => void refresh();
    ['notification.created', 'notification.read', 'notification.cleared'].forEach((n) =>
      es!.addEventListener(n, onEvt),
    );
    return () => {
      ['notification.created', 'notification.read', 'notification.cleared'].forEach((n) =>
        es!.removeEventListener(n, onEvt),
      );
      es!.close();
    };
  }, [enabled, refresh]);

  // Ações otimistas — atualizam o estado na hora e re-sincronizam depois.
  const markRead = useCallback(async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    setUnread((u) => Math.max(0, u - 1));
    try {
      await markNotificationRead(id);
    } catch {
      void refresh();
    }
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })));
    setUnread(0);
    try {
      await markAllNotificationsRead();
    } catch {
      void refresh();
    }
  }, [refresh]);

  const clearOne = useCallback(async (id: string) => {
    // Remove otimista; o refresh recalcula o contador de não-lidas.
    setItems((prev) => prev.filter((n) => n.id !== id));
    try {
      await clearNotification(id);
    } finally {
      void refresh();
    }
  }, [refresh]);

  const clearAll = useCallback(async () => {
    setItems([]);
    setUnread(0);
    try {
      await clearAllNotifications();
    } catch {
      void refresh();
    }
  }, [refresh]);

  return { items, unread, loading, refresh, markRead, markAllRead, clearOne, clearAll };
}

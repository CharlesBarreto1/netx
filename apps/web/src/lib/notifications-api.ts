/**
 * Cliente do centro de notificações (sino global).
 *
 * Rotas (core-service via gateway):
 *   GET    /v1/notifications              — lista + total não-lidas
 *   GET    /v1/notifications/unread-count — só o contador
 *   POST   /v1/notifications/read-all
 *   POST   /v1/notifications/:id/read
 *   DELETE /v1/notifications/:id
 *   DELETE /v1/notifications              — limpa todas
 *   GET    /v1/notifications/stream       — SSE (useNotifications)
 */

import { api } from './api';

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  icon: string | null;
  data: unknown;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsList {
  items: AppNotification[];
  unread: number;
}

export async function listNotifications() {
  return api.get<NotificationsList>(`/v1/notifications`);
}

export async function getUnreadCount() {
  return api.get<{ unread: number }>(`/v1/notifications/unread-count`);
}

export async function markNotificationRead(id: string) {
  return api.post<{ unread: number }>(`/v1/notifications/${id}/read`, {});
}

export async function markAllNotificationsRead() {
  return api.post<{ unread: number }>(`/v1/notifications/read-all`, {});
}

export async function clearNotification(id: string) {
  return api.delete(`/v1/notifications/${id}`);
}

export async function clearAllNotifications() {
  return api.delete(`/v1/notifications`);
}

/** Dispara uma notificação pra outro usuário (exige notifications.dispatch). */
export interface DispatchNotificationInput {
  userId: string;
  type: string;
  title: string;
  body?: string;
  href?: string;
  icon?: string;
  data?: Record<string, unknown>;
}

export async function dispatchNotification(input: DispatchNotificationInput) {
  return api.post<AppNotification>(`/v1/notifications/dispatch`, input);
}

/**
 * Cliente do módulo Atendimento (WhatsApp via Evolution API).
 *
 * Endpoints expostos pelo backend (proxiados pelo gateway → core-service):
 *   /v1/whatsapp/conversations         GET (filter), GET :id
 *   /v1/whatsapp/conversations/:id/assign|resolve|messages   POST
 *   /v1/whatsapp/instances             GET, POST, GET :id
 *   /v1/whatsapp/instances/:id/connect|logout                POST
 *   /v1/whatsapp/instances/:id         DELETE
 *   /v1/whatsapp/stream                GET (SSE — usado pelo hook useWhatsappStream)
 *   /v1/whatsapp/media/:filename       GET (já é absoluto-relative no body do msg)
 */

import type { WaAiInsightsResponse, WaAiSuggestResponse } from '@netx/shared';

import { api } from './api';

export type { WaAiInsightsResponse, WaAiSuggestResponse };

export type WaInstanceStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';
export type WaConversationStatus = 'OPEN' | 'RESOLVED' | 'ARCHIVED';
export type WaMsgDirection = 'IN' | 'OUT';
export type WaMsgType =
  | 'TEXT'
  | 'IMAGE'
  | 'AUDIO'
  | 'VIDEO'
  | 'DOCUMENT'
  | 'LOCATION'
  | 'STICKER'
  | 'CONTACT'
  | 'UNKNOWN';
export type WaMsgStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface WaInstance {
  id: string;
  name: string;
  instanceName: string;
  evolutionUrl: string;
  phoneE164: string | null;
  status: WaInstanceStatus;
  qrCode?: string | null;
  active: boolean;
  connectedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WaContact {
  id: string;
  phoneE164: string;
  pushName: string | null;
  customerId: string | null;
  customer?: {
    id: string;
    displayName: string;
    code: string | null;
    status: string;
    type: string;
    primaryPhone?: string | null;
    primaryEmail?: string | null;
  } | null;
}

export interface WaConversationListItem {
  id: string;
  status: WaConversationStatus;
  assignedUserId: string | null;
  lastMessageAt: string;
  lastInboundAt: string | null;
  unreadCount: number;
  contact: WaContact;
  instance: { id: string; name: string; phoneE164: string | null; status: WaInstanceStatus };
  assignedUser: { id: string; firstName: string; lastName: string; email: string } | null;
  messages: Array<{
    id: string;
    body: string | null;
    type: WaMsgType;
    direction: WaMsgDirection;
    createdAt: string;
  }>;
}

export interface WaMessage {
  id: string;
  direction: WaMsgDirection;
  type: WaMsgType;
  body: string | null;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  status: WaMsgStatus;
  errorReason: string | null;
  createdAt: string;
  fromUserId: string | null;
  fromUser?: { id: string; firstName: string; lastName: string } | null;
}

export interface WaConversationDetail extends WaConversationListItem {
  messages: WaMessage[];
  resolvedAt: string | null;
}

export type InboxFilter = 'mine' | 'unassigned' | 'all' | 'resolved';

// ---- conversations ----

export async function listConversations(filter: InboxFilter = 'mine') {
  return api.get<WaConversationListItem[]>(`/v1/whatsapp/conversations?filter=${filter}`);
}

export async function getConversation(id: string) {
  return api.get<WaConversationDetail>(`/v1/whatsapp/conversations/${id}`);
}

export async function assignConversation(id: string, userId: string | null) {
  return api.post(`/v1/whatsapp/conversations/${id}/assign`, { userId });
}

export async function resolveConversation(id: string) {
  return api.post(`/v1/whatsapp/conversations/${id}/resolve`, {});
}

export async function sendMessage(conversationId: string, text: string) {
  return api.post<WaMessage>(`/v1/whatsapp/conversations/${conversationId}/messages`, { text });
}

// ---- IA conselheira (read-only: sugere/resume, nunca envia) ----
export async function suggestWaReply(conversationId: string) {
  return api.post<WaAiSuggestResponse>(
    `/v1/whatsapp/conversations/${conversationId}/ai/suggest`,
  );
}

export async function getWaInsights(conversationId: string) {
  return api.get<WaAiInsightsResponse>(
    `/v1/whatsapp/conversations/${conversationId}/ai/insights`,
  );
}

// ---- instances (admin) ----

export async function listInstances() {
  return api.get<WaInstance[]>(`/v1/whatsapp/instances`);
}

export async function getInstance(id: string) {
  return api.get<WaInstance>(`/v1/whatsapp/instances/${id}`);
}

export async function createInstance(input: {
  name: string;
  evolutionUrl?: string;
  apiKey: string;
  instanceName: string;
}) {
  return api.post<WaInstance>(`/v1/whatsapp/instances`, input);
}

export async function reconnectInstance(id: string) {
  return api.post<WaInstance>(`/v1/whatsapp/instances/${id}/connect`, {});
}

export async function logoutInstance(id: string) {
  return api.post<WaInstance>(`/v1/whatsapp/instances/${id}/logout`, {});
}

export async function deleteInstance(id: string) {
  return api.delete(`/v1/whatsapp/instances/${id}`);
}

// ---- helpers ----

/**
 * Resolve URL de mídia. Mensagens vêm com mediaUrl relativo `/v1/whatsapp/media/<file>`,
 * que precisa do prefixo do gateway pra carregar no <img/>.
 */
export function resolveMediaUrl(mediaUrl: string | null): string | null {
  if (!mediaUrl) return null;
  const base = (process.env.NEXT_PUBLIC_API_URL ?? '/api').replace(/\/$/, '');
  // mediaUrl já vem como /v1/...
  return `${base}${mediaUrl}`;
}

export function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function timeAgo(iso: string, locale: string = 'pt-BR'): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'agora';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
}

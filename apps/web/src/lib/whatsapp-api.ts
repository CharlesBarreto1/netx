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

import { api, apiUpload } from './api';

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

export type WaChannel = 'WAHA' | 'META_CLOUD';

export interface WaInstance {
  id: string;
  name: string;
  channel: WaChannel;
  instanceName: string;
  evolutionUrl: string;
  phoneE164: string | null;
  status: WaInstanceStatus;
  qrCode?: string | null;
  active: boolean;
  captureGroups?: boolean;
  connectedAt: string | null;
  lastError: string | null;
  wabaId?: string | null;
  phoneNumberId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WaTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  bodyText: string | null;
}

export interface WaContact {
  id: string;
  phoneE164: string | null;
  pushName: string | null;
  customerId: string | null;
  isGroup?: boolean;
  waGroupId?: string | null;
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

/** Operador que entrou num grupo (atendimento compartilhado do NOC). */
export interface WaMember {
  userId: string;
  joinedAt: string;
  user: { id: string; firstName: string; lastName: string };
}

export interface WaConversationListItem {
  id: string;
  status: WaConversationStatus;
  assignedUserId: string | null;
  botActive?: boolean;
  lastMessageAt: string;
  lastInboundAt: string | null;
  unreadCount: number;
  contact: WaContact;
  instance: { id: string; name: string; phoneE164: string | null; status: WaInstanceStatus; channel: WaChannel };
  assignedUser: { id: string; firstName: string; lastName: string; email: string } | null;
  members?: WaMember[];
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
  fromUser?: {
    id: string;
    firstName: string;
    lastName: string;
    chatPrefs?: { showName?: boolean } | null;
  } | null;
  isBot?: boolean;
  authorName?: string | null;
  authorPhone?: string | null;
  transcription?: string | null;
}

export interface WaConversationDetail extends WaConversationListItem {
  messages: WaMessage[];
  resolvedAt: string | null;
}

export type InboxFilter =
  | 'mine'
  | 'unassigned'
  | 'all'
  | 'resolved'
  | 'groups'
  | 'groupsMine'
  | 'andamento'
  | 'espera'
  | 'automacao';

export interface WaConversationCounts {
  andamento: number;
  espera: number;
  automacao: number;
  resolved: number;
}

export async function getConversationCounts() {
  return api.get<WaConversationCounts>(`/v1/whatsapp/conversations/counts`);
}

export interface WaAgentSettings {
  greeting: string;
  showName: boolean;
}

export async function getAgentSettings() {
  return api.get<WaAgentSettings>(`/v1/whatsapp/agent-settings`);
}

export async function updateAgentSettings(input: Partial<WaAgentSettings>) {
  return api.put<WaAgentSettings>(`/v1/whatsapp/agent-settings`, input);
}

// ---- respostas rápidas (mensagens predefinidas) ----

/** Categorias sugeridas. Livre — o backend aceita qualquer string. */
export const QUICK_REPLY_CATEGORIES = [
  'saudacao',
  'encerramento',
  'viabilidade',
  'planos',
  'prazos',
  'geral',
] as const;
export type QuickReplyCategory = (typeof QUICK_REPLY_CATEGORIES)[number];

export interface WaQuickReply {
  id: string;
  ownerUserId: string | null; // null = compartilhada (equipe); set = pessoal
  category: string;
  title: string;
  body: string;
  shortcut: string | null;
  sortOrder: number;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuickReplyInput {
  scope: 'shared' | 'personal';
  category: string;
  title: string;
  body: string;
  shortcut?: string | null;
  sortOrder?: number;
}

export async function listQuickReplies() {
  return api.get<WaQuickReply[]>(`/v1/whatsapp/quick-replies`);
}

export async function createQuickReply(input: QuickReplyInput) {
  return api.post<WaQuickReply>(`/v1/whatsapp/quick-replies`, input);
}

export async function updateQuickReply(id: string, input: Partial<QuickReplyInput>) {
  return api.put<WaQuickReply>(`/v1/whatsapp/quick-replies/${id}`, input);
}

export async function deleteQuickReply(id: string) {
  return api.delete(`/v1/whatsapp/quick-replies/${id}`);
}

/** Interpola {cliente} e {operador} no corpo de uma resposta rápida. */
export function fillQuickReply(
  body: string,
  vars: { cliente?: string | null; operador?: string | null },
): string {
  return body
    .replace(/\{cliente\}/gi, vars.cliente?.trim() || '')
    .replace(/\{operador\}/gi, vars.operador?.trim() || '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// ---- conversations ----

export async function listConversations(filter: InboxFilter = 'mine') {
  return api.get<WaConversationListItem[]>(`/v1/whatsapp/conversations?filter=${filter}`);
}

export async function getConversation(id: string) {
  return api.get<WaConversationDetail>(`/v1/whatsapp/conversations/${id}`);
}

export async function loadOlderMessages(id: string, before: string) {
  return api.get<WaMessage[]>(
    `/v1/whatsapp/conversations/${id}/messages?before=${encodeURIComponent(before)}`,
  );
}

// ---- contexto do cliente (painel do atendente) ----

export interface WaContractCtx {
  id: string;
  code: string | null;
  status: string;
  suspendReason: string | null;
  trustExtensionUntil: string | null;
  planName: string | null;
  monthlyValue: number;
  bandwidthMbps: number;
  uploadMbps: number | null;
  pppoeUsername: string | null;
}

export interface WaCustomerContext {
  contact: { id: string; phoneE164: string | null; pushName: string | null; customerId: string | null };
  customer: {
    id: string;
    displayName: string;
    code: string | null;
    status: string;
    type: string;
    primaryPhone: string | null;
    primaryEmail: string | null;
  } | null;
  contracts: WaContractCtx[];
}

export async function getCustomerContext(conversationId: string) {
  return api.get<WaCustomerContext>(
    `/v1/whatsapp/conversations/${conversationId}/customer-context`,
  );
}

export function customerContextPath(conversationId: string) {
  return `/v1/whatsapp/conversations/${conversationId}/customer-context`;
}

/** Vincula (ou desvincula com null) o contato a um cliente. */
export async function linkContactCustomer(contactId: string, customerId: string | null) {
  return api.patch(`/v1/whatsapp/contacts/${contactId}`, { customerId });
}

export interface WaCustomerHit {
  id: string;
  displayName: string;
  code: string | null;
  status: string;
  primaryPhone: string | null;
}

/** Busca rápida de clientes pro vínculo manual. */
export async function searchCustomers(q: string) {
  const res = await api.get<{ data: WaCustomerHit[] }>(
    `/v1/customers?search=${encodeURIComponent(q)}&pageSize=10`,
  );
  return res.data ?? [];
}

export async function assignConversation(id: string, userId: string | null) {
  return api.post(`/v1/whatsapp/conversations/${id}/assign`, { userId });
}

export interface WaAgent {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

/** Agentes elegíveis para receber uma transferência (têm permissão chat.*). */
export async function listAgents() {
  return api.get<WaAgent[]>(`/v1/whatsapp/agents`);
}

export async function resolveConversation(id: string) {
  return api.post(`/v1/whatsapp/conversations/${id}/resolve`, {});
}

/** Entra num grupo (NOC) — passa a responder e ser notificado. Vários ao mesmo tempo. */
export async function joinGroup(id: string) {
  return api.post<WaMember[]>(`/v1/whatsapp/conversations/${id}/join`, {});
}

/** Sai de um grupo — deixa de responder/ser notificado. */
export async function leaveGroup(id: string) {
  return api.post<WaMember[]>(`/v1/whatsapp/conversations/${id}/leave`, {});
}

export async function sendMessage(conversationId: string, text: string, mentions?: string[]) {
  return api.post<WaMessage>(`/v1/whatsapp/conversations/${conversationId}/messages`, {
    text,
    ...(mentions?.length ? { mentions } : {}),
  });
}

// ---- presença (quem está online / vendo qual grupo) ----

export interface WaPresence {
  userId: string;
  viewingConversationId: string | null;
}

/** Heartbeat: marca este operador online (com a conversa aberta) e devolve os online. */
export async function heartbeatPresence(conversationId: string | null) {
  return api.post<{ online: WaPresence[] }>(`/v1/whatsapp/presence`, { conversationId });
}

/** Envia uma nota de voz gravada no navegador (multipart). */
export async function sendAudioMessage(conversationId: string, blob: Blob) {
  const fd = new FormData();
  fd.append('file', blob, 'voice.webm');
  return apiUpload<WaMessage>(`/v1/whatsapp/conversations/${conversationId}/messages/audio`, fd);
}

/** Envia uma imagem ou arquivo anexado (multipart). `caption` é a legenda. */
export async function sendMediaMessage(conversationId: string, file: File, caption?: string) {
  const fd = new FormData();
  fd.append('file', file, file.name);
  if (caption?.trim()) fd.append('caption', caption.trim());
  return apiUpload<WaMessage>(`/v1/whatsapp/conversations/${conversationId}/messages/media`, fd);
}

/** Transcreve uma mensagem de áudio (sob demanda). */
export async function transcribeMessage(conversationId: string, messageId: string) {
  return api.post<{ transcription: string }>(
    `/v1/whatsapp/conversations/${conversationId}/messages/${messageId}/transcribe`,
    {},
  );
}

export async function sendTemplateMessage(
  conversationId: string,
  input: { templateName: string; language: string; variables?: string[]; previewBody?: string },
) {
  return api.post<WaMessage>(
    `/v1/whatsapp/conversations/${conversationId}/messages/template`,
    input,
  );
}

// ---- iniciar conversa (outbound por telefone, sem inbound prévio) ----

export interface OutboundTemplateInput {
  phoneE164: string;
  templateName: string;
  language: string;
  variables?: string[];
  name?: string;
  previewBody?: string;
}

/** Inicia uma conversa nova disparando um template aprovado para um telefone. */
export async function sendOutboundTemplate(input: OutboundTemplateInput) {
  return api.post<WaMessage & { conversationId: string }>(
    `/v1/whatsapp/outbound/template`,
    input,
  );
}

// ---- templates HSM (Meta) ----

export async function listTemplates() {
  return api.get<WaTemplate[]>(`/v1/whatsapp/templates`);
}

export async function syncTemplates(instanceId: string) {
  return api.post<{ synced: number }>(`/v1/whatsapp/instances/${instanceId}/templates/sync`, {});
}

// ---- régua de cobrança (config + regras) ----

export type BillingChannel = 'WHATSAPP_META' | 'WHATSAPP_WAHA' | 'SMS' | 'EMAIL';

export interface WaBillingRule {
  id: string;
  enabled: boolean;
  label: string | null;
  /** <0 = dias ANTES do vencimento | 0 = no dia | >0 = dias DEPOIS. */
  offsetDays: number;
  channel: string;
  templateName: string;
  language: string;
  instanceId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface WaBillingConfig {
  config: { enabled: boolean; testRecipient: string | null };
  rules: WaBillingRule[];
  channels: BillingChannel[];
  supportedChannels: BillingChannel[];
}

export interface WaBillingRuleInput {
  enabled?: boolean;
  label?: string | null;
  offsetDays: number;
  channel: string;
  templateName: string;
  language?: string;
  instanceId?: string | null;
  sortOrder?: number;
}

export async function getBillingConfig() {
  return api.get<WaBillingConfig>(`/v1/whatsapp/billing/config`);
}

export async function setBillingConfig(input: { enabled?: boolean; testRecipient?: string | null }) {
  return api.put<WaBillingConfig>(`/v1/whatsapp/billing/config`, input);
}

export async function createBillingRule(input: WaBillingRuleInput) {
  return api.post<WaBillingConfig>(`/v1/whatsapp/billing/rules`, input);
}

export async function updateBillingRule(id: string, input: Partial<WaBillingRuleInput>) {
  return api.put<WaBillingConfig>(`/v1/whatsapp/billing/rules/${id}`, input);
}

export async function deleteBillingRule(id: string) {
  return api.delete<WaBillingConfig>(`/v1/whatsapp/billing/rules/${id}`);
}

export interface BillingRunResult {
  tenants: number;
  rules: number;
  due: number;
  sent: number;
  skipped: number;
  failed: number;
  testRedirect: string | null;
  dryRun: boolean;
}

export async function runBilling(dryRun: boolean) {
  return api.post<BillingRunResult>(`/v1/whatsapp/billing/run`, { dryRun });
}

export interface WaBillingLog {
  id: string;
  customerName: string | null;
  sentTo: string | null;
  invoiceRef: string | null;
  channel: string;
  status: 'SENT' | 'FAILED';
  error: string | null;
  sentAt: string;
  ruleLabel: string | null;
  templateName: string | null;
  offsetDays: number | null;
}

/** Histórico de disparos (mais recentes primeiro). */
export async function listBillingLogs() {
  return api.get<WaBillingLog[]>(`/v1/whatsapp/billing/logs`);
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

export interface CreateInstanceInput {
  name: string;
  channel: WaChannel;
  instanceName: string;
  // WAHA
  evolutionUrl?: string;
  apiKey?: string;
  // Meta Cloud
  wabaId?: string;
  phoneNumberId?: string;
  accessToken?: string;
  appSecret?: string;
  verifyToken?: string;
}

export async function createInstance(input: CreateInstanceInput) {
  return api.post<WaInstance>(`/v1/whatsapp/instances`, input);
}

export interface UpdateInstanceInput {
  name?: string;
  // Meta Cloud
  wabaId?: string | null;
  phoneNumberId?: string;
  accessToken?: string;
  appSecret?: string;
  verifyToken?: string;
  // WAHA
  evolutionUrl?: string;
  apiKey?: string;
}

/** Edita a instância (corrige IDs/segredos sem apagar). Revalida no Meta. */
export async function updateInstance(id: string, input: UpdateInstanceInput) {
  return api.patch<WaInstance>(`/v1/whatsapp/instances/${id}`, input);
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

// ---- grupos (WAHA / QR) ----

export interface WaGroup {
  id: string;
  subject: string | null;
  participantsCount: number | null;
  /** true se o grupo já virou conversa (tem mensagens capturadas). */
  captured: boolean;
}

export interface WaGroupsResponse {
  captureGroups: boolean;
  groups: WaGroup[];
}

/** Liga/desliga a captura de mensagens de grupos na instância. */
export async function setCaptureGroups(id: string, captureGroups: boolean) {
  return api.patch<WaInstance>(`/v1/whatsapp/instances/${id}`, { captureGroups });
}

/** Lista os grupos da conta conectada (apenas WAHA). */
export async function listInstanceGroups(id: string) {
  return api.get<WaGroupsResponse>(`/v1/whatsapp/instances/${id}/groups`);
}

// ---- helpers ----

/**
 * Resolve URL de mídia. Mensagens vêm com mediaUrl relativo `/v1/whatsapp/media/<file>`,
 * que precisa do prefixo do gateway pra carregar no <img/>.
 */
export function resolveMediaUrl(mediaUrl: string | null): string | null {
  if (!mediaUrl) return null;
  const base = (process.env.NEXT_PUBLIC_API_URL ?? '/api').replace(/\/$/, '');
  // O endpoint /media exige chat.read; o <img>/<video> não manda header de
  // auth, então passamos o token na query (mesma auth do SSE). Sem isso a
  // mídia (figurinha/imagem/vídeo) volta 401 e não renderiza.
  const token = typeof window !== 'undefined' ? localStorage.getItem('netx.accessToken') : null;
  const sep = mediaUrl.includes('?') ? '&' : '?';
  // mediaUrl já vem como /v1/...
  return `${base}${mediaUrl}${token ? `${sep}access_token=${encodeURIComponent(token)}` : ''}`;
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

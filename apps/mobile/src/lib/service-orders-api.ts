/**
 * Client de Ordens de Serviço (NetX Field). Field é consumidor: toda escrita
 * vai pela API do módulo dono (service-orders/provisioning). Os paths NÃO levam
 * `/v1` — `config.apiBaseUrl` já termina em `/api/v1` (ver lib/config.ts).
 */
import { api } from './api';
import type { Paginated } from '@netx/shared';

export type ServiceOrderStatus =
  | 'OPEN'
  | 'SCHEDULED'
  | 'EN_ROUTE'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

export interface ServiceOrderListItem {
  id: string;
  code: string;
  status: ServiceOrderStatus;
  displayStatus: string;
  scheduledAt: string | null;
  openedAt: string;
  reason: { id: string; name: string };
  contract: { id: string; customer: { id: string; displayName: string } } | null;
  city: string | null;
}

export interface PhotoPresignResponse {
  uploadUrl: string;
  storageKey: string;
  expiresIn: number;
}

/** O.S atribuídas ao técnico logado (online — o cache offline é WatermelonDB). */
export function listMyServiceOrders(userId: string, signal?: AbortSignal) {
  return api<Paginated<ServiceOrderListItem>>(
    `/service-orders?assignedToId=${userId}&pageSize=50`,
    { signal },
  );
}

/** Pede uma presigned URL pra subir uma foto da O.S direto no MinIO. Online. */
export function presignPhoto(serviceOrderId: string, fileName: string, contentType?: string) {
  return api<PhotoPresignResponse>(`/service-orders/${serviceOrderId}/photos/presign`, {
    method: 'POST',
    body: { fileName, ...(contentType ? { contentType } : {}) },
  });
}

/**
 * Sobe os bytes DIRETO no MinIO via presigned PUT. NÃO usa o wrapper `api()`
 * (sem Bearer, sem JSON) — a auth vem na query-string assinada. `fileUri` é o
 * URI local (file://...) do expo-image-picker/camera. Espelha o fluxo web.
 */
export async function uploadPresigned(
  uploadUrl: string,
  fileUri: string,
  contentType: string,
): Promise<void> {
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    // RN aceita { uri } como body pra streaming de arquivo local.
    body: { uri: fileUri, type: contentType, name: 'photo.jpg' } as unknown as BodyInit,
  });
  if (!put.ok) throw new Error(`Upload falhou: ${put.status}`);
}

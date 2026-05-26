/**
 * Cliente tipado pras pastas administrativas (R4.5e OSP).
 * Backend: apps/core-service/src/modules/optical/network-folders.service.ts
 */
import { api } from './api';

export interface NetworkFolder {
  id: string;
  tenantId: string;
  parentId: string | null;
  name: string;
  color: string | null;
  position: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  itemCounts: {
    enclosures: number;
    cables: number;
  };
}

export interface CreateNetworkFolderInput {
  parentId?: string | null;
  name: string;
  color?: string | null;
  position?: number;
  notes?: string | null;
}
export type UpdateNetworkFolderInput = Partial<CreateNetworkFolderInput>;

export interface AssignItemsToFolderInput {
  enclosureIds?: string[];
  cableIds?: string[];
}

export const networkFoldersApi = {
  listPath: () => '/v1/optical/folders',
  list: () => api.get<NetworkFolder[]>('/v1/optical/folders'),
  get: (id: string) => api.get<NetworkFolder>(`/v1/optical/folders/${id}`),
  create: (input: CreateNetworkFolderInput) =>
    api.post<NetworkFolder>('/v1/optical/folders', input),
  update: (id: string, input: UpdateNetworkFolderInput) =>
    api.patch<NetworkFolder>(`/v1/optical/folders/${id}`, input),
  remove: (id: string) => api.delete(`/v1/optical/folders/${id}`),
  /** folderId = null → desatribui (passa 'unassigned' no path). */
  assignItems: (folderId: string | null, input: AssignItemsToFolderInput) =>
    api.post<{ enclosuresUpdated: number; cablesUpdated: number }>(
      `/v1/optical/folders/${folderId ?? 'unassigned'}/items`,
      input,
    ),
};

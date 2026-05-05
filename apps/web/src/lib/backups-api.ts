import { api } from './api';

export type BackupStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface Backup {
  id: string;
  tenantId: string;
  filename: string;
  status: BackupStatus;
  sizeBytes: number | null;
  durationMs: number | null;
  errorMessage: string | null;
  createdById: string | null;
  createdAt: string;
  completedAt: string | null;
}

export const backupsApi = {
  listPath: () => '/v1/backups',
  list() {
    return api.get<Backup[]>(this.listPath());
  },
  create() {
    return api.post<Backup>('/v1/backups');
  },
  remove(id: string) {
    return api.delete(`/v1/backups/${id}`);
  },
  /**
   * URL pública (autenticada via header). Frontend NÃO usa <a href> direto
   * porque o token está em localStorage; usa fetch + blob + a.download.
   */
  downloadPath: (id: string) => `/v1/backups/${id}/download`,
};

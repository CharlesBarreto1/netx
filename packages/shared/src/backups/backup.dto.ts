import { z } from 'zod';

export const BackupStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
]);
export type BackupStatus = z.infer<typeof BackupStatusSchema>;

export interface BackupResponse {
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

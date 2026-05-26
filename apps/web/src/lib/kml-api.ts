/**
 * Cliente tipado pro import/export KML (R4.5d OSP).
 * Backend: apps/core-service/src/modules/optical/kml.service.ts
 */
import { api, apiUpload } from './api';
import type { FiberCableType } from '@/lib/fiber-api';
import type { OpticalEnclosureType } from '@/lib/optical-api';

export interface KmlImportPreview {
  enclosures: Array<{
    name: string;
    latitude: number;
    longitude: number;
    description?: string;
  }>;
  cables: Array<{
    name: string;
    fiberCount: number;
    path: Array<{ latitude: number; longitude: number }>;
    lengthMeters: number;
    description?: string;
  }>;
  warnings: string[];
}

export interface KmlImportResult {
  enclosuresCreated: number;
  cablesCreated: number;
  errors: string[];
}

export interface ConfirmKmlImportInput {
  preview: KmlImportPreview;
  defaults: {
    enclosureType: OpticalEnclosureType;
    enclosureCapacity: number;
    cableType: FiberCableType;
    cableFiberCount: number;
  };
}

export const kmlApi = {
  /**
   * Faz upload do arquivo (multipart) e recebe preview. Não cria nada
   * no servidor ainda — operador chama confirm() depois.
   */
  async preview(file: File): Promise<KmlImportPreview> {
    const fd = new FormData();
    fd.append('file', file);
    return apiUpload<KmlImportPreview>('/v1/optical/import/kml/preview', fd);
  },

  confirm: (input: ConfirmKmlImportInput) =>
    api.post<KmlImportResult>('/v1/optical/import/kml/confirm', input),

  /** Trigga download direto. */
  exportUrl: () => '/api/v1/optical/export/kml',
};

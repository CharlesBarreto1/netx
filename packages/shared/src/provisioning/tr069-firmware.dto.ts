/**
 * DTOs do catálogo de firmware TR-069 — upload por fabricante/modelo e
 * rollout via RPC Download (parque inteiro do modelo ou seriais escolhidos).
 *
 * Nasceu da dor real do upgrade manual da ZTE F670L do piloto PY (jul/2026):
 * scp + nginx na mão + INSERT na fila. Ver tr069-firmware.service.ts.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { z } from 'zod';

/** Vendors do registry de paths (tr069-paths.registry.ts do core-service). */
export const TR069_FIRMWARE_VENDORS = ['HUAWEI', 'ZTE', 'VSOL', 'ZYXEL'] as const;
export type Tr069FirmwareVendor = (typeof TR069_FIRMWARE_VENDORS)[number];

/**
 * Campos do multipart de upload (o arquivo vai no campo `file`). Chegam como
 * string no form-data — o controller valida com este schema.
 */
export const UploadTr069FirmwareFieldsSchema = z
  .object({
    vendor: z.enum(TR069_FIRMWARE_VENDORS),
    /** ProductClass EXATO do Inform (F670L, EG8145V5…) — é a chave do alvo. */
    productClass: z.string().min(2).max(64),
    version: z.string().min(2).max(64),
    notes: z.string().max(500).optional(),
  })
  .strict();
export type UploadTr069FirmwareFields = z.infer<typeof UploadTr069FirmwareFieldsSchema>;

export interface Tr069FirmwareDto {
  id: string;
  vendor: Tr069FirmwareVendor;
  productClass: string;
  version: string;
  fileName: string;
  fileSize: number;
  /** SHA-256 (hex) calculado no upload. */
  checksum: string;
  notes: string | null;
  createdAt: string;
  /** Parque do modelo no tenant (pra dimensionar o disparo na UI). */
  deviceTotal: number;
  deviceOnline: number;
  /** Quantos já reportam softwareVersion == version. */
  deviceOnVersion: number;
}

export const DeployTr069FirmwareRequestSchema = z
  .object({
    /** MODEL = parque inteiro do productClass; DEVICES = seleção explícita. */
    target: z.enum(['MODEL', 'DEVICES']),
    /** Obrigatório quando target=DEVICES (ids de tr069_devices). */
    deviceIds: z.array(z.string().uuid()).min(1).max(500).optional(),
    /** Só devices ONLINE (default) — OFFLINE pegam a task quando voltarem. */
    onlyOnline: z.boolean().default(true),
    /** Pula quem já reporta a versão alvo (default). */
    skipSameVersion: z.boolean().default(true),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.target === 'DEVICES' && (!v.deviceIds || v.deviceIds.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['deviceIds'],
        message: 'target=DEVICES exige deviceIds',
      });
    }
  });
export type DeployTr069FirmwareRequest = z.infer<typeof DeployTr069FirmwareRequestSchema>;

export interface Tr069FirmwareDeployResult {
  enqueued: number;
  /** Pulados por já estarem na versão alvo. */
  skippedSameVersion: number;
  /** Pulados por já terem DOWNLOAD em curso. */
  skippedInflight: number;
  /** Pulados por estarem OFFLINE (quando onlyOnline). */
  skippedOffline: number;
  /** Candidatos totais depois do filtro de alvo. */
  total: number;
}

export interface Tr069FirmwareDeployDeviceRow {
  taskId: string;
  /** id interno (tr069_devices.id). */
  deviceDbId: string;
  /** OUI-SERIAL visível na UI. */
  deviceId: string;
  softwareVersion: string | null;
  status: string;
  error: string | null;
  updatedAt: string;
}

export interface Tr069FirmwareDeployStatus {
  firmwareId: string;
  version: string;
  counts: { pending: number; running: number; done: number; failed: number };
  /** Quantos do parque já reportam a versão alvo (converge pós-reboot). */
  deviceOnVersion: number;
  devices: Tr069FirmwareDeployDeviceRow[];
}

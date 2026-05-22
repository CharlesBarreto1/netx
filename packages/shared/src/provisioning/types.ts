/**
 * Tipos/enums compartilhados de provisionamento (OLT/ONT + TR-069).
 * Espelham os enums do schema Prisma — manter sincronizado.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { z } from 'zod';

export const OLT_VENDORS = [
  'HUAWEI',
  'ZTE',
  'DATACOM',
  'FIBERHOME',
  'NOKIA',
  'PARKS',
  'UFINET',
  'GENERIC',
] as const;
export const OltVendorSchema = z.enum(OLT_VENDORS);
export type OltVendor = z.infer<typeof OltVendorSchema>;

export const OLT_PROVIDER_MODES = ['DIRECT', 'ORCHESTRATOR', 'EXTERNAL'] as const;
export const OltProviderModeSchema = z.enum(OLT_PROVIDER_MODES);
export type OltProviderMode = z.infer<typeof OltProviderModeSchema>;

export const OLT_STATUSES = ['ONLINE', 'OFFLINE', 'UNREACHABLE', 'UNKNOWN'] as const;
export const OltStatusSchema = z.enum(OLT_STATUSES);
export type OltStatus = z.infer<typeof OltStatusSchema>;

export const ONT_STATUSES = [
  'PENDING_AUTH',
  'AUTHORIZED',
  'ONLINE',
  'OFFLINE',
  'LOS',
  'FAULT',
] as const;
export const OntStatusSchema = z.enum(ONT_STATUSES);
export type OntStatus = z.infer<typeof OntStatusSchema>;

/**
 * Modo de Wi-Fi por modelo de ONT:
 *   BAND_STEERING — SSID único nas 2 bandas (EG8145X6 / EG8145-X10)
 *   DUAL_BAND     — SSIDs separados (EG8145V5): 2.4G nome, 5G "5G-"+nome
 */
export const WIFI_BAND_MODES = ['BAND_STEERING', 'DUAL_BAND'] as const;
export const WifiBandModeSchema = z.enum(WIFI_BAND_MODES);
export type WifiBandMode = z.infer<typeof WifiBandModeSchema>;

export const TR069_TASK_ACTIONS = [
  'SET_PARAMS',
  'GET_PARAMS',
  'REBOOT',
  'FACTORY_RESET',
  'DOWNLOAD',
  'ADD_OBJECT',
  'DELETE_OBJECT',
] as const;
export const Tr069TaskActionSchema = z.enum(TR069_TASK_ACTIONS);
export type Tr069TaskAction = z.infer<typeof Tr069TaskActionSchema>;

export const TR069_TASK_STATUSES = [
  'PENDING',
  'RUNNING',
  'DONE',
  'FAILED',
  'CANCELLED',
] as const;
export const Tr069TaskStatusSchema = z.enum(TR069_TASK_STATUSES);
export type Tr069TaskStatus = z.infer<typeof Tr069TaskStatusSchema>;

export const PROVISIONING_EVENT_STATUSES = [
  'PENDING',
  'SUCCESS',
  'FAILED',
  'TIMEOUT',
] as const;
export const ProvisioningEventStatusSchema = z.enum(PROVISIONING_EVENT_STATUSES);
export type ProvisioningEventStatus = z.infer<typeof ProvisioningEventStatusSchema>;

export const PROVISIONING_EVENT_ACTIONS = [
  'OLT_AUTHORIZE',
  'OLT_DEAUTHORIZE',
  'OLT_STATUS_POLL',
  'OLT_TEST_CONNECTION',
  'TR069_TASK_ENQUEUE',
  'TR069_INFORM_RECEIVED',
  'RADIUS_ENQUEUE',
  'CONTRACT_ACTIVATE',
] as const;
export const ProvisioningEventActionSchema = z.enum(PROVISIONING_EVENT_ACTIONS);
export type ProvisioningEventAction = z.infer<typeof ProvisioningEventActionSchema>;

/** Validação de SN GPON (formato variável por fabricante — só sanity check). */
export const SnGponSchema = z
  .string()
  .min(8)
  .max(32)
  .regex(/^[A-Za-z0-9_-]+$/, 'SN GPON contém caracteres inválidos');

/** SSID Wi-Fi: 1-32 chars, ASCII printable (alguns CPEs rejeitam non-ASCII). */
export const SsidSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[\x20-\x7E]+$/, 'SSID deve ser ASCII imprimível');

/** Senha WPA2/WPA3: 8-63 chars (WPA spec). */
export const WifiPasswordSchema = z
  .string()
  .min(8, 'Senha Wi-Fi precisa ter no mínimo 8 caracteres')
  .max(63, 'Senha Wi-Fi precisa ter no máximo 63 caracteres');

/** MAC address — aceita AA:BB:CC:DD:EE:FF ou aabbccddeeff, normaliza. */
export const MacAddressSchema = z
  .string()
  .regex(/^([0-9A-Fa-f]{2}[:-]?){5}[0-9A-Fa-f]{2}$/, 'MAC inválido')
  .transform((s) => s.replace(/[:-]/g, '').toUpperCase().match(/.{1,2}/g)!.join(':'));

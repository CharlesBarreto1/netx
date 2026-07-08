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
  'ZYXEL',
  'UFINET',
  'GENERIC',
] as const;
export const OltVendorSchema = z.enum(OLT_VENDORS);
export type OltVendor = z.infer<typeof OltVendorSchema>;

// Template de provisionamento (Fase 2 — OLT Zyxel ZyNOS).
export const SERVICE_PROTOCOLS = ['PPPOE', 'IPOE', 'BRIDGE'] as const;
export const ServiceProtocolSchema = z.enum(SERVICE_PROTOCOLS);
export type ServiceProtocol = z.infer<typeof ServiceProtocolSchema>;

export const PROFILE_VLAN_ROLES = ['DATA', 'MGMT'] as const;
export const ProfileVlanRoleSchema = z.enum(PROFILE_VLAN_ROLES);
export type ProfileVlanRole = z.infer<typeof ProfileVlanRoleSchema>;

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
 *   DUAL_BAND     — SSIDs separados (EG8145V5): 2.4G nome, 5G nome+"-5G"
 */
export const WIFI_BAND_MODES = ['BAND_STEERING', 'DUAL_BAND'] as const;
export const WifiBandModeSchema = z.enum(WIFI_BAND_MODES);
export type WifiBandMode = z.infer<typeof WifiBandModeSchema>;

export const TR069_TASK_ACTIONS = [
  'SET_PARAMS',
  'GET_PARAMS',
  'SET_ATTRIBUTES',
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

/**
 * Política de senha Wi-Fi forte (WPA2/WPA3-PSK), conforme normas vigentes.
 *
 * Regras:
 *   - 8–63 caracteres (limite do passphrase WPA).
 *   - Só ASCII imprimível SEM espaço (0x21–0x7E). Acentos, espaços e caracteres
 *     de controle fazem várias ONTs (Huawei/VSOL/Realtek) recusarem a senha em
 *     SILÊNCIO: o SetParameterValues "passa" mas o Wi-Fi não muda. Restringir o
 *     charset aqui é o que resolve o "operador cadastra e a ONT não aceita".
 *   - 1+ minúscula, 1+ maiúscula, 1+ dígito e 1+ caractere especial (o firmware
 *     de muitas ONTs também rejeita passphrase fraca em silêncio).
 *
 * Espelhada no client em apps/web/src/lib/wifi-password.ts (checklist + gerador).
 */
export const WIFI_PASSWORD_RULES = {
  minLength: 8,
  maxLength: 63,
  /** ASCII imprimível, sem espaço (0x20) — evita acentos/controle. */
  charset: /^[\x21-\x7E]+$/u,
  hasLower: /[a-z]/u,
  hasUpper: /[A-Z]/u,
  hasDigit: /[0-9]/u,
  /** "Especial" = qualquer não-alfanumérico (dentro do charset acima). */
  hasSpecial: /[^A-Za-z0-9]/u,
} as const;

export const WifiPasswordSchema = z
  .string()
  .min(WIFI_PASSWORD_RULES.minLength, 'Senha Wi-Fi precisa ter no mínimo 8 caracteres')
  .max(WIFI_PASSWORD_RULES.maxLength, 'Senha Wi-Fi precisa ter no máximo 63 caracteres')
  .regex(
    WIFI_PASSWORD_RULES.charset,
    'Senha Wi-Fi só aceita letras, números e símbolos ASCII (sem espaços ou acentos)',
  )
  .refine((v) => WIFI_PASSWORD_RULES.hasUpper.test(v), {
    message: 'Senha Wi-Fi precisa de 1 letra maiúscula',
  })
  .refine((v) => WIFI_PASSWORD_RULES.hasLower.test(v), {
    message: 'Senha Wi-Fi precisa de 1 letra minúscula',
  })
  .refine((v) => WIFI_PASSWORD_RULES.hasDigit.test(v), {
    message: 'Senha Wi-Fi precisa de 1 número',
  })
  .refine((v) => WIFI_PASSWORD_RULES.hasSpecial.test(v), {
    message: 'Senha Wi-Fi precisa de 1 caractere especial',
  });

/** MAC address — aceita AA:BB:CC:DD:EE:FF ou aabbccddeeff, normaliza. */
export const MacAddressSchema = z
  .string()
  .regex(/^([0-9A-Fa-f]{2}[:-]?){5}[0-9A-Fa-f]{2}$/, 'MAC inválido')
  .transform((s) => s.replace(/[:-]/g, '').toUpperCase().match(/.{1,2}/g)!.join(':'));

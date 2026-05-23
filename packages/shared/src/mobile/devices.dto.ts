/**
 * DTOs pro pareamento de devices mobile (Expo/React Native).
 *
 * O app chama POST /v1/mobile/devices/pair logo após o login bem-sucedido.
 * Idempotente — se o device já existe (mesmo tenantId + userId + deviceId),
 * faz upsert: atualiza appVersion, pushToken, lastSeenAt.
 *
 * `deviceId` vem de expo-application (estável por install). Reinstalou app
 * = novo deviceId = nova linha.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { z } from 'zod';

export const MobilePlatformSchema = z.enum(['IOS', 'ANDROID']);
export type MobilePlatform = z.infer<typeof MobilePlatformSchema>;

export const PairDeviceRequestSchema = z.object({
  /** Vindo de expo-application (estável por install) */
  deviceId: z.string().min(1).max(128),
  platform: MobilePlatformSchema,
  /** Ex: "SM-G990B", "iPhone15,2". Opcional. */
  model: z.string().max(120).nullish(),
  /** Ex: "Android 14", "iOS 17.4". Opcional. */
  osVersion: z.string().max(32).nullish(),
  /** Versão do app NetX Mobile. Obrigatório pra suporte. */
  appVersion: z.string().min(1).max(32),
  /** Expo push token (ExponentPushToken[...]). Opcional. */
  pushToken: z.string().max(255).nullish(),
});
export type PairDeviceRequest = z.infer<typeof PairDeviceRequestSchema>;

export const PairDeviceResponseSchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string(),
  platform: MobilePlatformSchema,
  appVersion: z.string(),
  lastSeenAt: z.string(),  // ISO 8601
  createdAt: z.string(),   // ISO 8601
  revoked: z.boolean(),
});
export type PairDeviceResponse = z.infer<typeof PairDeviceResponseSchema>;

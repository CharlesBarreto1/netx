/**
 * Camada de auth (login, logout, pair device, /me).
 *
 * Erros tratados:
 *  - urn:netx:error:mfa-required → callback `requireMfa` no caller
 *  - urn:netx:error:mfa-invalid  → ApiError com message clara
 */
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

import type { PairDeviceRequest, PairDeviceResponse } from '@netx/shared';

import { api, ApiError } from './api';
import { authStorage, type SessionUser, type SessionTenant } from './auth-storage';
import { config } from './config';
import { database } from '../db/database';

interface LoginInput {
  email: string;
  password: string;
  mfaToken?: string;
  tenantSlug?: string;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: SessionUser;
  tenant: SessionTenant;
}

export class MfaRequiredError extends Error {
  constructor() {
    super('MFA token required');
    this.name = 'MfaRequiredError';
  }
}

export async function login(input: LoginInput): Promise<LoginResponse> {
  try {
    const data = await api<LoginResponse>('/auth/login', {
      method: 'POST',
      skipAuth: true,
      body: input,
    });
    await authStorage.saveTokens(data.accessToken, data.refreshToken);
    await authStorage.saveSession(data.user, data.tenant);
    return data;
  } catch (err) {
    if (
      err instanceof ApiError &&
      err.payload &&
      typeof err.payload === 'object' &&
      'type' in err.payload &&
      err.payload.type === 'urn:netx:error:mfa-required'
    ) {
      throw new MfaRequiredError();
    }
    throw err;
  }
}

export async function logout(): Promise<void> {
  // Best-effort: avisa o servidor pra revogar a session, mas mesmo que
  // falhe, limpa local. Quem está sem rede deve conseguir deslogar.
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch {
    // ignore
  }
  // Limpa o cache local (O.S, outbox) — device compartilhado não pode vazar
  // dados entre usuários. Best-effort: mesmo se falhar, os tokens já foram embora.
  try {
    await database.write(async () => {
      await database.unsafeResetDatabase();
    });
  } catch {
    // ignore
  }
  await authStorage.clear();
}

/**
 * Faz o pareamento do device com o backend após login. Idempotente.
 * Falha silenciosa não é OK aqui — se o pair falhar, o admin não vê o
 * device pra revogar. Caller deve mostrar toast em erro.
 */
export async function pairThisDevice(): Promise<PairDeviceResponse> {
  const deviceId = await resolveDeviceId();
  const body: PairDeviceRequest = {
    deviceId,
    platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
    model: Platform.OS === 'ios' ? Platform.constants.systemName : (Platform.constants as { Model?: string }).Model ?? null,
    osVersion: String(Platform.Version),
    appVersion: config.appVersion,
    pushToken: null, // Fase 4: registrar push token (Expo)
  };
  return api<PairDeviceResponse>('/mobile/devices/pair', {
    method: 'POST',
    body,
  });
}

async function resolveDeviceId(): Promise<string> {
  if (Platform.OS === 'ios') {
    const id = await Application.getIosIdForVendorAsync();
    if (id) return id;
  } else if (Platform.OS === 'android') {
    const id = Application.getAndroidId();
    if (id) return id;
  }
  // Fallback (web/expo go): usa installationId estável do Expo runtime
  return `expo-${Constants.sessionId ?? 'unknown'}`;
}

/**
 * Storage de tokens e sessão.
 *
 * Tokens (access + refresh) → SecureStore (keychain iOS / Keystore Android).
 *   Por que SecureStore e não AsyncStorage? Refresh token é credencial
 *   reutilizável por 7 dias — se o device for rooted ou outro app malicioso
 *   conseguir ler AsyncStorage, vaza acesso. SecureStore mitiga.
 *
 * Snapshot de user/tenant (dados não-sensíveis pra renderizar UI antes do
 * primeiro request) → AsyncStorage. Lê instantâneo no boot.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const K = {
  accessToken: 'netx.accessToken',
  refreshToken: 'netx.refreshToken',
  user: 'netx.user',
  tenant: 'netx.tenant',
} as const;

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
  mustChangePassword?: boolean;
}

export interface SessionTenant {
  id: string;
  slug: string;
  name: string;
  locale: string;
  timezone: string;
  currency: string;
}

export const authStorage = {
  async saveTokens(accessToken: string, refreshToken: string): Promise<void> {
    await SecureStore.setItemAsync(K.accessToken, accessToken);
    await SecureStore.setItemAsync(K.refreshToken, refreshToken);
  },
  async getAccessToken(): Promise<string | null> {
    return SecureStore.getItemAsync(K.accessToken);
  },
  async getRefreshToken(): Promise<string | null> {
    return SecureStore.getItemAsync(K.refreshToken);
  },

  async saveSession(user: SessionUser, tenant: SessionTenant): Promise<void> {
    await AsyncStorage.multiSet([
      [K.user, JSON.stringify(user)],
      [K.tenant, JSON.stringify(tenant)],
    ]);
  },
  async getSession(): Promise<{ user: SessionUser; tenant: SessionTenant } | null> {
    const [[, u], [, t]] = await AsyncStorage.multiGet([K.user, K.tenant]);
    if (!u || !t) return null;
    try {
      return {
        user: JSON.parse(u) as SessionUser,
        tenant: JSON.parse(t) as SessionTenant,
      };
    } catch {
      return null;
    }
  },

  async clear(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(K.accessToken),
      SecureStore.deleteItemAsync(K.refreshToken),
      AsyncStorage.multiRemove([K.user, K.tenant]),
    ]);
  },
};

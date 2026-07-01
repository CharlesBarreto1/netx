/**
 * Servidor (base URL) escolhido no login. O MESMO APK atende várias bases NetX
 * distintas — cada ISP tem seu host. O usuário digita o servidor junto com
 * email/senha; guardamos e todas as chamadas do api() passam a usar essa base.
 *
 * Precedência da base:
 *   1. host escolhido no login (persistido em AsyncStorage)
 *   2. EXPO_PUBLIC_API_URL / extra.apiBaseUrl / default (config.ts) — fallback
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { config } from './config';

const HOST_KEY = 'netx.serverHost'; // host cru digitado (ex.: "179.49.176.13")

let cachedHost: string | null = null;
let cachedBaseUrl: string | null = null;
let hydrated = false;

/**
 * Normaliza a entrada do usuário numa base `"<origin>/api/v1"`:
 *   - sem esquema: IP → http://, domínio → https:// (a maioria dos NetX em IP
 *     não tem TLS; domínios têm);
 *   - respeita esquema explícito e um sufixo /api ou /api/v1 já digitado;
 *   - vazio → cai no default do config.
 */
export function normalizeBaseUrl(input: string): string {
  let s = (input ?? '').trim().replace(/\s+/g, '');
  if (!s) return config.apiBaseUrl;
  s = s.replace(/\/+$/, ''); // tira barra final

  if (!/^https?:\/\//i.test(s)) {
    const hostOnly = s.split('/')[0];
    const isIp = /^[0-9.]+(:\d+)?$/.test(hostOnly);
    s = (isIp ? 'http://' : 'https://') + s;
  }

  if (/\/api\/v1$/i.test(s)) return s;
  if (/\/api$/i.test(s)) return `${s}/v1`;
  return `${s}/api/v1`;
}

async function ensureHydrated(): Promise<void> {
  if (hydrated) return;
  try {
    const raw = await AsyncStorage.getItem(HOST_KEY);
    if (raw) {
      cachedHost = raw;
      cachedBaseUrl = normalizeBaseUrl(raw);
    }
  } catch {
    // ignore — cai no default
  }
  hydrated = true;
}

/** Base URL atual usada pelo api() (default se o usuário nunca escolheu). */
export async function getApiBaseUrl(): Promise<string> {
  await ensureHydrated();
  return cachedBaseUrl ?? config.apiBaseUrl;
}

/** Host cru pra prefill no campo de login. Vazio na primeira vez. */
export async function getServerHost(): Promise<string> {
  await ensureHydrated();
  return cachedHost ?? '';
}

/** Define o servidor (chamado no login ANTES de autenticar). Vazio = default. */
export async function setServerHost(input: string): Promise<void> {
  const host = (input ?? '').trim();
  cachedHost = host || null;
  cachedBaseUrl = normalizeBaseUrl(host);
  hydrated = true;
  try {
    if (host) await AsyncStorage.setItem(HOST_KEY, host);
    else await AsyncStorage.removeItem(HOST_KEY);
  } catch {
    // ignore — a base em memória já vale pra esta sessão
  }
}

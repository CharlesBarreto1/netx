import Constants from 'expo-constants';

/**
 * Config do app. Em dev, sobrescreva via `extra.apiBaseUrl` em app.json
 * ou .env do Expo. Em prod, EAS Update entrega o build com o URL fixo.
 *
 * Default aponta pra produção PY (179.49.176.13). Pra dev local, rode o
 * backend em `npm run dev:api-gateway` e passe via env:
 *
 *   EXPO_PUBLIC_API_URL=http://192.168.0.10:3000/api/v1 npm run dev
 */
const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string };

export const config = {
  apiBaseUrl:
    process.env.EXPO_PUBLIC_API_URL ||
    extra.apiBaseUrl ||
    'http://179.49.176.13/api/v1',
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
} as const;

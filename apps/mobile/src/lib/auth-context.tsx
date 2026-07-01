/**
 * AuthContext — fonte da verdade do estado de auth no React.
 *
 * Boot:
 *   1. Lê AsyncStorage (snapshot do user/tenant) — instantâneo.
 *   2. Se houver, marca authenticated=true e renderiza app.
 *   3. Em paralelo, valida com GET /users/me (catch refresh em 401).
 *      Se 401 mesmo após refresh, AuthContext desloga.
 *
 * Login:
 *   - Chama login() → salva storage → atualiza state → tenta pair() em
 *     background (best-effort).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';

import { setUnauthorizedHandler } from './api';
import {
  authStorage,
  type SessionTenant,
  type SessionUser,
} from './auth-storage';
import { login as apiLogin, logout as apiLogout, pairThisDevice } from './auth';
import { startOutboxSync } from '../sync/outbox';

interface AuthState {
  status: 'loading' | 'authenticated' | 'unauthenticated';
  user: SessionUser | null;
  tenant: SessionTenant | null;
}

interface AuthContextValue extends AuthState {
  login: (input: {
    email: string;
    password: string;
    mfaToken?: string;
    tenantSlug?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    user: null,
    tenant: null,
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleLogout = useCallback(async () => {
    await apiLogout();
    if (mountedRef.current) {
      setState({ status: 'unauthenticated', user: null, tenant: null });
    }
  }, []);

  // Registra handler global pro fetch wrapper disparar quando refresh falhar
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void handleLogout();
    });
  }, [handleLogout]);

  // Sync da outbox — liga quando autenticado (drena ao reconectar), desliga no
  // logout. Primeiro uso de netinfo no app (ver sync/outbox.ts).
  useEffect(() => {
    if (state.status !== 'authenticated') return;
    const stop = startOutboxSync();
    return () => stop();
  }, [state.status]);

  // Boot — carrega snapshot
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const snap = await authStorage.getSession();
      const accessToken = await authStorage.getAccessToken();
      if (cancelled) return;
      if (snap && accessToken) {
        setState({
          status: 'authenticated',
          user: snap.user,
          tenant: snap.tenant,
        });
      } else {
        setState({ status: 'unauthenticated', user: null, tenant: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogin = useCallback<AuthContextValue['login']>(async (input) => {
    const data = await apiLogin(input);
    setState({
      status: 'authenticated',
      user: data.user,
      tenant: data.tenant,
    });
    // Best-effort pair em background; falhas só vão pro console (não bloqueia
    // UX). Quando o endpoint /v1/mobile/devices/pair ainda não tiver sido
    // deployado, o 404 cai aqui e o login continua normal — sem Alert pro user.
    pairThisDevice().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[NetX Mobile] device pair falhou:', err);
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login: handleLogin,
      logout: handleLogout,
    }),
    [state, handleLogin, handleLogout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

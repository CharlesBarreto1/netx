/**
 * Redireciona pra /login quando não autenticado, ou pra /(tabs) quando
 * autenticado mas está na rota de login. Mostra loader durante boot.
 *
 * Padrão expo-router: usar useEffect + router.replace porque <Redirect>
 * fica em loop se renderizado antes do segment resolver.
 */
import { useEffect } from 'react';
import { useRouter, useSegments } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import type { PropsWithChildren } from 'react';

import { useAuth } from '@/lib/auth-context';

export function AuthGate({ children }: PropsWithChildren) {
  const { status } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;

    const inAuthGroup = segments[0] === '(tabs)';
    const onLogin = segments[0] === 'login';

    if (status === 'unauthenticated' && !onLogin) {
      router.replace('/login');
    } else if (status === 'authenticated' && (!inAuthGroup || onLogin)) {
      router.replace('/(tabs)');
    }
  }, [status, segments, router]);

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a' }}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  return <>{children}</>;
}

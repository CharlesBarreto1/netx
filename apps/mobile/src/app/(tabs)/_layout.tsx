import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { useAuth } from '@/lib/auth-context';
import { fieldRole } from '@/lib/rbac';

/**
 * Navegação por PAPEL (revelada por role + entitlement). expo-router esconde uma
 * tab com `href: null` (mantém o arquivo pro typedRoutes; só oculta a visita).
 *   - Técnico: Minhas O.S (execução em campo)
 *   - Atendente/Admin: Assinante (busca → 360)
 *   - Todos: Alarmes
 */
export default function TabsLayout() {
  const { user } = useAuth();
  const role = fieldRole(user);
  const showTecnico = role === 'tecnico' || role === 'admin';
  const showAtendente = role === 'atendente' || role === 'admin';

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: '#0f172a' },
        headerTitleStyle: { color: '#f8fafc' },
        tabBarActiveTintColor: '#3b82f6',
        tabBarInactiveTintColor: '#94a3b8',
        tabBarStyle: { backgroundColor: '#0f172a', borderTopColor: '#1e293b' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Minhas O.S.',
          href: showTecnico ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="clipboard-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="subscriber"
        options={{
          title: 'Assinante',
          href: showAtendente ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="alarms"
        options={{
          title: 'Alarmes',
          tabBarIcon: ({ color, size }) => <Ionicons name="warning-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}

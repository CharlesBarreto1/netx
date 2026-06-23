import { Tabs } from 'expo-router';

export default function TabsLayout() {
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
          // Fase 1: tabBarIcon (instalar @expo/vector-icons primeiro)
        }}
      />
      <Tabs.Screen name="alarms" options={{ title: 'Alarmes' }} />
    </Tabs>
  );
}

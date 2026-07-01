/**
 * Aba "Alarmes" — incidents da Central de Alarmes em tempo real (poll 5s).
 * Toque num incident de CTO abre a tela "caixa ao vivo" (quem caiu agora).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import type { Paginated } from '@netx/shared';

import { api, ApiError } from '@/lib/api';

interface Incident {
  id: string;
  scope: string;
  scopeRefId: string | null;
  scopeLabel: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  status: string;
  rootCause: string;
  affectedCount: number;
  totalInScope: number;
  aiSummary: string | null;
  firstEventAt: string;
}

const SEV_COLOR: Record<string, string> = {
  CRITICAL: '#ef4444',
  WARNING: '#f59e0b',
  INFO: '#64748b',
};
const CAUSE: Record<string, string> = {
  POWER_OUTAGE: 'Queda de energia',
  FIBER_CUT: 'Rompimento de fibra',
  OPTICAL_DEGRADED: 'Sinal degradado',
  ISOLATED: 'Cliente isolado',
  UNKNOWN: 'Indefinido',
};

export default function AlarmsScreen() {
  const [items, setItems] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<Paginated<Incident>>('/alarms/incidents?status=OPEN&pageSize=100');
      setItems(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5_000);
    return () => clearInterval(t);
  }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color="#3b82f6" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} tintColor="#3b82f6" />}
        contentContainerStyle={items.length === 0 ? styles.center : styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>{error ?? 'Nenhum alarme aberto. Rede estável. ✓'}</Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={[styles.card, { borderLeftColor: SEV_COLOR[item.severity] }]}
            onPress={() => {
              if (item.scope === 'CTO' && item.scopeRefId) router.push(`/cto/${item.scopeRefId}`);
            }}
          >
            <View style={styles.row}>
              <Text style={[styles.sev, { color: SEV_COLOR[item.severity] }]}>{item.severity}</Text>
              <Text style={styles.scope}>{item.scopeLabel}</Text>
            </View>
            <Text style={styles.cause}>
              {CAUSE[item.rootCause] ?? item.rootCause} · {item.affectedCount}
              {item.totalInScope > 0 ? `/${item.totalInScope}` : ''} afetados
            </Text>
            {item.aiSummary ? <Text style={styles.ai}>🤖 {item.aiSummary}</Text> : null}
            {item.scope === 'CTO' && item.scopeRefId ? (
              <Text style={styles.tap}>Toque para ver a caixa ao vivo →</Text>
            ) : null}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020617' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#020617' },
  list: { padding: 12, gap: 10 },
  empty: { color: '#94a3b8', textAlign: 'center', padding: 24 },
  card: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderLeftWidth: 4,
    padding: 14,
    marginBottom: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  sev: { fontWeight: '700', fontSize: 12 },
  scope: { color: '#f8fafc', fontWeight: '600', fontSize: 15 },
  cause: { color: '#cbd5e1', fontSize: 13 },
  ai: { color: '#94a3b8', fontSize: 12, marginTop: 4 },
  tap: { color: '#3b82f6', fontSize: 12, marginTop: 6 },
});

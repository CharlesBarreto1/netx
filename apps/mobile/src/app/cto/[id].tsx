/**
 * "Caixa ao vivo" — dado uma CTO, lista as ONTs com status em tempo real
 * (poll 5s). O técnico em campo puxa o cabo e vê na hora QUEM caiu — o jeito
 * mais rápido de identificar o cliente na caixa.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';

import { api, ApiError } from '@/lib/api';

interface OntSignal {
  ontId: string;
  snGpon: string;
  contractCode: string | null;
  status: string;
  rxPower: number | null;
  flag: 'OK' | 'LOW' | 'HIGH';
}
interface CtoRssi {
  ctoId: string;
  ontCount: number;
  rxAvg: number | null;
  lowCount: number;
  onts: OntSignal[];
}

const DOWN = ['OFFLINE', 'LOS', 'FAULT'];

export default function CtoLiveScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<CtoRssi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await api<CtoRssi>(`/alarms/rssi/cto/${id}`);
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, [id]);

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

  const onts = data?.onts ?? [];
  const downCount = onts.filter((o) => DOWN.includes(o.status)).length;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Caixa ao vivo' }} />
      <View style={styles.header}>
        <Text style={styles.summary}>
          {onts.length} ONTs · {downCount} caída(s) ·{' '}
          {data?.rxAvg != null ? `RX médio ${data.rxAvg} dBm` : 'sem RX'}
        </Text>
      </View>
      <FlatList
        data={onts}
        keyExtractor={(o) => o.ontId}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} tintColor="#3b82f6" />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>{error ?? 'Sem ONTs mapeadas nesta CTO.'}</Text>}
        renderItem={({ item }) => {
          const down = DOWN.includes(item.status);
          return (
            <View style={[styles.row, { borderLeftColor: down ? '#ef4444' : '#22c55e' }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.code}>{item.contractCode ?? item.snGpon}</Text>
                <Text style={styles.sn}>{item.snGpon}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.status, { color: down ? '#ef4444' : '#22c55e' }]}>
                  {item.status}
                </Text>
                {item.rxPower != null ? (
                  <Text style={[styles.rx, item.flag !== 'OK' && styles.rxBad]}>
                    {item.rxPower} dBm
                  </Text>
                ) : null}
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020617' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#020617' },
  header: { padding: 14, borderBottomColor: '#1e293b', borderBottomWidth: 1 },
  summary: { color: '#f8fafc', fontWeight: '600' },
  list: { padding: 12 },
  empty: { color: '#94a3b8', textAlign: 'center', padding: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 8,
    borderLeftWidth: 4,
    padding: 12,
    marginBottom: 8,
  },
  code: { color: '#f8fafc', fontWeight: '600', fontSize: 14 },
  sn: { color: '#64748b', fontSize: 11, fontFamily: 'monospace' },
  status: { fontWeight: '700', fontSize: 13 },
  rx: { color: '#94a3b8', fontSize: 11 },
  rxBad: { color: '#f59e0b' },
});

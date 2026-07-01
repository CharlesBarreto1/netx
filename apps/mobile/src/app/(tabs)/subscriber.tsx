/**
 * Busca de assinante (atendente) → abre o Assinante 360 (/customer/:id).
 */
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import type { Paginated } from '@netx/shared';

import { api } from '@/lib/api';

interface CustomerHit {
  id: string;
  displayName: string;
  code: string | null;
  primaryPhone: string | null;
}

export default function SubscriberSearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    setLoading(true);
    try {
      const res = await api<Paginated<CustomerHit>>(
        `/customers?search=${encodeURIComponent(q)}&pageSize=15`,
      );
      setHits(res.data ?? []);
    } catch {
      setHits([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.header}>
        <TextInput
          value={query}
          onChangeText={(t) => void search(t)}
          placeholder="Nome, código ou telefone…"
          placeholderTextColor="#64748b"
          style={styles.input}
          autoCapitalize="none"
        />
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#3b82f6" />
        </View>
      ) : (
        <FlatList
          data={hits}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => router.push(`/customer/${item.id}`)}>
              <Text style={styles.name}>{item.displayName}</Text>
              <Text style={styles.sub}>{item.code ?? item.primaryPhone ?? ''}</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            query.length >= 2 ? (
              <Text style={styles.empty}>Nenhum cliente encontrado.</Text>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f172a' },
  header: { padding: 16, backgroundColor: '#1e293b', borderBottomWidth: 1, borderBottomColor: '#334155' },
  input: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f8fafc',
    fontSize: 15,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 10 },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  name: { color: '#f8fafc', fontSize: 15, fontWeight: '600' },
  sub: { color: '#94a3b8', fontSize: 13, marginTop: 2 },
  empty: { color: '#94a3b8', fontSize: 14, textAlign: 'center', marginTop: 24 },
});

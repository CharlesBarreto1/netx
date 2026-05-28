/**
 * Sanity check da Fase 0: lista as O.S. atribuídas ao técnico logado,
 * SEM cache local. Prova que auth + API + UI fecham end-to-end.
 *
 * Fase 1 substitui esta tela por uma versão WatermelonDB-backed que
 * lê do cache local e roda sync em background.
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

import type { Paginated } from '@netx/shared';

import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

type ServiceOrderStatus =
  | 'OPEN'
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

interface ServiceOrderItem {
  id: string;
  code: string;
  status: ServiceOrderStatus;
  scheduledAt: string | null;
  openedAt: string;
  reason: { id: string; name: string };
  contract: {
    id: string;
    customer: { id: string; displayName: string };
  } | null;
  city: string | null;
}

const STATUS_LABEL: Record<ServiceOrderStatus, string> = {
  OPEN: 'Aberta',
  SCHEDULED: 'Agendada',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
};

const STATUS_COLOR: Record<ServiceOrderStatus, string> = {
  OPEN: '#3b82f6',
  SCHEDULED: '#f59e0b',
  IN_PROGRESS: '#8b5cf6',
  COMPLETED: '#10b981',
  CANCELLED: '#64748b',
};

export default function MyServiceOrdersScreen() {
  const { user, logout } = useAuth();
  const [items, setItems] = useState<ServiceOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const resp = await api<Paginated<ServiceOrderItem>>(
        `/service-orders?assignedToId=${user.id}&pageSize=50`,
      );
      setItems(resp.data ?? []);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setError(apiErr ? apiErr.message : 'Erro ao carregar O.S.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  function onRefresh() {
    setRefreshing(true);
    void fetchOrders();
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>
            Olá, {user?.firstName ?? 'técnico'}
          </Text>
          <Text style={styles.subtitle}>
            {items.length} {items.length === 1 ? 'O.S. atribuída' : 'O.S. atribuídas'}
          </Text>
        </View>
        <Pressable
          style={styles.logoutBtn}
          onPress={() => {
            void logout();
          }}
        >
          <Text style={styles.logoutText}>Sair</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#3b82f6" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.retry} onPress={onRefresh}>
            <Text style={styles.retryText}>Tentar de novo</Text>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>Nenhuma O.S. atribuída a você.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#3b82f6"
            />
          }
          renderItem={({ item }) => <OrderCard order={item} />}
        />
      )}
    </SafeAreaView>
  );
}

function OrderCard({ order }: { order: ServiceOrderItem }) {
  const customer = order.contract?.customer.displayName ?? '—';
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.code}>{order.code}</Text>
        <View
          style={[
            styles.badge,
            { backgroundColor: STATUS_COLOR[order.status] + '33', borderColor: STATUS_COLOR[order.status] },
          ]}
        >
          <Text style={[styles.badgeText, { color: STATUS_COLOR[order.status] }]}>
            {STATUS_LABEL[order.status]}
          </Text>
        </View>
      </View>
      <Text style={styles.customer}>{customer}</Text>
      <Text style={styles.reason}>{order.reason.name}</Text>
      {order.scheduledAt ? (
        <Text style={styles.scheduled}>
          Agendada: {new Date(order.scheduledAt).toLocaleString('pt-BR')}
        </Text>
      ) : null}
      {order.city ? <Text style={styles.city}>{order.city}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f172a' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  greeting: { color: '#f8fafc', fontSize: 18, fontWeight: '600' },
  subtitle: { color: '#94a3b8', fontSize: 13, marginTop: 2 },
  logoutBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#334155',
  },
  logoutText: { color: '#f8fafc', fontSize: 13, fontWeight: '500' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { color: '#f87171', fontSize: 14, marginBottom: 12, textAlign: 'center' },
  retry: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 6,
  },
  retryText: { color: '#fff', fontWeight: '600' },
  empty: { color: '#94a3b8', fontSize: 14 },
  list: { padding: 16, gap: 12 },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  code: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
  },
  badgeText: { fontSize: 11, fontWeight: '600' },
  customer: { color: '#cbd5e1', fontSize: 14, marginBottom: 2 },
  reason: { color: '#94a3b8', fontSize: 12, marginBottom: 4 },
  scheduled: { color: '#f59e0b', fontSize: 12, fontWeight: '500' },
  city: { color: '#64748b', fontSize: 12, marginTop: 2 },
});

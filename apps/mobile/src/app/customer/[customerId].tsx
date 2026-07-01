/**
 * Assinante 360 (mobile) — agregado read-only (ERP+CPE+óptica+RADIUS) do BFF.
 * Tela transversal: técnico e atendente abrem daqui o contexto do cliente.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';

import type { Subscriber360Response } from '@netx/shared';

import { ApiError } from '@/lib/api';
import { getSubscriber360 } from '@/lib/field-api';

export default function Subscriber360Screen() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const [data, setData] = useState<Subscriber360Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    try {
      setData(await getSubscriber360(customerId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao carregar o 360.');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Assinante 360' }} />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#3b82f6" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : data ? (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.card}>
            <Text style={styles.name}>{data.customer.displayName}</Text>
            <Text style={styles.sub}>
              {data.customer.code ?? '—'} · {data.customer.status}
            </Text>
            {data.balanceDue > 0 ? (
              <Text style={styles.balanceDue}>Em aberto: {data.balanceDue}</Text>
            ) : (
              <Text style={styles.balanceOk}>Sem pendências financeiras</Text>
            )}
          </View>

          <Text style={styles.section}>Contratos</Text>
          {data.contracts.map((c) => (
            <View key={c.id} style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.contractCode}>{c.code ?? '—'}</Text>
                <Text
                  style={[
                    styles.badge,
                    c.status === 'ACTIVE'
                      ? c.connection.online
                        ? styles.badgeOnline
                        : styles.badgeOffline
                      : styles.badgeMuted,
                  ]}
                >
                  {c.status}
                  {c.status === 'ACTIVE' ? (c.connection.online ? ' · online' : ' · offline') : ''}
                </Text>
              </View>
              <Text style={styles.sub}>{c.planName ?? `${c.bandwidthMbps} Mbps`}</Text>
              <Text style={styles.sub}>{c.installationAddress}</Text>
              <View style={styles.grid}>
                <Field label="PPPoE" value={c.pppoeUsername ?? '—'} />
                <Field label="ONT SN" value={c.ont?.snGpon ?? '—'} />
                <Field label="Rx (dBm)" value={c.ont?.lastRxPowerDbm?.toString() ?? '—'} />
                <Field
                  label="CTO/porta"
                  value={c.opticalPort ? `${c.opticalPort.enclosureCode}/${c.opticalPort.number}` : '—'}
                />
              </View>
            </View>
          ))}

          {data.openInvoices.length > 0 && (
            <>
              <Text style={styles.section}>Faturas em aberto</Text>
              {data.openInvoices.map((i) => (
                <View key={i.id} style={styles.rowCard}>
                  <Text style={i.status === 'OVERDUE' ? styles.overdue : styles.sub}>
                    {i.dueDate} {i.status === 'OVERDUE' ? '(vencida)' : ''}
                  </Text>
                  <Text style={styles.name}>{i.amount}</Text>
                </View>
              ))}
            </>
          )}

          {data.recentServiceOrders.length > 0 && (
            <>
              <Text style={styles.section}>O.S recentes</Text>
              {data.recentServiceOrders.map((o) => (
                <View key={o.id} style={styles.rowCard}>
                  <Text style={styles.sub}>
                    {o.code ?? '—'} · {o.reasonName}
                  </Text>
                  <Text style={styles.sub}>{o.displayStatus}</Text>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f172a' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { color: '#f87171', fontSize: 14, textAlign: 'center' },
  body: { padding: 16, gap: 12 },
  card: { backgroundColor: '#1e293b', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#334155' },
  rowCard: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  name: { color: '#f8fafc', fontSize: 16, fontWeight: '700' },
  sub: { color: '#94a3b8', fontSize: 13, marginTop: 2 },
  balanceDue: { color: '#f87171', fontSize: 14, fontWeight: '600', marginTop: 6 },
  balanceOk: { color: '#10b981', fontSize: 13, marginTop: 6 },
  section: { color: '#cbd5e1', fontSize: 13, fontWeight: '600', marginTop: 8, marginBottom: 2 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  contractCode: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  badge: { fontSize: 11, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, overflow: 'hidden' },
  badgeOnline: { backgroundColor: '#10b98133', color: '#10b981' },
  badgeOffline: { backgroundColor: '#f59e0b33', color: '#f59e0b' },
  badgeMuted: { backgroundColor: '#33415580', color: '#94a3b8' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, gap: 12 },
  field: { width: '45%' },
  fieldLabel: { color: '#64748b', fontSize: 11 },
  fieldValue: { color: '#e2e8f0', fontSize: 13, marginTop: 1 },
  overdue: { color: '#f87171', fontSize: 13 },
});

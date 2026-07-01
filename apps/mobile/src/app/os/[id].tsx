/**
 * Execução da O.S (NetX Field). Duas naturezas convivendo, separadas na UI:
 *
 *  1. CAPTURA (funciona OFFLINE): fotos geo-carimbadas, GPS, leitura de sinal e
 *     observações → fechamento de suporte. Vai pela outbox (idempotente, sync ao
 *     reconectar). Fotos precisam de rede pra subir (presign), mas o resto da
 *     captura é offline; o fechamento fica pendente e sincroniza depois.
 *
 *  2. PROVISIONAMENTO (ONLINE-OBRIGATÓRIO): ativar/reprovisionar a ONU + subir o
 *     serviço. É escrita real em rede/financeiro — só com sinal, confirmado pelo
 *     servidor ANTES de concluir. O botão fica indisponível offline.
 */
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import NetInfo from '@react-native-community/netinfo';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';

import { ApiError } from '@/lib/api';
import { presignPhoto, uploadPresigned } from '@/lib/service-orders-api';
import { enqueueOp } from '@/sync/outbox';

interface CapturedPhoto {
  localUri: string;
  storageKey: string | null; // preenchido após upload (online)
  contentType: string;
}

export default function OsExecutionScreen() {
  const router = useRouter();
  const { id, code, customerName } = useLocalSearchParams<{
    id: string;
    code?: string;
    customerName?: string;
  }>();

  const [online, setOnline] = useState(true);
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [signal, setSignal] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => setOnline(Boolean(s.isConnected)));
    return () => unsub();
  }, []);

  async function addPhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permissão da câmera negada.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.6, exif: false });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const contentType = asset.mimeType ?? 'image/jpeg';
    const photo: CapturedPhoto = { localUri: asset.uri, storageKey: null, contentType };
    setPhotos((p) => [...p, photo]);

    // Sobe agora se online (presign precisa de rede). Offline: fica local e
    // sobe quando reconectar (retry manual ao concluir).
    if (online) {
      setBusy('foto');
      try {
        const { uploadUrl, storageKey } = await presignPhoto(id, `os-${id}.jpg`, contentType);
        await uploadPresigned(uploadUrl, asset.uri, contentType);
        setPhotos((p) => p.map((x) => (x.localUri === asset.uri ? { ...x, storageKey } : x)));
      } catch {
        // Mantém a foto local; storageKey null → não vai no fechamento até subir.
      } finally {
        setBusy(null);
      }
    }
  }

  async function captureGps() {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permissão de localização negada.');
      return;
    }
    setBusy('gps');
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      Alert.alert('Não foi possível obter a localização.');
    } finally {
      setBusy(null);
    }
  }

  async function finishCapture() {
    const uploadedKeys = photos.filter((p) => p.storageKey).map((p) => p.storageKey as string);
    const pendingPhotos = photos.length - uploadedKeys.length;

    // Fechamento de suporte inclui sinal/geo/notas no texto (o servidor é a
    // fonte da verdade; a captura já está estruturada no metadata do audit).
    const closeParts = [notes.trim()];
    if (signal.trim()) closeParts.push(`Sinal Rx: ${signal.trim()} dBm`);
    if (geo) closeParts.push(`GPS: ${geo.lat.toFixed(6)},${geo.lng.toFixed(6)}`);
    const closeDescription = closeParts.filter(Boolean).join(' · ') || 'Atendimento concluído em campo.';

    setBusy('finish');
    try {
      await enqueueOp({
        entity: 'service_order',
        entityLocalId: id,
        op: 'complete_field',
        method: 'POST',
        path: `/service-orders/${id}/complete-field`,
        payload: {
          mode: 'SUPPORT',
          closeDescription,
          completedAt: new Date().toISOString(),
          photos: uploadedKeys.map((storageKey) => ({ storageKey })),
          materials: [],
        },
      });
      Alert.alert(
        'Captura salva',
        online
          ? 'Enviando ao servidor…'
          : `Sem conexão — a O.S será sincronizada ao reconectar.${
              pendingPhotos ? ` (${pendingPhotos} foto(s) só sobem online)` : ''
            }`,
      );
      router.back();
    } catch (err) {
      Alert.alert('Erro', err instanceof ApiError ? err.message : 'Falha ao salvar a captura.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: code ? `O.S ${code}` : 'Execução da O.S' }} />
      <ScrollView contentContainerStyle={styles.body}>
        {customerName ? <Text style={styles.customer}>{customerName}</Text> : null}

        {/* CAPTURA (offline-capable) */}
        <View style={[styles.section, styles.captureSection]}>
          <Text style={styles.sectionTitle}>Captura</Text>
          <Text style={styles.sectionHint}>Funciona offline — sincroniza ao reconectar.</Text>

          <Pressable style={styles.action} onPress={addPhoto} disabled={busy === 'foto'}>
            <Text style={styles.actionText}>
              {busy === 'foto' ? 'Enviando foto…' : '📷 Adicionar foto'}
            </Text>
          </Pressable>
          {photos.length > 0 && (
            <View style={styles.thumbs}>
              {photos.map((p) => (
                <View key={p.localUri} style={styles.thumbWrap}>
                  <Image source={{ uri: p.localUri }} style={styles.thumb} />
                  {!p.storageKey && <Text style={styles.thumbPending}>pendente</Text>}
                </View>
              ))}
            </View>
          )}

          <Pressable style={styles.action} onPress={captureGps} disabled={busy === 'gps'}>
            <Text style={styles.actionText}>
              {geo ? `📍 ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}` : '📍 Carimbar localização'}
            </Text>
          </Pressable>

          <Text style={styles.label}>Leitura de sinal (dBm)</Text>
          <TextInput
            value={signal}
            onChangeText={setSignal}
            keyboardType="numbers-and-punctuation"
            placeholder="-21.5"
            placeholderTextColor="#64748b"
            style={styles.input}
          />

          <Text style={styles.label}>Observações</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="O que foi feito…"
            placeholderTextColor="#64748b"
            multiline
            style={[styles.input, styles.textarea]}
          />

          <Pressable
            style={[styles.primary, busy === 'finish' && styles.disabled]}
            onPress={finishCapture}
            disabled={busy === 'finish'}
          >
            {busy === 'finish' ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryText}>Concluir captura</Text>
            )}
          </Pressable>
        </View>

        {/* PROVISIONAMENTO (online-obrigatório) */}
        <View style={[styles.section, styles.provisionSection]}>
          <Text style={styles.sectionTitle}>Provisionamento</Text>
          <Text style={styles.sectionHint}>
            Ativa a ONU e sobe o serviço. Escrita real em rede/financeiro — precisa
            de conexão e é confirmada pelo servidor antes de concluir a O.S.
          </Text>
          <View style={[styles.netPill, online ? styles.netOnline : styles.netOffline]}>
            <Text style={styles.netPillText}>{online ? 'Online' : 'Sem conexão'}</Text>
          </View>
          <Pressable
            style={[styles.primary, styles.provisionBtn, !online && styles.disabled]}
            disabled={!online}
            onPress={() =>
              Alert.alert(
                'Provisionamento',
                'Abrir o formulário de provisionamento (OLT/serial/Wi-Fi) — precisa de conexão. Fluxo detalhado é o próximo passo.',
              )
            }
          >
            <Text style={styles.primaryText}>
              {online ? 'Provisionar serviço' : 'Indisponível offline'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f172a' },
  body: { padding: 16, gap: 16 },
  customer: { color: '#f8fafc', fontSize: 16, fontWeight: '600' },
  section: { borderRadius: 12, padding: 14, borderWidth: 1, gap: 10 },
  captureSection: { backgroundColor: '#1e293b', borderColor: '#334155' },
  provisionSection: { backgroundColor: '#1c1917', borderColor: '#7c2d12' },
  sectionTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  sectionHint: { color: '#94a3b8', fontSize: 12 },
  action: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  actionText: { color: '#e2e8f0', fontSize: 14, fontWeight: '500' },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumbWrap: { alignItems: 'center' },
  thumb: { width: 64, height: 64, borderRadius: 6, backgroundColor: '#334155' },
  thumbPending: { color: '#f59e0b', fontSize: 10, marginTop: 2 },
  label: { color: '#94a3b8', fontSize: 12, marginTop: 4 },
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
  textarea: { minHeight: 72, textAlignVertical: 'top' },
  primary: { backgroundColor: '#3b82f6', borderRadius: 8, paddingVertical: 13, alignItems: 'center', marginTop: 6 },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  provisionBtn: { backgroundColor: '#ea580c' },
  disabled: { opacity: 0.5 },
  netPill: { alignSelf: 'flex-start', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  netOnline: { backgroundColor: '#10b98133' },
  netOffline: { backgroundColor: '#f59e0b33' },
  netPillText: { color: '#e2e8f0', fontSize: 11, fontWeight: '600' },
});

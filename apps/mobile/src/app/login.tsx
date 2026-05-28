import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '@/lib/api';
import { MfaRequiredError } from '@/lib/auth';
import { useAuth } from '@/lib/auth-context';

export default function LoginScreen() {
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setLoading(true);
    setError(null);
    try {
      await login({
        email: email.trim(),
        password,
        mfaToken: mfaRequired ? mfaToken.trim() : undefined,
      });
      // Navigation acontece via AuthGate
    } catch (err) {
      if (err instanceof MfaRequiredError) {
        setMfaRequired(true);
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Erro inesperado. Verifique sua conexão.');
      }
    } finally {
      setLoading(false);
    }
  }

  const disabled = loading || !email || !password || (mfaRequired && mfaToken.length < 6);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.container}>
          <Text style={styles.title}>NetX Mobile</Text>
          <Text style={styles.subtitle}>Acesso do técnico em campo</Text>

          <View style={styles.field}>
            <Text style={styles.label}>E-mail</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              editable={!loading}
              placeholder="voce@empresa.com"
              placeholderTextColor="#64748b"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Senha</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
              editable={!loading}
              placeholder="••••••••"
              placeholderTextColor="#64748b"
            />
          </View>

          {mfaRequired ? (
            <View style={styles.field}>
              <Text style={styles.label}>Código MFA</Text>
              <TextInput
                style={styles.input}
                value={mfaToken}
                onChangeText={setMfaToken}
                keyboardType="number-pad"
                maxLength={8}
                editable={!loading}
                placeholder="6 dígitos do app autenticador"
                placeholderTextColor="#64748b"
              />
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.button, disabled && styles.buttonDisabled]}
            onPress={onSubmit}
            disabled={disabled}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Entrar</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f172a' },
  flex: { flex: 1 },
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 32, fontWeight: '700', color: '#f8fafc', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#94a3b8', marginBottom: 32 },
  field: { marginBottom: 16 },
  label: { fontSize: 12, color: '#cbd5e1', marginBottom: 6, fontWeight: '600' },
  input: {
    backgroundColor: '#1e293b',
    color: '#f8fafc',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  error: { color: '#f87171', fontSize: 13, marginBottom: 12 },
  button: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});

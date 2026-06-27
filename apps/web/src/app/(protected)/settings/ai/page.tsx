'use client';

/**
 * /settings/ai — configuração do motor de IA (@netx/ai) do tenant.
 *
 * Seções:
 *   1. Status            — backends disponíveis (primário + fallback) + teste
 *   2. Provider primário — motor aberto por padrão (Ollama self-hosted)
 *   3. Fallback de nuvem — híbrido (Anthropic ou nuvem OpenAI-compat aberta)
 *   4. Comportamento     — limites, timeout e mascaramento de PII
 *
 * Save: PUT /v1/ai/config (segredos write-only). A IA é conselheira — só
 * resume/explica, nunca aplica config. Strings inline pt-BR (padrão novo).
 */
import { useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldHelp, Input, Label, Select } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  aiApi,
  type AiConfigResponse,
  type AiStatusResponse,
  type UpsertAiConfigRequest,
} from '@/lib/ai-api';
import { hasPermission } from '@/lib/session';

const PROVIDERS = [
  { value: 'OLLAMA', label: 'Ollama (aberto, self-hosted)' },
  { value: 'OPENAI_COMPAT', label: 'OpenAI-compat (vLLM / Groq / OpenRouter)' },
  { value: 'ANTHROPIC', label: 'Anthropic (nuvem)' },
] as const;

export default function AiSettingsPage() {
  const canWrite = hasPermission('ai.config.write');
  const { data: config, mutate, isLoading } = useSWR<AiConfigResponse>(
    aiApi.configPath(),
    () => aiApi.getConfig(),
  );
  const { data: status, mutate: mutateStatus } = useSWR<AiStatusResponse>(
    aiApi.statusPath(),
    () => aiApi.getStatus(),
  );

  const [form, setForm] = useState<UpsertAiConfigRequest>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  if (isLoading || !config) return <PageLoader />;

  // Valor efetivo: o que o usuário digitou (form) ou o salvo (config).
  const v = <K extends keyof AiConfigResponse>(k: K): AiConfigResponse[K] =>
    (form as Record<string, unknown>)[k] !== undefined
      ? ((form as Record<string, unknown>)[k] as AiConfigResponse[K])
      : config[k];

  const set = (patch: Partial<UpsertAiConfigRequest>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      await aiApi.saveConfig(form);
      toast.success('Configuração de IA salva.');
      setForm({});
      await Promise.all([mutate(), mutateStatus()]);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    try {
      const r = await aiApi.test();
      if (r.ok) {
        toast.success(
          `OK via ${r.provider}${r.usedFallback ? ' (fallback)' : ''} — ${r.model}, ${r.latencyMs}ms`,
          { duration: 8000 },
        );
      } else {
        toast.error(`Falha no teste: ${r.error ?? 'sem detalhe'}`, { duration: 10000 });
      }
      await mutateStatus();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Falha ao testar (timeout?).');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Motor de IA</h1>
        <p className="text-sm text-muted-foreground">
          IA conselheira (read-only): resume e explica, nunca aplica configuração. Motor aberto
          (Ollama) por padrão, com fallback de nuvem opcional.
        </p>
      </div>

      {/* 1. Status */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Status</CardTitle>
          <Button variant="outline" onClick={runTest} disabled={testing}>
            {testing ? 'Testando…' : 'Testar conexão'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span>Motor:</span>
            <Badge variant={status?.available ? 'success' : 'warning'}>
              {status?.available ? 'disponível' : 'indisponível'}
            </Badge>
          </div>
          {status && (
            <div className="text-muted-foreground">
              Primário: <b>{status.primary.kind}</b> ({status.primary.model}) —{' '}
              {status.primary.available ? 'ok' : 'off'}
              {status.fallback && (
                <>
                  {' · '}Fallback: <b>{status.fallback.kind}</b> ({status.fallback.model}) —{' '}
                  {status.fallback.available ? 'ok' : 'off'}
                </>
              )}
            </div>
          )}
          <FieldHelp>
            Em CPU sem GPU a inferência local é lenta (minutos); o teste pode exceder o tempo
            limite. Para uso interativo, ligue o fallback de nuvem.
          </FieldHelp>
        </CardContent>
      </Card>

      {/* 2. Provider primário */}
      <Card>
        <CardHeader>
          <CardTitle>Provider primário (motor aberto)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start gap-2 rounded-lg bg-ai-muted/30 p-3 text-sm ring-1 ring-ai/20">
            <input
              type="checkbox"
              checked={Boolean(v('enabled'))}
              disabled={!canWrite}
              onChange={(e) => set({ enabled: e.target.checked })}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Ativar o motor de IA com esta configuração</span>
              <FieldHelp>
                Enquanto desligado, a IA ignora os campos abaixo e usa o padrão do servidor (Ollama
                local). Ligue para usar o provider/fallback configurados aqui.
              </FieldHelp>
            </span>
          </label>

          <div>
            <Label>Provider</Label>
            <Select
              value={v('provider')}
              disabled={!canWrite}
              onChange={(e) => set({ provider: e.target.value as UpsertAiConfigRequest['provider'] })}
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label>Endpoint (baseUrl)</Label>
            <Input
              value={v('baseUrl') ?? ''}
              placeholder="http://127.0.0.1:11434"
              disabled={!canWrite}
              onChange={(e) => set({ baseUrl: e.target.value || null })}
            />
            <FieldHelp>Ollama: http://127.0.0.1:11434 · OpenAI-compat: inclua /v1</FieldHelp>
          </div>

          <div>
            <Label>Modelo</Label>
            <Input
              value={v('model')}
              placeholder="qwen2.5:3b-instruct"
              disabled={!canWrite}
              onChange={(e) => set({ model: e.target.value })}
            />
          </div>

          <div>
            <Label>Chave de API {config.hasApiKey && <Badge variant="success">salva</Badge>}</Label>
            <Input
              type="password"
              value={form.apiKey ?? ''}
              placeholder={config.hasApiKey ? '•••••••• (manter)' : 'só para provider de nuvem'}
              disabled={!canWrite}
              onChange={(e) => set({ apiKey: e.target.value })}
            />
            <FieldHelp>Deixe em branco para manter a atual. Ollama local não precisa.</FieldHelp>
          </div>
        </CardContent>
      </Card>

      {/* 3. Fallback de nuvem */}
      <Card>
        <CardHeader>
          <CardTitle>Fallback de nuvem (híbrido)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(v('fallbackEnabled'))}
              disabled={!canWrite}
              onChange={(e) => set({ fallbackEnabled: e.target.checked })}
            />
            Cair para a nuvem quando o motor local falhar ou demorar
          </label>

          <div>
            <Label>Provider de fallback</Label>
            <Select
              value={v('fallbackProvider')}
              disabled={!canWrite}
              onChange={(e) =>
                set({ fallbackProvider: e.target.value as UpsertAiConfigRequest['fallbackProvider'] })
              }
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label>Modelo de fallback</Label>
            <Input
              value={v('fallbackModel')}
              placeholder="claude-haiku-4-5"
              disabled={!canWrite}
              onChange={(e) => set({ fallbackModel: e.target.value })}
            />
          </div>

          <div>
            <Label>Endpoint de fallback (opcional)</Label>
            <Input
              value={v('fallbackBaseUrl') ?? ''}
              placeholder="https://api.groq.com/openai/v1"
              disabled={!canWrite}
              onChange={(e) => set({ fallbackBaseUrl: e.target.value || null })}
            />
          </div>

          <div>
            <Label>
              Chave do fallback{' '}
              {config.hasFallbackApiKey && <Badge variant="success">salva</Badge>}
            </Label>
            <Input
              type="password"
              value={form.fallbackApiKey ?? ''}
              placeholder={config.hasFallbackApiKey ? '•••••••• (manter)' : 'chave da nuvem'}
              disabled={!canWrite}
              onChange={(e) => set({ fallbackApiKey: e.target.value })}
            />
            <FieldHelp>Anthropic reaproveita ANTHROPIC_API_KEY do servidor se vazio.</FieldHelp>
          </div>
        </CardContent>
      </Card>

      {/* 4. Comportamento */}
      <Card>
        <CardHeader>
          <CardTitle>Comportamento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Máx. tokens</Label>
              <Input
                type="number"
                value={v('maxTokens')}
                disabled={!canWrite}
                onChange={(e) => set({ maxTokens: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Timeout (ms)</Label>
              <Input
                type="number"
                value={v('timeoutMs')}
                disabled={!canWrite}
                onChange={(e) => set({ timeoutMs: Number(e.target.value) })}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(v('redactPii'))}
              disabled={!canWrite}
              onChange={(e) => set({ redactPii: e.target.checked })}
            />
            Mascarar PII (CPF/CNPJ/e-mail/telefone) antes de enviar à nuvem
          </label>
        </CardContent>
      </Card>

      {canWrite && (
        <div className="flex justify-end gap-2">
          <Button onClick={save} disabled={saving || Object.keys(form).length === 0}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      )}
    </div>
  );
}

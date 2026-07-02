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
import { useTranslations } from 'next-intl';
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

export default function AiSettingsPage() {
  const t = useTranslations('settingsAi');
  const tCommon = useTranslations('common');
  const PROVIDERS = [
    { value: 'OLLAMA', label: t('providers.ollama') },
    { value: 'OPENAI_COMPAT', label: t('providers.openaiCompat') },
    { value: 'ANTHROPIC', label: t('providers.anthropic') },
  ] as const;
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
      toast.success(t('toast.saved'));
      setForm({});
      await Promise.all([mutate(), mutateStatus()]);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('toast.saveError'));
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
          t('toast.testOk', {
            provider: r.provider,
            fallback: r.usedFallback ? t('toast.testFallbackSuffix') : '',
            model: r.model,
            latency: r.latencyMs,
          }),
          { duration: 8000 },
        );
      } else {
        toast.error(t('toast.testFail', { error: r.error ?? t('toast.noDetail') }), {
          duration: 10000,
        });
      }
      await mutateStatus();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('toast.testError'));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* 1. Status */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{tCommon('status')}</CardTitle>
          <Button variant="outline" onClick={runTest} disabled={testing}>
            {testing ? t('status.testing') : t('status.testConnection')}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span>{t('status.engine')}</span>
            <Badge tone={status?.available ? 'success' : 'warning'}>
              {status?.available ? t('status.available') : t('status.unavailable')}
            </Badge>
          </div>
          {status && (
            <div className="text-muted-foreground">
              {t('status.primary')} <b>{status.primary.kind}</b> ({status.primary.model}) —{' '}
              {status.primary.available ? t('status.ok') : t('status.off')}
              {status.fallback && (
                <>
                  {' · '}
                  {t('status.fallback')} <b>{status.fallback.kind}</b> ({status.fallback.model}) —{' '}
                  {status.fallback.available ? t('status.ok') : t('status.off')}
                </>
              )}
            </div>
          )}
          <FieldHelp>{t('status.help')}</FieldHelp>
        </CardContent>
      </Card>

      {/* 2. Provider primário */}
      <Card>
        <CardHeader>
          <CardTitle>{t('primary.title')}</CardTitle>
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
              <span className="font-medium">{t('primary.enable')}</span>
              <FieldHelp>{t('primary.enableHelp')}</FieldHelp>
            </span>
          </label>

          <div>
            <Label>{t('primary.provider')}</Label>
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
            <Label>{t('primary.endpoint')}</Label>
            <Input
              value={v('baseUrl') ?? ''}
              placeholder="http://127.0.0.1:11434"
              disabled={!canWrite}
              onChange={(e) => set({ baseUrl: e.target.value || null })}
            />
            <FieldHelp>{t('primary.endpointHelp')}</FieldHelp>
          </div>

          <div>
            <Label>{t('primary.model')}</Label>
            <Input
              value={v('model')}
              placeholder="qwen2.5:3b-instruct"
              disabled={!canWrite}
              onChange={(e) => set({ model: e.target.value })}
            />
          </div>

          <div>
            <Label>
              {t('primary.apiKey')} {config.hasApiKey && <Badge tone="success">{t('saved')}</Badge>}
            </Label>
            <Input
              type="password"
              value={form.apiKey ?? ''}
              placeholder={config.hasApiKey ? t('primary.apiKeyKeep') : t('primary.apiKeyCloudOnly')}
              disabled={!canWrite}
              onChange={(e) => set({ apiKey: e.target.value })}
            />
            <FieldHelp>{t('primary.apiKeyHelp')}</FieldHelp>
          </div>
        </CardContent>
      </Card>

      {/* 3. Fallback de nuvem */}
      <Card>
        <CardHeader>
          <CardTitle>{t('fallback.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(v('fallbackEnabled'))}
              disabled={!canWrite}
              onChange={(e) => set({ fallbackEnabled: e.target.checked })}
            />
            {t('fallback.enable')}
          </label>

          <div>
            <Label>{t('fallback.provider')}</Label>
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
            <Label>{t('fallback.model')}</Label>
            <Input
              value={v('fallbackModel')}
              placeholder="claude-haiku-4-5"
              disabled={!canWrite}
              onChange={(e) => set({ fallbackModel: e.target.value })}
            />
          </div>

          <div>
            <Label>{t('fallback.endpoint')}</Label>
            <Input
              value={v('fallbackBaseUrl') ?? ''}
              placeholder="https://api.groq.com/openai/v1"
              disabled={!canWrite}
              onChange={(e) => set({ fallbackBaseUrl: e.target.value || null })}
            />
          </div>

          <div>
            <Label>
              {t('fallback.apiKey')}{' '}
              {config.hasFallbackApiKey && <Badge tone="success">{t('saved')}</Badge>}
            </Label>
            <Input
              type="password"
              value={form.fallbackApiKey ?? ''}
              placeholder={
                config.hasFallbackApiKey ? t('primary.apiKeyKeep') : t('fallback.apiKeyCloud')
              }
              disabled={!canWrite}
              onChange={(e) => set({ fallbackApiKey: e.target.value })}
            />
            <FieldHelp>{t('fallback.apiKeyHelp')}</FieldHelp>
          </div>
        </CardContent>
      </Card>

      {/* 4. Comportamento */}
      <Card>
        <CardHeader>
          <CardTitle>{t('behavior.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{t('behavior.maxTokens')}</Label>
              <Input
                type="number"
                value={v('maxTokens')}
                disabled={!canWrite}
                onChange={(e) => set({ maxTokens: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>{t('behavior.timeout')}</Label>
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
            {t('behavior.redactPii')}
          </label>
        </CardContent>
      </Card>

      {canWrite && (
        <div className="flex justify-end gap-2">
          <Button onClick={save} disabled={saving || Object.keys(form).length === 0}>
            {saving ? tCommon('saving') : tCommon('save')}
          </Button>
        </div>
      )}
    </div>
  );
}

'use client';

/**
 * /settings/hubsoft — CONEXÃO com a API oficial do Hubsoft (config).
 *
 * Só credenciais/conexão/teste. A ferramenta de migração (listar clientes,
 * escolher quem importar e sincronizar) fica em /settings/hubsoft/import.
 *
 * Textos em PT inline (mesmo padrão das demais telas).
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { FieldHelp, Input, Label } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  hubsoftApi,
  type HubsoftConfigView,
  type HubsoftDiagnostics,
} from '@/lib/hubsoft-api';
import { hasPermission } from '@/lib/session';

export default function HubsoftSettingsPage() {
  const canWrite = hasPermission('hubsoft.config.write');
  const { data: config, mutate, isLoading } = useSWR<HubsoftConfigView>(
    hubsoftApi.configPath(),
    () => hubsoftApi.getConfig(),
  );

  if (isLoading || !config) return <PageLoader />;

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Hubsoft — conexão</h1>
          <p className="mt-1 text-sm text-text-muted">
            Credenciais da API oficial do Hubsoft (read-only). Depois de conectar, use a página de
            migração para listar e importar os clientes.
          </p>
        </div>
        {config.enabled && config.hasCredentials && (
          <Link
            href="/settings/hubsoft/import"
            className="shrink-0 rounded-md border border-accent bg-accent-muted px-3 py-2 text-sm font-semibold text-text hover:opacity-90"
          >
            Importar clientes →
          </Link>
        )}
      </header>

      <ConnectionCard config={config} canWrite={canWrite} onSaved={() => mutate()} />
      <CredentialsCard config={config} canWrite={canWrite} onSaved={() => mutate()} />
      <DiagnosticsCard />
    </div>
  );
}

// =============================================================================
// Conexão
// =============================================================================
function ConnectionCard({
  config,
  canWrite,
  onSaved,
}: {
  config: HubsoftConfigView;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [host, setHost] = useState(config.host ?? '');
  const [enabled, setEnabled] = useState(config.enabled);
  const [autoSync, setAutoSync] = useState(config.autoSync);
  const [syncCustomers, setSyncCustomers] = useState(config.syncCustomers);
  const [syncFinanceiro, setSyncFinanceiro] = useState(config.syncFinanceiro);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setHost(config.host ?? '');
    setEnabled(config.enabled);
    setAutoSync(config.autoSync);
    setSyncCustomers(config.syncCustomers);
    setSyncFinanceiro(config.syncFinanceiro);
  }, [config]);

  async function save() {
    setSaving(true);
    try {
      await hubsoftApi.saveConfig({
        host: host.trim() || undefined,
        enabled,
        autoSync,
        syncCustomers,
        syncFinanceiro,
      });
      toast.success('Conexão salva');
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha ao salvar: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  const badge = !config.hasCredentials ? (
    <Badge tone="neutral">Sem credenciais</Badge>
  ) : config.enabled ? (
    <Badge tone="success">Ativo{config.autoSync ? ' · sync 4x/dia' : ''}</Badge>
  ) : (
    <Badge tone="neutral">Configurado, desativado</Badge>
  );

  return (
    <Section title="Conexão" rightSlot={badge}>
      <div className="space-y-4">
        <div>
          <Label>Host do servidor</Label>
          <Input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="https://api.provedor.hubsoft.com.br"
            disabled={!canWrite}
          />
          <FieldHelp>Endereço do servidor Hubsoft do provedor (sem barra no final).</FieldHelp>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Check
            id="hub-enabled"
            checked={enabled}
            onChange={setEnabled}
            disabled={!canWrite}
            label="Habilitar integração"
            help="Exige host + credenciais configuradas."
          />
          <Check
            id="hub-autosync"
            checked={autoSync}
            onChange={setAutoSync}
            disabled={!canWrite}
            label="Sincronizar importados 4x/dia"
            help="A cada 6h, atualiza só os clientes já importados. Sempre read-only."
          />
          <Check
            id="hub-cust"
            checked={syncCustomers}
            onChange={setSyncCustomers}
            disabled={!canWrite}
            label="Sincronizar clientes + contratos"
          />
          <Check
            id="hub-fin"
            checked={syncFinanceiro}
            onChange={setSyncFinanceiro}
            disabled={!canWrite}
            label="Sincronizar financeiro (faturas)"
          />
        </div>

        {config.lastSyncAt && (
          <p className="text-xs text-text-muted">
            Último sync: {new Date(config.lastSyncAt).toLocaleString('pt-BR')}
            {config.lastSyncStatus ? ` · ${config.lastSyncStatus}` : ''}
            {config.lastSyncError ? ` · ${config.lastSyncError}` : ''}
          </p>
        )}
      </div>

      {canWrite && (
        <div className="mt-4 flex justify-end">
          <Button onClick={save} loading={saving}>
            Salvar conexão
          </Button>
        </div>
      )}
    </Section>
  );
}

// =============================================================================
// Credenciais (OAuth password grant — write-only)
// =============================================================================
function CredentialsCard({
  config,
  canWrite,
  onSaved,
}: {
  config: HubsoftConfigView;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!clientId && !clientSecret && !username && !password) {
      toast.error('Preencha as credenciais antes de salvar');
      return;
    }
    setSaving(true);
    try {
      await hubsoftApi.saveConfig({
        clientId: clientId.trim() || undefined,
        clientSecret: clientSecret.trim() || undefined,
        username: username.trim() || undefined,
        password: password || undefined,
      });
      toast.success('Credenciais salvas');
      setClientId('');
      setClientSecret('');
      setUsername('');
      setPassword('');
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha ao salvar: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title="Credenciais"
      rightSlot={
        config.hasCredentials ? (
          <Badge tone="success">Configuradas</Badge>
        ) : (
          <Badge tone="warning">Pendentes</Badge>
        )
      }
    >
      <p className="mb-3 text-xs text-text-muted">
        OAuth2 (password grant) do Hubsoft. Solicite ao administrador do provedor:{' '}
        <b>client_id</b>, <b>client_secret</b>, <b>usuário</b> e <b>senha</b> da API. Os valores são
        cifrados no servidor e nunca retornam — deixe em branco para manter os atuais.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>client_id</Label>
          <Input value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={!canWrite}
            placeholder={config.hasCredentials ? '•••••• (mantém)' : ''} autoComplete="off" />
        </div>
        <div>
          <Label>client_secret</Label>
          <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)}
            disabled={!canWrite} placeholder={config.hasCredentials ? '•••••• (mantém)' : ''} autoComplete="off" />
        </div>
        <div>
          <Label>Usuário</Label>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} disabled={!canWrite}
            placeholder={config.hasCredentials ? '•••••• (mantém)' : ''} autoComplete="off" />
        </div>
        <div>
          <Label>Senha</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            disabled={!canWrite} placeholder={config.hasCredentials ? '•••••• (mantém)' : ''} autoComplete="off" />
        </div>
      </div>
      {canWrite && (
        <div className="mt-4 flex justify-end">
          <Button onClick={save} loading={saving}>
            Salvar credenciais
          </Button>
        </div>
      )}
    </Section>
  );
}

// =============================================================================
// Testar conexão
// =============================================================================
function DiagnosticsCard() {
  const [running, setRunning] = useState(false);
  const [diag, setDiag] = useState<HubsoftDiagnostics | null>(null);

  async function run() {
    setRunning(true);
    try {
      setDiag(await hubsoftApi.diagnostics());
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha ao testar conexão: ${msg}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Section title="Testar conexão">
      <p className="mb-3 text-xs text-text-muted">
        Faz o login OAuth na API do Hubsoft sem importar nada. Valide aqui antes de migrar.
      </p>
      <div className="flex justify-end">
        <Button onClick={run} loading={running} variant="outline">
          Testar conexão
        </Button>
      </div>
      {diag && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs">
            <span className="font-medium text-text">{diag.host ?? '—'}</span>
            <Badge tone={diag.ok ? 'success' : 'danger'}>
              {diag.hint} {diag.status ? `· HTTP ${diag.status}` : ''}
            </Badge>
          </div>
        </div>
      )}
    </Section>
  );
}

// =============================================================================
// Helpers de UI
// =============================================================================
function Check({
  id,
  checked,
  onChange,
  disabled,
  label,
  help,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
  help?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id={id}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="h-4 w-4"
        />
        <label htmlFor={id} className="text-sm text-text">
          {label}
        </label>
      </div>
      {help && <FieldHelp>{help}</FieldHelp>}
    </div>
  );
}

function Section({
  title,
  rightSlot,
  children,
}: {
  title: string;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-text">{title}</h2>
        {rightSlot}
      </div>
      {children}
    </section>
  );
}

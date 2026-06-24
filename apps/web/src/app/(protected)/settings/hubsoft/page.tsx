'use client';

/**
 * /settings/hubsoft — integração de LEITURA com a API oficial do Hubsoft.
 *
 * Usada na migração/operação conjunta de um provedor que está saindo do
 * Hubsoft: o NetX puxa clientes, contratos e financeiro e espelha nos seus
 * modelos. Nunca escreve no Hubsoft.
 *
 * Seções:
 *   1. Conexão     — host + habilitar + sync automático + entidades
 *   2. Credenciais — client_id/secret + usuário/senha (OAuth password grant, write-only)
 *   3. Testar      — diagnóstico OAuth sem importar nada
 *   4. Sincronizar — filtros (cidade/status/grupo), dry-run e resultado/preview
 *
 * Textos em PT inline (mesmo padrão das demais telas; i18n pode vir depois).
 */
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
  type HubsoftServiceStatus,
  type HubsoftSyncResult,
} from '@/lib/hubsoft-api';
import { hasPermission } from '@/lib/session';

export default function HubsoftSettingsPage() {
  const canWrite = hasPermission('hubsoft.config.write');
  const canSync = hasPermission('hubsoft.sync.write');
  const { data: config, mutate, isLoading } = useSWR<HubsoftConfigView>(
    hubsoftApi.configPath(),
    () => hubsoftApi.getConfig(),
  );

  if (isLoading || !config) return <PageLoader />;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Hubsoft — migração</h1>
        <p className="mt-1 text-sm text-text-muted">
          Integração de leitura com a API oficial do Hubsoft. O NetX puxa clientes, contratos e
          financeiro e espelha aqui — nada é escrito no Hubsoft. Ideal para operar em paralelo
          durante a migração de um provedor.
        </p>
      </header>

      <ConnectionCard config={config} canWrite={canWrite} onSaved={() => mutate()} />
      <CredentialsCard config={config} canWrite={canWrite} onSaved={() => mutate()} />
      <DiagnosticsCard />
      <SyncCard canSync={canSync} lastConfig={config} onRan={() => mutate()} />
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
    <Badge tone="success">Ativo{config.autoSync ? ' · sync automático' : ''}</Badge>
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
            label="Sync automático (de hora em hora)"
            help="Mantém os dados espelhados sem ação manual. Sempre read-only."
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
        Faz o login OAuth na API do Hubsoft sem importar nada. Valide aqui antes de sincronizar.
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
// Sincronizar (filtros + dry-run + resultado)
// =============================================================================
const STATUS_OPTS: HubsoftServiceStatus[] = ['ativo', 'bloqueado', 'cancelado'];

function SyncCard({
  canSync,
  lastConfig,
  onRan,
}: {
  canSync: boolean;
  lastConfig: HubsoftConfigView;
  onRan: () => void;
}) {
  const [cidades, setCidades] = useState('');
  const [grupos, setGrupos] = useState('');
  const [status, setStatus] = useState<HubsoftServiceStatus[]>([]);
  const [dryRun, setDryRun] = useState(true);
  const [limit, setLimit] = useState('20');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<HubsoftSyncResult | null>(null);

  const enabled = lastConfig.enabled && lastConfig.hasCredentials;

  function toggleStatus(s: HubsoftServiceStatus) {
    setStatus((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function parseCsv(v: string): string[] {
    return v
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  }

  async function run() {
    setRunning(true);
    try {
      const cidadesArr = parseCsv(cidades);
      const gruposArr = parseCsv(grupos);
      const filters =
        cidadesArr.length || gruposArr.length || status.length
          ? {
              ...(cidadesArr.length ? { cidades: cidadesArr } : {}),
              ...(gruposArr.length ? { grupos: gruposArr } : {}),
              ...(status.length ? { status } : {}),
            }
          : undefined;
      const limitNum = limit.trim() ? Number(limit) : undefined;
      const res = await hubsoftApi.runSync({
        dryRun,
        ...(limitNum && Number.isFinite(limitNum) ? { limit: limitNum } : {}),
        ...(filters ? { filters } : {}),
      });
      setResult(res);
      if (!dryRun) {
        toast.success('Sincronização concluída');
        onRan();
      } else {
        toast.success('Dry-run concluído (nada foi gravado)');
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha ao sincronizar: ${msg}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Section
      title="Sincronizar"
      rightSlot={dryRun ? <Badge tone="warning">Dry-run</Badge> : <Badge tone="danger">Grava no NetX</Badge>}
    >
      {!enabled && (
        <p className="mb-3 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-text-muted">
          Habilite a integração e salve as credenciais antes de sincronizar.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Cidades</Label>
          <Input value={cidades} onChange={(e) => setCidades(e.target.value)}
            placeholder="Divinópolis, São Paulo" disabled={!canSync} />
          <FieldHelp>Separe por vírgula. Sem acento/maiúscula importa. Vazio = todas.</FieldHelp>
        </div>
        <div>
          <Label>Grupos / planos de serviço</Label>
          <Input value={grupos} onChange={(e) => setGrupos(e.target.value)}
            placeholder="300 MEGA, FIBRA, 100" disabled={!canSync} />
          <FieldHelp>Casa por id do serviço, nome/número do plano ou código do pacote.</FieldHelp>
        </div>
      </div>

      <div className="mt-4">
        <Label>Status do serviço</Label>
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={!canSync}
              onClick={() => toggleStatus(s)}
              aria-pressed={status.includes(s)}
              className={
                'rounded-md border px-3 py-1.5 text-sm capitalize transition-colors ' +
                (status.includes(s)
                  ? 'border-accent bg-accent-muted text-text'
                  : 'border-border bg-surface text-text-muted hover:bg-surface-hover')
              }
            >
              {s}
            </button>
          ))}
        </div>
        <FieldHelp>Nenhum selecionado = todos os status. Marcar “cancelado” busca cancelados na API.</FieldHelp>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <div className="w-32">
          <Label>Limite</Label>
          <Input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="numeric"
            placeholder="20" disabled={!canSync} />
        </div>
        <Check id="hub-dryrun" checked={dryRun} onChange={setDryRun} disabled={!canSync}
          label="Dry-run (não grava — só prévia)" />
        <div className="ml-auto">
          <Button onClick={run} loading={running} disabled={!canSync || !enabled}
            variant={dryRun ? 'outline' : 'primary'}>
            {dryRun ? 'Pré-visualizar' : 'Sincronizar agora'}
          </Button>
        </div>
      </div>

      {result && <SyncResult result={result} />}
    </Section>
  );
}

function SyncResult({ result }: { result: HubsoftSyncResult }) {
  return (
    <div className="mt-5 space-y-3">
      <p className="text-xs text-text-muted">
        {result.dryRun ? 'Dry-run' : 'Execução'} · {result.durationMs} ms
      </p>
      {result.entities.map((e) => (
        <div key={e.entity} className="rounded-md border border-border bg-surface-muted p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-sm font-semibold capitalize text-text">
              {e.entity === 'customers' ? 'Clientes + contratos' : 'Financeiro'}
            </span>
            <Badge tone={e.failed ? 'warning' : 'success'}>
              {e.failed ? `${e.failed} falha(s)` : 'OK'}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
            <Fact label="Buscados" value={String(e.fetched)} />
            <Fact label="Filtrados" value={String(e.filteredOut ?? 0)} />
            <Fact label="Criados" value={String(e.created)} />
            <Fact label="Atualizados" value={String(e.updated)} />
            <Fact label="Ignorados" value={String(e.skipped)} />
          </div>

          {e.errors.length > 0 && (
            <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-border bg-surface p-2 text-[11px] leading-snug text-danger">
              {JSON.stringify(e.errors.slice(0, 50), null, 2)}
            </pre>
          )}

          {e.preview && e.preview.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-text-muted">
                Prévia ({e.preview.length} registro(s)) — clique para expandir
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border bg-surface p-2 text-[11px] leading-snug text-text-muted">
                {JSON.stringify(e.preview.slice(0, 20), null, 2)}
              </pre>
            </details>
          )}
        </div>
      ))}
    </div>
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <div className="text-text-muted">{label}</div>
      <div className="truncate font-mono text-text">{value}</div>
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

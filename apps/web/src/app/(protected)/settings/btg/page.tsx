'use client';

/**
 * /settings/btg — configuração de pagamentos BTG Pactual do tenant (BR).
 *
 * Seções:
 *   1. Status         — enabled + ambiente (produção/homologação) + badge resumo
 *   2. Gateway BR     — escolhe EFI vs BTG (só um gera cobrança automática)
 *   3. Credenciais    — clientId/secret (write-only) + redirectUri + dados da conta
 *   4. Consentimento  — fluxo OAuth Authorization Code (BTG Id) exigido p/ pix/boleto
 *   5. Cobrança       — chave Pix, tipo padrão, expiração, multa/juros, autogeração
 *   6. Webhook        — URL pública + registrar webhook no BTG
 *
 * Save: PUT /v1/btg/config (campos comuns + segredos write-only).
 * Segredos nunca voltam do backend — só a flag de presença (hasCredentials).
 * Strings inline em pt-BR (sem i18n) — padrão das telas novas do NetX.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { FieldHelp, Input, Label } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  btgApi,
  type BrPaymentGateway,
  type BtgChargeKind,
  type BtgConfigView,
  type BtgDiagnostics,
} from '@/lib/finance-api';
import { hasPermission } from '@/lib/session';

export default function BtgSettingsPage() {
  const canWrite = hasPermission('btg.config.write');
  const { data: config, mutate, isLoading } = useSWR<BtgConfigView>(
    btgApi.configPath(),
    () => btgApi.getConfig(),
  );

  const searchParams = useSearchParams();
  useEffect(() => {
    const result = searchParams.get('btg');
    if (result === 'ok') {
      toast.success('Conta BTG autorizada com sucesso.');
      void mutate();
    } else if (result === 'error') {
      const reason = searchParams.get('reason');
      toast.error(reason ? `Falha ao autorizar: ${reason}` : 'Falha ao autorizar a conta BTG.', {
        duration: reason ? 12000 : 4000,
      });
      void mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  if (isLoading || !config) return <PageLoader />;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Pagamentos (BTG)</h1>
        <p className="mt-1 text-sm text-text-muted">
          Configuração da integração de pagamentos BTG Pactual (boleto, Pix cobrança e Pix
          Automático) deste tenant.
        </p>
      </header>

      <StatusCard config={config} canWrite={canWrite} onSaved={() => mutate()} />
      <GatewayCard canWrite={canWrite} />
      <CredentialsCard config={config} canWrite={canWrite} onSaved={() => mutate()} />
      <ConsentCard config={config} canWrite={canWrite} />
      <ChargingCard config={config} canWrite={canWrite} onSaved={() => mutate()} />
      <WebhookCard config={config} canWrite={canWrite} onSaved={() => mutate()} />
    </div>
  );
}

// =============================================================================
// Status
// =============================================================================
function StatusCard({
  config,
  canWrite,
  onSaved,
}: {
  config: BtgConfigView;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [enabled, setEnabled] = useState(config.enabled);
  const [environment, setEnvironment] = useState(config.environment);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(config.enabled);
    setEnvironment(config.environment);
  }, [config.enabled, config.environment]);

  async function save() {
    setSaving(true);
    try {
      await btgApi.saveConfig({ enabled, environment });
      toast.success('Status atualizado.');
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  const statusBadge = (() => {
    if (!config.hasCredentials) return <Badge tone="neutral">Sem credenciais</Badge>;
    if (config.enabled) {
      return (
        <Badge tone={config.environment === 'PRODUCTION' ? 'success' : 'warning'}>
          {config.environment === 'PRODUCTION' ? 'Ativo (produção)' : 'Ativo (homologação)'}
        </Badge>
      );
    }
    return <Badge tone="neutral">Configurado (desabilitado)</Badge>;
  })();

  return (
    <Section title="Status" rightSlot={statusBadge}>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Habilitar BTG</Label>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={!canWrite}
              className="h-4 w-4"
              id="btg-enabled"
            />
            <label htmlFor="btg-enabled" className="text-sm text-text">
              Ativar a integração de pagamentos BTG
            </label>
          </div>
          <FieldHelp>Exige credenciais cadastradas. Pix/boleto exigem consentimento.</FieldHelp>
        </div>
        <div>
          <Label>Ambiente</Label>
          <div className="flex gap-2">
            <EnvRadio
              label="Homologação"
              description="Sandbox do BTG"
              active={environment === 'SANDBOX'}
              onClick={() => setEnvironment('SANDBOX')}
              disabled={!canWrite}
            />
            <EnvRadio
              label="Produção"
              description="Cobranças reais"
              active={environment === 'PRODUCTION'}
              onClick={() => setEnvironment('PRODUCTION')}
              disabled={!canWrite}
            />
          </div>
        </div>
      </div>
      {canWrite && (
        <div className="mt-4 flex justify-end">
          <Button onClick={save} loading={saving}>
            Salvar status
          </Button>
        </div>
      )}
    </Section>
  );
}

function EnvRadio({
  label,
  description,
  active,
  onClick,
  disabled,
}: {
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={
        'flex-1 rounded-md border px-3 py-2 text-left text-sm transition-colors ' +
        (active
          ? 'border-accent bg-accent-muted text-text'
          : 'border-border bg-surface text-text-muted hover:bg-surface-hover ' +
            'disabled:opacity-60 disabled:cursor-not-allowed')
      }
    >
      <div className="font-semibold">{label}</div>
      <div className="text-xs text-text-muted">{description}</div>
    </button>
  );
}

// =============================================================================
// Gateway BR ativo (EFI vs BTG)
// =============================================================================
function GatewayCard({ canWrite }: { canWrite: boolean }) {
  const { data, mutate, isLoading } = useSWR<{ gateway: BrPaymentGateway }>(
    '/v1/btg/gateway',
    () => btgApi.getGateway(),
  );
  const [saving, setSaving] = useState<BrPaymentGateway | null>(null);
  const gateway = data?.gateway ?? 'EFI';

  async function setGateway(g: BrPaymentGateway) {
    if (g === gateway) return;
    setSaving(g);
    try {
      await btgApi.setGateway(g);
      toast.success(`Gateway BR ativo: ${g}.`);
      await mutate();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha: ${msg}`);
    } finally {
      setSaving(null);
    }
  }

  return (
    <Section
      title="Gateway BR ativo"
      rightSlot={!isLoading && <Badge tone="success">{gateway}</Badge>}
    >
      <p className="mb-3 text-xs text-text-muted">
        Só um gateway gera cobrança automática por tenant (evita duplicar boleto/Pix da mesma
        fatura). Escolha qual provedor fica responsável pela autogeração.
      </p>
      <div className="flex gap-2">
        <EnvRadio
          label="EFI"
          description="EfiPay (Pix + Bolix)"
          active={gateway === 'EFI'}
          onClick={() => setGateway('EFI')}
          disabled={!canWrite || saving != null}
        />
        <EnvRadio
          label="BTG"
          description="BTG Pactual"
          active={gateway === 'BTG'}
          onClick={() => setGateway('BTG')}
          disabled={!canWrite || saving != null}
        />
      </div>
    </Section>
  );
}

// =============================================================================
// Credenciais & Conta
// =============================================================================
function CredentialsCard({
  config,
  canWrite,
  onSaved,
}: {
  config: BtgConfigView;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState(config.redirectUri ?? '');
  const [companyId, setCompanyId] = useState(config.companyId ?? '');
  const [accountNumber, setAccountNumber] = useState(config.accountNumber ?? '');
  const [accountBranch, setAccountBranch] = useState(config.accountBranch ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRedirectUri(config.redirectUri ?? '');
    setCompanyId(config.companyId ?? '');
    setAccountNumber(config.accountNumber ?? '');
    setAccountBranch(config.accountBranch ?? '');
  }, [config]);

  async function save() {
    setSaving(true);
    try {
      await btgApi.saveConfig({
        ...(clientId ? { clientId } : {}),
        ...(clientSecret ? { clientSecret } : {}),
        redirectUri: redirectUri || null,
        companyId: companyId || null,
        accountNumber: accountNumber || null,
        accountBranch: accountBranch || null,
      });
      toast.success('Credenciais salvas.');
      setClientId('');
      setClientSecret('');
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title="Credenciais & Conta"
      rightSlot={
        <Badge tone={config.hasCredentials ? 'success' : 'neutral'}>
          {config.hasCredentials ? 'Credenciais OK' : 'Sem credenciais'}
        </Badge>
      }
    >
      <p className="mb-3 text-xs text-text-muted">
        Credenciais OAuth do app no console BTG. Segredos são write-only: enviados aqui, nunca
        retornados — deixe em branco para manter o valor atual.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Client ID</Label>
          <Input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder={config.hasCredentials ? '••• configurado' : 'Client_Id_...'}
            disabled={!canWrite}
            autoComplete="off"
          />
        </div>
        <div>
          <Label>Client Secret</Label>
          <Input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={config.hasCredentials ? '••• configurado' : 'Client_Secret_...'}
            disabled={!canWrite}
            autoComplete="new-password"
          />
        </div>
        <div className="md:col-span-2">
          <Label>Redirect URI</Label>
          <Input
            type="url"
            value={redirectUri}
            onChange={(e) => setRedirectUri(e.target.value)}
            placeholder="https://api.seu-dominio.com/v1/btg/oauth/callback"
            disabled={!canWrite}
            autoComplete="off"
          />
          <FieldHelp>
            Registre esta mesma URL no console BTG — deve ser{' '}
            <code className="font-mono">{'<api-pública>/v1/btg/oauth/callback'}</code>.
          </FieldHelp>
        </div>
        <div>
          <Label>CNPJ da empresa</Label>
          <Input
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            placeholder="00.000.000/0001-00"
            disabled={!canWrite}
            autoComplete="off"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Conta</Label>
            <Input
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder="0000000"
              disabled={!canWrite}
              autoComplete="off"
            />
          </div>
          <div>
            <Label>Agência</Label>
            <Input
              value={accountBranch}
              onChange={(e) => setAccountBranch(e.target.value)}
              placeholder="0001"
              disabled={!canWrite}
              autoComplete="off"
            />
          </div>
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
// Consentimento (OAuth Authorization Code)
// =============================================================================
function ConsentCard({ config, canWrite }: { config: BtgConfigView; canWrite: boolean }) {
  const [authorizing, setAuthorizing] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diag, setDiag] = useState<BtgDiagnostics | null>(null);

  async function authorize() {
    setAuthorizing(true);
    try {
      const res = await btgApi.authorize();
      window.location.href = res.authorizeUrl;
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha: ${msg}`);
      setAuthorizing(false);
    }
  }

  async function runDiagnostics() {
    setDiagnosing(true);
    try {
      setDiag(await btgApi.diagnostics());
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha no diagnóstico: ${msg}`);
    } finally {
      setDiagnosing(false);
    }
  }

  const consentBadge = config.authorized ? (
    <Badge tone="success">
      {config.authorizedAt
        ? `Autorizado em ${new Date(config.authorizedAt).toLocaleString('pt-BR')}`
        : 'Autorizado'}
    </Badge>
  ) : (
    <Badge tone="warning">Não autorizado</Badge>
  );

  const disabled = !canWrite || !config.hasCredentials || !config.redirectUri;

  return (
    <Section title="Consentimento (Pix/Boleto exigem)" rightSlot={consentBadge}>
      <p className="mb-3 text-xs text-text-muted">
        O BTG obriga o fluxo Authorization Code: sem consentimento, as APIs de boleto/pix não
        funcionam. Cadastre as credenciais e o Redirect URI antes de autorizar.
      </p>
      {canWrite && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            onClick={runDiagnostics}
            loading={diagnosing}
            disabled={!config.hasCredentials}
            title={!config.hasCredentials ? 'Cadastre as credenciais primeiro.' : undefined}
          >
            Diagnosticar conexão
          </Button>
          <Button
            onClick={authorize}
            loading={authorizing}
            disabled={disabled}
            title={
              disabled ? 'Cadastre credenciais e Redirect URI antes de autorizar.' : undefined
            }
          >
            Autorizar conta BTG
          </Button>
        </div>
      )}

      {diag && (
        <div className="mt-4 space-y-3 rounded-md border border-border bg-surface-muted p-3 text-xs">
          <div className="font-semibold text-text">Diagnóstico</div>
          <dl className="grid gap-1 sm:grid-cols-[160px_1fr]">
            <dt className="text-text-muted">Ambiente configurado</dt>
            <dd className="font-mono">{diag.environment}</dd>
            <dt className="text-text-muted">BTG Id (host)</dt>
            <dd className="font-mono break-all">{diag.idBase}</dd>
            <dt className="text-text-muted">client_id enviado</dt>
            <dd className="font-mono break-all">{diag.clientId}</dd>
            <dt className="text-text-muted">redirect_uri</dt>
            <dd className="font-mono break-all">{diag.redirectUri ?? '— (não configurado)'}</dd>
            <dt className="text-text-muted">scopes</dt>
            <dd className="font-mono break-all">{diag.scopes}</dd>
            <dt className="text-text-muted">companyId</dt>
            <dd className="font-mono break-all">{diag.companyId ?? '—'}</dd>
          </dl>

          <div>
            <div className="mb-1 font-semibold text-text">
              Teste do client_id/secret nos dois ambientes (client_credentials)
            </div>
            <p className="mb-2 text-text-muted">
              Valida o app no MESMO registro do BTG Id que o consentimento usa. O ✅ indica em qual
              ambiente o seu app está registrado — o «Ambiente configurado» acima precisa bater com
              ele.
            </p>
            <div className="space-y-1">
              {diag.probes.map((p) => (
                <div key={p.env} className="flex items-center gap-2">
                  <Badge tone={p.ok ? 'success' : 'neutral'}>{p.env}</Badge>
                  <span className="font-mono">HTTP {p.status || '—'}</span>
                  <span className="text-text-muted">{p.hint}</span>
                </div>
              ))}
            </div>
          </div>

          {diag.authorizeUrl && (
            <div>
              <div className="mb-1 font-semibold text-text">URL de consentimento gerada</div>
              <code className="block break-all rounded bg-surface p-2 text-[11px]">
                {diag.authorizeUrl}
              </code>
            </div>
          )}

          <details>
            <summary className="cursor-pointer text-text-muted">Resposta crua do BTG</summary>
            <pre className="mt-2 max-h-60 overflow-auto rounded bg-surface p-2 text-[11px]">
              {JSON.stringify(diag.probes.map((p) => ({ env: p.env, body: p.body })), null, 2)}
            </pre>
          </details>
        </div>
      )}
    </Section>
  );
}

// =============================================================================
// Cobrança (chave Pix, tipo padrão, expiração, multa/juros, autogen)
// =============================================================================
function ChargingCard({
  config,
  canWrite,
  onSaved,
}: {
  config: BtgConfigView;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [pixKey, setPixKey] = useState(config.pixKey ?? '');
  const [defaultChargeKind, setKind] = useState<BtgChargeKind>(config.defaultChargeKind);
  const [expirationDays, setExpiration] = useState(config.expirationDays);
  const [finePercent, setFine] = useState<number | string>(config.finePercent ?? '');
  const [interestPercent, setInterest] = useState<number | string>(config.interestPercent ?? '');
  const [autoGenerate, setAuto] = useState(config.autoGenerate);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPixKey(config.pixKey ?? '');
    setKind(config.defaultChargeKind);
    setExpiration(config.expirationDays);
    setFine(config.finePercent ?? '');
    setInterest(config.interestPercent ?? '');
    setAuto(config.autoGenerate);
  }, [config]);

  async function save() {
    setSaving(true);
    try {
      await btgApi.saveConfig({
        pixKey: pixKey || null,
        defaultChargeKind,
        expirationDays: Number(expirationDays),
        autoGenerate,
        finePercent: finePercent === '' ? null : Number(finePercent),
        interestPercent: interestPercent === '' ? null : Number(interestPercent),
      });
      toast.success('Cobrança salva.');
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Cobrança">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Chave Pix</Label>
          <Input
            value={pixKey}
            onChange={(e) => setPixKey(e.target.value)}
            placeholder="CNPJ, e-mail, telefone ou chave aleatória"
            disabled={!canWrite}
          />
          <FieldHelp>Chave Pix recebedora usada nas cobranças.</FieldHelp>
        </div>
        <div>
          <Label>Tipo padrão de cobrança</Label>
          <div className="flex gap-2">
            <EnvRadio
              label="Boleto"
              description="Boleto registrado"
              active={defaultChargeKind === 'BOLETO'}
              onClick={() => setKind('BOLETO')}
              disabled={!canWrite}
            />
            <EnvRadio
              label="Pix"
              description="Pix cobrança"
              active={defaultChargeKind === 'PIX'}
              onClick={() => setKind('PIX')}
              disabled={!canWrite}
            />
          </div>
        </div>
        <div>
          <Label>Dias para expiração</Label>
          <Input
            type="number"
            min={1}
            max={60}
            value={expirationDays}
            onChange={(e) => setExpiration(Number(e.target.value))}
            disabled={!canWrite}
          />
          <FieldHelp>Validade da cobrança a partir da emissão (1 a 60 dias).</FieldHelp>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Multa (%)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={finePercent}
              onChange={(e) => setFine(e.target.value)}
              placeholder="opcional"
              disabled={!canWrite}
            />
          </div>
          <div>
            <Label>Juros (% a.m.)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={interestPercent}
              onChange={(e) => setInterest(e.target.value)}
              placeholder="opcional"
              disabled={!canWrite}
            />
          </div>
        </div>
        <div>
          <Label>Autogeração</Label>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={autoGenerate}
              onChange={(e) => setAuto(e.target.checked)}
              disabled={!canWrite}
              className="h-4 w-4"
              id="btg-autogen"
            />
            <label htmlFor="btg-autogen" className="text-sm text-text">
              Gerar cobrança automaticamente para faturas novas
            </label>
          </div>
          <FieldHelp>Só roda se o BTG for o gateway BR ativo do tenant.</FieldHelp>
        </div>
      </div>
      {canWrite && (
        <div className="mt-4 flex justify-end">
          <Button onClick={save} loading={saving}>
            Salvar cobrança
          </Button>
        </div>
      )}
    </Section>
  );
}

// =============================================================================
// Webhook
// =============================================================================
function WebhookCard({
  config,
  canWrite,
  onSaved,
}: {
  config: BtgConfigView;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [registering, setRegistering] = useState(false);
  const [copied, setCopied] = useState(false);

  async function register() {
    setRegistering(true);
    try {
      const r = await btgApi.registerWebhook();
      toast.success(`Webhook registrado: ${r.url}`);
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha: ${msg}`);
    } finally {
      setRegistering(false);
    }
  }

  function copy() {
    if (!config.webhookUrl) return;
    void navigator.clipboard?.writeText(config.webhookUrl);
    setCopied(true);
    toast.success('URL copiada.');
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Section
      title="Webhook"
      rightSlot={
        <Badge tone={config.webhookRegistered ? 'success' : 'warning'}>
          {config.webhookRegistered ? 'Registrado' : 'Não registrado'}
        </Badge>
      }
    >
      <p className="mb-3 text-xs text-text-muted">
        URL pública que o BTG chama para notificar liquidação de boleto/Pix.
      </p>
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs">
        <span className="text-text-muted">Webhook</span>
        {config.webhookUrl ? (
          <div className="flex min-w-0 items-center gap-2">
            <code className="truncate font-mono text-text">{config.webhookUrl}</code>
            <Button variant="outline" size="sm" onClick={copy}>
              {copied ? 'Copiado' : 'Copiar'}
            </Button>
          </div>
        ) : (
          <span className="text-amber-700 dark:text-amber-400">
            Base pública não configurada
          </span>
        )}
      </div>
      {canWrite && (
        <div className="mt-4 flex justify-end">
          <Button
            onClick={register}
            loading={registering}
            variant="outline"
            disabled={!config.webhookUrl}
            title={!config.webhookUrl ? 'Configure a base pública antes de registrar.' : undefined}
          >
            Registrar webhook no BTG
          </Button>
        </div>
      )}
    </Section>
  );
}

// =============================================================================
// UI primitives locais
// =============================================================================
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

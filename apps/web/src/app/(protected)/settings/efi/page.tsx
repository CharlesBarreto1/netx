'use client';

/**
 * /settings/efi — configuração de pagamentos EFI/EfiPay do tenant (BR).
 *
 * Seções:
 *   1. Status      — enabled + ambiente (produção/homologação) + badge resumo
 *   2. Credenciais — clientId/secret (write-only) + certificado .p12 (Pix/mTLS)
 *   3. Cobrança    — chave Pix, tipo padrão, expiração, multa/juros, autogeração
 *   4. Webhooks    — URLs públicas (Pix/boleto) + registrar webhook Pix no EFI
 *
 * Save: PUT /v1/efi/config (campos comuns + segredos em base64).
 * Segredos nunca voltam do backend — só a flag de presença (hasCredentials/
 * hasCertificate). Habilitar exige credenciais; Pix exige certificado .p12.
 */
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { FieldHelp, Input, Label } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { efiApi, type EfiChargeKind, type EfiConfigView } from '@/lib/finance-api';
import { hasPermission } from '@/lib/session';

export default function EfiSettingsPage() {
  const canWrite = hasPermission('efi.config.write');
  const { data: config, mutate, isLoading } = useSWR<EfiConfigView>(
    efiApi.configPath(),
    () => efiApi.getConfig(),
  );

  if (isLoading || !config) return <PageLoader />;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Pagamentos — EFI</h1>
        <p className="mt-1 text-sm text-text-muted">
          Configure as credenciais EFI/EfiPay (somente Brasil) para cobrar
          faturas por Pix imediato e boleto híbrido com Pix (Bolix). Cada
          provedor usa a própria conta — os recebíveis caem direto nela.
        </p>
      </header>

      <StatusCard config={config} canWrite={canWrite} onSaved={() => mutate()} />
      <CredentialsCard config={config} canWrite={canWrite} onSaved={() => mutate()} />
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
  config: EfiConfigView;
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
      await efiApi.saveConfig({ enabled, environment });
      toast.success('Status atualizado');
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
          Ativo · {config.environment === 'PRODUCTION' ? 'Produção' : 'Homologação'}
        </Badge>
      );
    }
    return <Badge tone="neutral">Configurado, desativado</Badge>;
  })();

  return (
    <Section title="Status" rightSlot={statusBadge}>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Habilitar EFI</Label>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={!canWrite}
              className="h-4 w-4"
              id="efi-enabled"
            />
            <label htmlFor="efi-enabled" className="text-sm text-text">
              Permitir gerar cobranças EFI por este provedor
            </label>
          </div>
          <FieldHelp>
            Ao habilitar, o sistema exige credenciais configuradas. O Pix imediato
            exige também o certificado .p12.
          </FieldHelp>
        </div>
        <div>
          <Label>Ambiente</Label>
          <div className="flex gap-2">
            <EnvRadio
              label="Homologação"
              description="Sandbox EFI — para testes (pix-h / cobrancas-h)"
              active={environment === 'SANDBOX'}
              onClick={() => setEnvironment('SANDBOX')}
              disabled={!canWrite}
            />
            <EnvRadio
              label="Produção"
              description="Conta real — cobranças válidas"
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
// Credenciais + certificado
// =============================================================================
function CredentialsCard({
  config,
  canWrite,
  onSaved,
}: {
  config: EfiConfigView;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [savingCreds, setSavingCreds] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const [certPwd, setCertPwd] = useState('');
  const [uploadingCert, setUploadingCert] = useState(false);

  async function saveCreds() {
    if (!clientId || !clientSecret) {
      toast.error('Informe Client ID e Client Secret');
      return;
    }
    setSavingCreds(true);
    try {
      await efiApi.saveConfig({ clientId, clientSecret });
      toast.success('Credenciais salvas');
      setClientId('');
      setClientSecret('');
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha: ${msg}`);
    } finally {
      setSavingCreds(false);
    }
  }

  async function uploadCert() {
    const f = fileRef.current?.files?.[0];
    if (!f) {
      toast.error('Selecione o arquivo .p12');
      return;
    }
    setUploadingCert(true);
    try {
      const base64 = await fileToBase64(f);
      await efiApi.saveConfig({
        certificateBase64: base64,
        certificatePassword: certPwd, // EFI normalmente é vazia
      });
      toast.success('Certificado salvo');
      setCertPwd('');
      if (fileRef.current) fileRef.current.value = '';
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha: ${msg}`);
    } finally {
      setUploadingCert(false);
    }
  }

  return (
    <Section
      title="Credenciais e certificado"
      rightSlot={
        <div className="flex gap-2">
          <Badge tone={config.hasCredentials ? 'success' : 'neutral'}>
            {config.hasCredentials ? 'Credenciais OK' : 'Sem credenciais'}
          </Badge>
          <Badge tone={config.hasCertificate ? 'success' : 'neutral'}>
            {config.hasCertificate ? 'Certificado OK' : 'Sem .p12'}
          </Badge>
        </div>
      }
    >
      <p className="mb-3 text-xs text-text-muted">
        Crie uma aplicação no painel EFI (menu API → Criar aplicação) com os
        escopos de cobranças e Pix. Baixe o certificado .p12 da conta — ele é
        exigido pelo Pix (mTLS).
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Client ID</Label>
          <Input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder={config.hasCredentials ? 'manter atual (deixe vazio)' : 'Client_Id_...'}
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
            placeholder={config.hasCredentials ? 'manter atual (deixe vazio)' : 'Client_Secret_...'}
            disabled={!canWrite}
            autoComplete="new-password"
          />
          <FieldHelp>Cifrado AES-256-GCM antes de salvar (KMS_MASTER_KEY).</FieldHelp>
        </div>
      </div>
      {canWrite && (
        <div className="mt-3 flex justify-end">
          <Button onClick={saveCreds} loading={savingCreds}>
            Salvar credenciais
          </Button>
        </div>
      )}

      <hr className="my-5 border-border" />

      <div>
        <h3 className="text-sm font-semibold text-text">Certificado .p12 (Pix / mTLS)</h3>
        <p className="mt-1 text-xs text-text-muted">
          Obrigatório só para Pix imediato. Boleto/Bolix não usa certificado.
        </p>
        {canWrite && (
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <Label>Arquivo .p12</Label>
              <input
                ref={fileRef}
                type="file"
                accept=".p12,application/x-pkcs12"
                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-accent-muted file:px-3 file:py-1.5 file:text-text hover:file:bg-accent-muted/80"
              />
              <FieldHelp>PKCS#12 baixado da conta EFI.</FieldHelp>
            </div>
            <div>
              <Label>Senha do .p12</Label>
              <Input
                type="password"
                value={certPwd}
                onChange={(e) => setCertPwd(e.target.value)}
                placeholder="geralmente vazia no EFI"
                autoComplete="new-password"
              />
            </div>
          </div>
        )}
        {canWrite && (
          <div className="mt-3 flex justify-end">
            <Button onClick={uploadCert} loading={uploadingCert} variant="outline">
              Subir certificado
            </Button>
          </div>
        )}
      </div>
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
  config: EfiConfigView;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [pixKey, setPixKey] = useState(config.pixKey ?? '');
  const [defaultChargeKind, setKind] = useState<EfiChargeKind>(config.defaultChargeKind);
  const [expirationDays, setExpiration] = useState(config.expirationDays);
  const [finePercent, setFine] = useState(config.finePercent ?? '');
  const [interestPercent, setInterest] = useState(config.interestPercent ?? '');
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
      await efiApi.saveConfig({
        pixKey: pixKey || null,
        defaultChargeKind,
        expirationDays: Number(expirationDays),
        autoGenerate,
        finePercent: finePercent === '' ? null : Number(finePercent),
        interestPercent: interestPercent === '' ? null : Number(interestPercent),
      });
      toast.success('Preferências de cobrança salvas');
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
          <Label>Chave Pix recebedora</Label>
          <Input
            value={pixKey}
            onChange={(e) => setPixKey(e.target.value)}
            placeholder="CNPJ, e-mail, telefone ou chave aleatória"
            disabled={!canWrite}
          />
          <FieldHelp>Exigida para gerar Pix imediato.</FieldHelp>
        </div>
        <div>
          <Label>Tipo padrão de cobrança</Label>
          <div className="flex gap-2">
            <EnvRadio
              label="Boleto + Pix"
              description="Bolix — boleto com QR Pix"
              active={defaultChargeKind === 'BOLIX'}
              onClick={() => setKind('BOLIX')}
              disabled={!canWrite}
            />
            <EnvRadio
              label="Pix"
              description="Pix imediato (QR)"
              active={defaultChargeKind === 'PIX'}
              onClick={() => setKind('PIX')}
              disabled={!canWrite}
            />
          </div>
        </div>
        <div>
          <Label>Dias até expirar</Label>
          <Input
            type="number"
            min={1}
            max={60}
            value={expirationDays}
            onChange={(e) => setExpiration(Number(e.target.value))}
            disabled={!canWrite}
          />
          <FieldHelp>Validade do Pix / vencimento do boleto.</FieldHelp>
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
              placeholder="sem multa"
              disabled={!canWrite}
            />
          </div>
          <div>
            <Label>Juros a.m. (%)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={interestPercent}
              onChange={(e) => setInterest(e.target.value)}
              placeholder="sem juros"
              disabled={!canWrite}
            />
          </div>
        </div>
        <div>
          <Label>Geração automática</Label>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={autoGenerate}
              onChange={(e) => setAuto(e.target.checked)}
              disabled={!canWrite}
              className="h-4 w-4"
              id="efi-autogen"
            />
            <label htmlFor="efi-autogen" className="text-sm text-text">
              Emitir cobrança automaticamente para faturas a vencer
            </label>
          </div>
          <FieldHelp>
            Um job emite a cobrança (tipo padrão) para faturas em aberto vencendo
            nos próximos 10 dias.
          </FieldHelp>
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
// Webhooks
// =============================================================================
function WebhookCard({
  config,
  canWrite,
  onSaved,
}: {
  config: EfiConfigView;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [registering, setRegistering] = useState(false);

  async function register() {
    setRegistering(true);
    try {
      const r = await efiApi.registerWebhook();
      toast.success(`Webhook Pix registrado: ${r.url}`);
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha: ${msg}`);
    } finally {
      setRegistering(false);
    }
  }

  return (
    <Section
      title="Webhooks"
      rightSlot={
        <Badge tone={config.pixWebhookRegistered ? 'success' : 'warning'}>
          {config.pixWebhookRegistered ? 'Pix registrado' : 'Pix não registrado'}
        </Badge>
      }
    >
      <p className="mb-3 text-xs text-text-muted">
        O EFI notifica os pagamentos nestas URLs. Cadastre a de boleto no painel
        EFI; a de Pix é registrada automaticamente pelo botão abaixo (exige
        certificado, chave Pix e o servidor com a URL pública configurada).
      </p>
      <div className="space-y-2">
        <UrlRow label="Webhook Pix" url={config.pixWebhookUrl} />
        <UrlRow label="Notificação boleto" url={config.boletoNotificationUrl} />
      </div>
      {canWrite && (
        <div className="mt-4 flex justify-end">
          <Button
            onClick={register}
            loading={registering}
            variant="outline"
            disabled={!config.hasCertificate || !config.pixKey}
            title={
              !config.hasCertificate || !config.pixKey
                ? 'Requer certificado .p12 e chave Pix configurados'
                : undefined
            }
          >
            Registrar webhook Pix no EFI
          </Button>
        </div>
      )}
    </Section>
  );
}

function UrlRow({ label, url }: { label: string; url: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs">
      <span className="text-text-muted">{label}</span>
      {url ? (
        <code className="truncate font-mono text-text">{url}</code>
      ) : (
        <span className="text-amber-700 dark:text-amber-400">
          EFI_PUBLIC_WEBHOOK_BASE não configurada no servidor
        </span>
      )}
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // dataURL → só o base64 (depois da vírgula).
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler arquivo'));
    reader.readAsDataURL(file);
  });
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

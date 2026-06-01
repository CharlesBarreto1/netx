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
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('settings.efi');
  const canWrite = hasPermission('efi.config.write');
  const { data: config, mutate, isLoading } = useSWR<EfiConfigView>(
    efiApi.configPath(),
    () => efiApi.getConfig(),
  );

  if (isLoading || !config) return <PageLoader />;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('description')}</p>
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
  const t = useTranslations('settings.efi');
  const tc = useTranslations('common');
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
      toast.success(t('statusUpdated'));
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`${tc('failure')}: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  const statusBadge = (() => {
    if (!config.hasCredentials) return <Badge tone="neutral">{t('noCredentials')}</Badge>;
    if (config.enabled) {
      return (
        <Badge tone={config.environment === 'PRODUCTION' ? 'success' : 'warning'}>
          {config.environment === 'PRODUCTION' ? t('activeProduction') : t('activeSandbox')}
        </Badge>
      );
    }
    return <Badge tone="neutral">{t('configuredDisabled')}</Badge>;
  })();

  return (
    <Section title={t('statusSection')} rightSlot={statusBadge}>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>{t('enableEfi')}</Label>
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
              {t('enableEfiHelp')}
            </label>
          </div>
          <FieldHelp>{t('enableEfiFieldHelp')}</FieldHelp>
        </div>
        <div>
          <Label>{t('environment')}</Label>
          <div className="flex gap-2">
            <EnvRadio
              label={t('sandboxLabel')}
              description={t('sandboxDescription')}
              active={environment === 'SANDBOX'}
              onClick={() => setEnvironment('SANDBOX')}
              disabled={!canWrite}
            />
            <EnvRadio
              label={t('productionLabel')}
              description={t('productionDescription')}
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
            {t('saveStatus')}
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
  const t = useTranslations('settings.efi');
  const tc = useTranslations('common');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [savingCreds, setSavingCreds] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const [certPwd, setCertPwd] = useState('');
  const [uploadingCert, setUploadingCert] = useState(false);

  async function saveCreds() {
    if (!clientId || !clientSecret) {
      toast.error(t('informCredentials'));
      return;
    }
    setSavingCreds(true);
    try {
      await efiApi.saveConfig({ clientId, clientSecret });
      toast.success(t('credentialsSaved'));
      setClientId('');
      setClientSecret('');
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`${tc('failure')}: ${msg}`);
    } finally {
      setSavingCreds(false);
    }
  }

  async function uploadCert() {
    const f = fileRef.current?.files?.[0];
    if (!f) {
      toast.error(t('selectP12'));
      return;
    }
    setUploadingCert(true);
    try {
      const base64 = await fileToBase64(f);
      await efiApi.saveConfig({
        certificateBase64: base64,
        certificatePassword: certPwd, // EFI normalmente é vazia
      });
      toast.success(t('certificateSaved'));
      setCertPwd('');
      if (fileRef.current) fileRef.current.value = '';
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`${tc('failure')}: ${msg}`);
    } finally {
      setUploadingCert(false);
    }
  }

  return (
    <Section
      title={t('credentialsSection')}
      rightSlot={
        <div className="flex gap-2">
          <Badge tone={config.hasCredentials ? 'success' : 'neutral'}>
            {config.hasCredentials ? t('credentialsOk') : t('noCredentials')}
          </Badge>
          <Badge tone={config.hasCertificate ? 'success' : 'neutral'}>
            {config.hasCertificate ? t('certificateOk') : t('noP12')}
          </Badge>
        </div>
      }
    >
      <p className="mb-3 text-xs text-text-muted">{t('credentialsHelp')}</p>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Client ID</Label>
          <Input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder={config.hasCredentials ? t('keepCurrent') : 'Client_Id_...'}
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
            placeholder={config.hasCredentials ? t('keepCurrent') : 'Client_Secret_...'}
            disabled={!canWrite}
            autoComplete="new-password"
          />
          <FieldHelp>{t('clientSecretHelp')}</FieldHelp>
        </div>
      </div>
      {canWrite && (
        <div className="mt-3 flex justify-end">
          <Button onClick={saveCreds} loading={savingCreds}>
            {t('saveCredentials')}
          </Button>
        </div>
      )}

      <hr className="my-5 border-border" />

      <div>
        <h3 className="text-sm font-semibold text-text">{t('certificateTitle')}</h3>
        <p className="mt-1 text-xs text-text-muted">{t('certificateHelp')}</p>
        {canWrite && (
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <Label>{t('p12File')}</Label>
              <input
                ref={fileRef}
                type="file"
                accept=".p12,application/x-pkcs12"
                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-accent-muted file:px-3 file:py-1.5 file:text-text hover:file:bg-accent-muted/80"
              />
              <FieldHelp>{t('p12FileHelp')}</FieldHelp>
            </div>
            <div>
              <Label>{t('p12Password')}</Label>
              <Input
                type="password"
                value={certPwd}
                onChange={(e) => setCertPwd(e.target.value)}
                placeholder={t('p12PasswordPlaceholder')}
                autoComplete="new-password"
              />
            </div>
          </div>
        )}
        {canWrite && (
          <div className="mt-3 flex justify-end">
            <Button onClick={uploadCert} loading={uploadingCert} variant="outline">
              {t('uploadCertificate')}
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
  const t = useTranslations('settings.efi');
  const tc = useTranslations('common');
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
      toast.success(t('chargingSaved'));
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`${tc('failure')}: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title={t('chargingSection')}>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>{t('pixKey')}</Label>
          <Input
            value={pixKey}
            onChange={(e) => setPixKey(e.target.value)}
            placeholder={t('pixKeyPlaceholder')}
            disabled={!canWrite}
          />
          <FieldHelp>{t('pixKeyHelp')}</FieldHelp>
        </div>
        <div>
          <Label>{t('defaultChargeKind')}</Label>
          <div className="flex gap-2">
            <EnvRadio
              label={t('bolixLabel')}
              description={t('bolixDescription')}
              active={defaultChargeKind === 'BOLIX'}
              onClick={() => setKind('BOLIX')}
              disabled={!canWrite}
            />
            <EnvRadio
              label={t('pixLabel')}
              description={t('pixDescription')}
              active={defaultChargeKind === 'PIX'}
              onClick={() => setKind('PIX')}
              disabled={!canWrite}
            />
          </div>
        </div>
        <div>
          <Label>{t('expirationDays')}</Label>
          <Input
            type="number"
            min={1}
            max={60}
            value={expirationDays}
            onChange={(e) => setExpiration(Number(e.target.value))}
            disabled={!canWrite}
          />
          <FieldHelp>{t('expirationDaysHelp')}</FieldHelp>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>{t('fine')}</Label>
            <Input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={finePercent}
              onChange={(e) => setFine(e.target.value)}
              placeholder={t('finePlaceholder')}
              disabled={!canWrite}
            />
          </div>
          <div>
            <Label>{t('interest')}</Label>
            <Input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={interestPercent}
              onChange={(e) => setInterest(e.target.value)}
              placeholder={t('interestPlaceholder')}
              disabled={!canWrite}
            />
          </div>
        </div>
        <div>
          <Label>{t('autoGenerate')}</Label>
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
              {t('autoGenerateHelp')}
            </label>
          </div>
          <FieldHelp>{t('autoGenerateFieldHelp')}</FieldHelp>
        </div>
      </div>
      {canWrite && (
        <div className="mt-4 flex justify-end">
          <Button onClick={save} loading={saving}>
            {t('saveCharging')}
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
  const t = useTranslations('settings.efi');
  const tc = useTranslations('common');
  const [registering, setRegistering] = useState(false);

  async function register() {
    setRegistering(true);
    try {
      const r = await efiApi.registerWebhook();
      toast.success(t('webhookRegistered', { url: r.url }));
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`${tc('failure')}: ${msg}`);
    } finally {
      setRegistering(false);
    }
  }

  return (
    <Section
      title={t('webhooksSection')}
      rightSlot={
        <Badge tone={config.pixWebhookRegistered ? 'success' : 'warning'}>
          {config.pixWebhookRegistered ? t('pixRegistered') : t('pixNotRegistered')}
        </Badge>
      }
    >
      <p className="mb-3 text-xs text-text-muted">{t('webhooksHelp')}</p>
      <div className="space-y-2">
        <UrlRow label={t('pixWebhook')} url={config.pixWebhookUrl} />
        <UrlRow label={t('boletoNotification')} url={config.boletoNotificationUrl} />
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
                ? t('registerWebhookDisabledHint')
                : undefined
            }
          >
            {t('registerWebhook')}
          </Button>
        </div>
      )}
    </Section>
  );
}

function UrlRow({ label, url }: { label: string; url: string | null }) {
  const t = useTranslations('settings.efi');
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs">
      <span className="text-text-muted">{label}</span>
      {url ? (
        <code className="truncate font-mono text-text">{url}</code>
      ) : (
        <span className="text-amber-700 dark:text-amber-400">
          {t('publicBaseNotConfigured')}
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

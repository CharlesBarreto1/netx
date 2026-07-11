'use client';

/**
 * /settings/tr069 — políticas TR-069 por instância + caixa de adoção.
 *
 * Cada ISP trata a "penetração" do template homologado de forma diferente:
 *   1. Adoção     — aceitar Inform de ONT não cadastrada + adotar pendentes
 *   2. Conformidade — intervalo/janela do reconciliador
 *   3. Rede       — PPPoE/VLAN/IPv6 + puxar do provisionamento de OLT
 *   4. Wi-Fi      — puxar SSID/senha do contrato
 *   5. Acesso     — senha de acesso padrão (write-only) + acesso remoto/porta
 *   6. Firmware   — atualização automática da frota
 *
 * Save: PUT /v1/tr069/config. A senha de acesso nunca volta do backend (só a
 * flag hasAccessPassword). Requer permissão tr069.admin.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { FieldHelp, Input, Label } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  tr069Api,
  type Tr069ConfigView,
  type Tr069PendingDeviceRow,
  type UpsertTr069ConfigBody,
} from '@/lib/provisioning-api';
import { hasPermission } from '@/lib/session';

export default function Tr069SettingsPage() {
  const t = useTranslations('settingsTr069');
  const canWrite = hasPermission('tr069.admin');
  const { data: config, mutate, isLoading } = useSWR<Tr069ConfigView>(
    tr069Api.configPath(),
    () => tr069Api.getConfig(),
  );

  if (isLoading || !config) return <PageLoader />;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('subtitle')}</p>
      </header>

      <AdoptionCard config={config} canWrite={canWrite} onSaved={() => mutate()} />
      <PolicyForm config={config} canWrite={canWrite} onSaved={() => mutate()} />
    </div>
  );
}

// =============================================================================
// Adoção — flag + caixa de pendentes
// =============================================================================
function AdoptionCard({
  config,
  canWrite,
  onSaved,
}: {
  config: Tr069ConfigView;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations('settingsTr069');
  const tCommon = useTranslations('common');
  const [accept, setAccept] = useState(config.acceptUnknownInforms);
  const [saving, setSaving] = useState(false);
  const { data: pending, mutate: mutatePending } = useSWR<Tr069PendingDeviceRow[]>(
    tr069Api.pendingPath(),
    () => tr069Api.listPending(),
    { refreshInterval: 15_000 },
  );

  useEffect(() => setAccept(config.acceptUnknownInforms), [config.acceptUnknownInforms]);

  async function saveFlag() {
    setSaving(true);
    try {
      await tr069Api.saveConfig({ acceptUnknownInforms: accept });
      toast.success(t('adoption.saved'));
      onSaved();
    } catch (err) {
      toast.error(t('adoption.saveError', { error: msgOf(err) }));
    } finally {
      setSaving(false);
    }
  }

  async function adopt(row: Tr069PendingDeviceRow) {
    try {
      await tr069Api.adoptPending(row.id, {});
      toast.success(t('adoption.adopted', { device: row.serialNumber ?? row.deviceId }));
      void mutatePending();
    } catch (err) {
      toast.error(t('adoption.adoptError', { error: msgOf(err) }));
    }
  }

  return (
    <Section
      title={t('adoption.title')}
      rightSlot={
        <Badge tone={config.acceptUnknownInforms ? 'success' : 'neutral'}>
          {config.acceptUnknownInforms ? t('adoption.on') : t('adoption.off')}
        </Badge>
      }
    >
      <Toggle
        id="accept-unknown"
        checked={accept}
        onChange={setAccept}
        disabled={!canWrite}
        label={t('adoption.acceptLabel')}
        help={t('adoption.acceptHelp')}
      />
      {canWrite && (
        <div className="mt-3 flex justify-end">
          <Button onClick={saveFlag} loading={saving} size="sm">
            {tCommon('save')}
          </Button>
        </div>
      )}

      <div className="mt-4">
        <Label>{t('adoption.pendingTitle')}</Label>
        {!pending || pending.length === 0 ? (
          <p className="text-sm text-text-muted">{t('adoption.pendingEmpty')}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-hover text-text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{t('adoption.colDevice')}</th>
                  <th className="px-3 py-2 text-left font-medium">{t('adoption.colManufacturer')}</th>
                  <th className="px-3 py-2 text-left font-medium">{t('adoption.colModel')}</th>
                  <th className="px-3 py-2 text-left font-medium">{t('adoption.colSerial')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('adoption.colInforms')}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {pending.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">{row.deviceId}</td>
                    <td className="px-3 py-2">{row.manufacturer ?? '—'}</td>
                    <td className="px-3 py-2">{row.productClass ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.serialNumber ?? '—'}</td>
                    <td className="px-3 py-2 text-right">{row.informCount}</td>
                    <td className="px-3 py-2 text-right">
                      {canWrite && (
                        <Button size="sm" variant="secondary" onClick={() => adopt(row)}>
                          {t('adoption.adopt')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Section>
  );
}

// =============================================================================
// Demais políticas (um form, um save)
// =============================================================================
function PolicyForm({
  config,
  canWrite,
  onSaved,
}: {
  config: Tr069ConfigView;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations('settingsTr069');
  const [f, setF] = useState<UpsertTr069ConfigBody>({});
  const [accessPassword, setAccessPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [campaigning, setCampaigning] = useState(false);

  // valor efetivo = override local (f) ou o salvo (config)
  const v = <K extends keyof Tr069ConfigView>(k: K): Tr069ConfigView[K] =>
    (f as Record<string, unknown>)[k] !== undefined
      ? ((f as Record<string, unknown>)[k] as Tr069ConfigView[K])
      : config[k];
  const set = (patch: UpsertTr069ConfigBody) => setF((prev) => ({ ...prev, ...patch }));

  async function save() {
    setSaving(true);
    try {
      const body: UpsertTr069ConfigBody = { ...f };
      if (accessPassword) body.accessPassword = accessPassword;
      await tr069Api.saveConfig(body);
      toast.success(t('policies.saved'));
      setF({});
      setAccessPassword('');
      onSaved();
    } catch (err) {
      toast.error(t('policies.saveError', { error: msgOf(err) }));
    } finally {
      setSaving(false);
    }
  }

  async function runCampaign() {
    if (!config.firmwareUrl) {
      toast.error(t('firmware.urlRequired'));
      return;
    }
    if (!window.confirm(t('firmware.confirmCampaign'))) {
      return;
    }
    setCampaigning(true);
    try {
      const r = await tr069Api.firmwareCampaign({});
      toast.success(t('firmware.campaignStarted', { count: r.enqueued }));
    } catch (err) {
      toast.error(t('firmware.campaignError', { error: msgOf(err) }));
    } finally {
      setCampaigning(false);
    }
  }

  return (
    <>
      {/* Conformidade */}
      <Section title={t('compliance.title')}>
        <div className="grid gap-4 md:grid-cols-3">
          <NumField
            label={t('compliance.intervalLabel')}
            help={t('compliance.intervalHelp')}
            value={v('reconcileIntervalMin')}
            onChange={(n) => set({ reconcileIntervalMin: n })}
            disabled={!canWrite}
            min={1}
            max={1440}
          />
          <NumField
            label={t('compliance.windowStartLabel')}
            value={v('reconcileWindowStart')}
            onChange={(n) => set({ reconcileWindowStart: n })}
            disabled={!canWrite}
            min={0}
            max={23}
          />
          <NumField
            label={t('compliance.windowEndLabel')}
            value={v('reconcileWindowEnd')}
            onChange={(n) => set({ reconcileWindowEnd: n })}
            disabled={!canWrite}
            min={0}
            max={23}
          />
        </div>
      </Section>

      {/* Rede */}
      <Section title={t('network.title')}>
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label={t('network.pppoeSourceLabel')}
            value={v('pppoeSource')}
            onChange={(val) => set({ pppoeSource: val as Tr069ConfigView['pppoeSource'] })}
            disabled={!canWrite}
            options={[
              ['CONTRACT', t('network.pppoeSource.contract')],
              ['STATIC', t('network.pppoeSource.static')],
              ['OLT', t('network.pppoeSource.olt')],
            ]}
          />
          <NumField
            label={t('network.defaultVlanLabel')}
            help={t('network.defaultVlanHelp')}
            value={v('defaultVlan')}
            onChange={(n) => set({ defaultVlan: n })}
            disabled={!canWrite}
            min={1}
            max={4094}
          />
          <Toggle
            id="pull-olt"
            checked={!!v('pullFromOltProvisioning')}
            onChange={(b) => set({ pullFromOltProvisioning: b })}
            disabled={!canWrite}
            label={t('network.pullFromOlt')}
          />
          <Toggle
            id="ipv6-enabled"
            checked={!!v('ipv6Enabled')}
            onChange={(b) => set({ ipv6Enabled: b })}
            disabled={!canWrite}
            label={t('network.ipv6Enabled')}
          />
          <SelectField
            label={t('network.ipv6ModeLabel')}
            value={v('ipv6Mode')}
            onChange={(val) => set({ ipv6Mode: val as Tr069ConfigView['ipv6Mode'] })}
            disabled={!canWrite}
            options={[
              ['AUTOCONFIGURED', t('network.ipv6Mode.autoconfigured')],
              ['DHCPV6', 'DHCPv6'],
            ]}
          />
        </div>
      </Section>

      {/* Wi-Fi */}
      <Section title={t('wifi.title')}>
        <div className="grid gap-4 md:grid-cols-2">
          <Toggle
            id="wifi-from-contract"
            checked={!!v('wifiFromContract')}
            onChange={(b) => set({ wifiFromContract: b })}
            disabled={!canWrite}
            label={t('wifi.fromContract')}
            help={t('wifi.fromContractHelp')}
          />
          <div />
          {/* Pacote de otimização Wi-Fi (Huawei) — flags por tenant. As flags
              env do servidor (WIFI_OPT_ENABLED / WIFI_OPT_ROLLOUT_ENABLED)
              também precisam estar ligadas: as duas camadas são AND. */}
          <Toggle
            id="wifi-opt-enabled"
            checked={!!v('wifiOptEnabled')}
            onChange={(b) => set({ wifiOptEnabled: b })}
            disabled={!canWrite}
            label={t('wifiOpt.enabled')}
            help={t('wifiOpt.enabledHelp')}
          />
          <Toggle
            id="wifi-opt-rollout"
            checked={!!v('wifiOptRolloutEnabled')}
            onChange={(b) => set({ wifiOptRolloutEnabled: b })}
            disabled={!canWrite}
            label={t('wifiOpt.rolloutEnabled')}
            help={t('wifiOpt.rolloutEnabledHelp')}
          />
          <div>
            <Label>{t('wifiOpt.regDomainLabel')}</Label>
            <Input
              value={v('wifiOptRegDomain')}
              onChange={(e) => set({ wifiOptRegDomain: e.target.value.toUpperCase() })}
              placeholder="PY"
              maxLength={8}
              disabled={!canWrite}
            />
            <FieldHelp>{t('wifiOpt.regDomainHelp')}</FieldHelp>
          </div>
        </div>
        {/* Regra operacional (v2 vira validação de conflito no update de profile):
            os params do pacote NUNCA podem entrar como regra STATIC de profile. */}
        <div className="mt-4 border-t border-border pt-3">
          <FieldHelp>{t('wifiOpt.operationalRule')}</FieldHelp>
        </div>
      </Section>

      {/* Acesso */}
      <Section
        title={t('access.title')}
        rightSlot={
          config.hasAccessPassword ? (
            <Badge tone="success">{t('access.passwordSet')}</Badge>
          ) : (
            <Badge tone="neutral">{t('access.noPassword')}</Badge>
          )
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>{t('access.passwordLabel')}</Label>
            <Input
              type="password"
              value={accessPassword}
              onChange={(e) => setAccessPassword(e.target.value)}
              placeholder={config.hasAccessPassword ? t('access.passwordPlaceholderKeep') : t('access.passwordPlaceholderSet')}
              disabled={!canWrite}
              autoComplete="new-password"
            />
            <FieldHelp>{t('access.passwordHelp')}</FieldHelp>
          </div>
          <Toggle
            id="apply-access-pwd"
            checked={!!v('applyAccessPassword')}
            onChange={(b) => set({ applyAccessPassword: b })}
            disabled={!canWrite}
            label={t('access.applyPassword')}
          />
          <Toggle
            id="remote-http"
            checked={!!v('remoteHttpEnabled')}
            onChange={(b) => set({ remoteHttpEnabled: b })}
            disabled={!canWrite}
            label={t('access.remoteHttp')}
          />
          <NumField
            label={t('access.remotePortLabel')}
            value={v('remoteHttpPort')}
            onChange={(n) => set({ remoteHttpPort: n })}
            disabled={!canWrite}
            min={1}
            max={65535}
          />
          <SelectField
            label={t('access.remoteModeLabel')}
            value={v('remoteMode')}
            onChange={(val) => set({ remoteMode: val as Tr069ConfigView['remoteMode'] })}
            disabled={!canWrite}
            options={[
              ['LAN_ONLY', t('access.remoteMode.lanOnly')],
              ['LAN_WAN', t('access.remoteMode.lanWan')],
            ]}
          />
        </div>
      </Section>

      {/* Firmware */}
      <Section title={t('firmware.title')}>
        <div className="grid gap-4 md:grid-cols-2">
          <Toggle
            id="fw-auto"
            checked={!!v('firmwareAutoUpdate')}
            onChange={(b) => set({ firmwareAutoUpdate: b })}
            disabled={!canWrite}
            label={t('firmware.autoUpdate')}
          />
          <div />
          <div>
            <Label>{t('firmware.urlLabel')}</Label>
            <Input
              value={(v('firmwareUrl') as string | null) ?? ''}
              onChange={(e) => set({ firmwareUrl: e.target.value || null })}
              placeholder="https://…/firmware.bin"
              disabled={!canWrite}
            />
          </div>
          <div>
            <Label>{t('firmware.targetVersionLabel')}</Label>
            <Input
              value={(v('firmwareTargetVersion') as string | null) ?? ''}
              onChange={(e) => set({ firmwareTargetVersion: e.target.value || null })}
              placeholder={t('firmware.targetVersionPlaceholder')}
              disabled={!canWrite}
            />
          </div>
        </div>
        {canWrite && (
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
            <FieldHelp>{t('firmware.campaignHelp')}</FieldHelp>
            <Button variant="outline" onClick={runCampaign} loading={campaigning}>
              {t('firmware.runCampaign')}
            </Button>
          </div>
        )}
      </Section>

      {canWrite && (
        <div className="flex justify-end">
          <Button onClick={save} loading={saving}>
            {t('policies.save')}
          </Button>
        </div>
      )}
    </>
  );
}

// =============================================================================
// Helpers de UI
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

function Toggle({
  id,
  checked,
  onChange,
  disabled,
  label,
  help,
}: {
  id: string;
  checked: boolean;
  onChange: (b: boolean) => void;
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

function NumField({
  label,
  help,
  value,
  onChange,
  disabled,
  min,
  max,
}: {
  label: string;
  help?: string;
  value: number | null;
  onChange: (n: number | null) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        disabled={disabled}
        min={min}
        max={max}
      />
      {help && <FieldHelp>{help}</FieldHelp>}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  disabled,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  options: Array<[string, string]>;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text disabled:opacity-60"
      >
        {options.map(([val, lbl]) => (
          <option key={val} value={val}>
            {lbl}
          </option>
        ))}
      </select>
    </div>
  );
}

function msgOf(err: unknown): string {
  return err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
}

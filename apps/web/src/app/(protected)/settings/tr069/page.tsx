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
  const canWrite = hasPermission('tr069.admin');
  const { data: config, mutate, isLoading } = useSWR<Tr069ConfigView>(
    tr069Api.configPath(),
    () => tr069Api.getConfig(),
  );

  if (isLoading || !config) return <PageLoader />;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">TR-069 — Políticas da instância</h1>
        <p className="mt-1 text-sm text-text-muted">
          Defina como esta instância trata o template homologado: adoção de ONTs, conformidade,
          rede, Wi-Fi, acesso e firmware.
        </p>
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
      toast.success('Política de adoção salva');
      onSaved();
    } catch (err) {
      toast.error(`Falha: ${msgOf(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function adopt(row: Tr069PendingDeviceRow) {
    try {
      await tr069Api.adoptPending(row.id, {});
      toast.success(`ONT ${row.serialNumber ?? row.deviceId} adotada`);
      void mutatePending();
    } catch (err) {
      toast.error(`Falha ao adotar: ${msgOf(err)}`);
    }
  }

  return (
    <Section
      title="Adoção de ONTs não cadastradas"
      rightSlot={
        <Badge tone={config.acceptUnknownInforms ? 'success' : 'neutral'}>
          {config.acceptUnknownInforms ? 'Ligada' : 'Desligada'}
        </Badge>
      }
    >
      <Toggle
        id="accept-unknown"
        checked={accept}
        onChange={setAccept}
        disabled={!canWrite}
        label="Receber Inform de ONT não cadastrada"
        help="CPE desconhecido entra na caixa de adoção (sem tenant) em vez de ser ignorado. O operador atribui o tenant/contrato ao adotar."
      />
      {canWrite && (
        <div className="mt-3 flex justify-end">
          <Button onClick={saveFlag} loading={saving} size="sm">
            Salvar
          </Button>
        </div>
      )}

      <div className="mt-4">
        <Label>Pendentes de adoção</Label>
        {!pending || pending.length === 0 ? (
          <p className="text-sm text-text-muted">Nenhum CPE aguardando adoção.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-hover text-text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Device</th>
                  <th className="px-3 py-2 text-left font-medium">Fabricante</th>
                  <th className="px-3 py-2 text-left font-medium">Modelo</th>
                  <th className="px-3 py-2 text-left font-medium">Serial</th>
                  <th className="px-3 py-2 text-right font-medium">Informs</th>
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
                          Adotar
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
      toast.success('Políticas salvas');
      setF({});
      setAccessPassword('');
      onSaved();
    } catch (err) {
      toast.error(`Falha: ${msgOf(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function runCampaign() {
    if (!config.firmwareUrl) {
      toast.error('Configure e salve a URL do firmware antes de rodar a campanha');
      return;
    }
    if (!window.confirm('Disparar atualização de firmware para a frota online? Isto enfileira DOWNLOAD em cada CPE.')) {
      return;
    }
    setCampaigning(true);
    try {
      const r = await tr069Api.firmwareCampaign({});
      toast.success(`Campanha disparada: ${r.enqueued} CPE(s) enfileirado(s)`);
    } catch (err) {
      toast.error(`Falha na campanha: ${msgOf(err)}`);
    } finally {
      setCampaigning(false);
    }
  }

  return (
    <>
      {/* Conformidade */}
      <Section title="Conformidade (reconciliador)">
        <div className="grid gap-4 md:grid-cols-3">
          <NumField
            label="Intervalo (min)"
            help="Vazio = padrão do sistema."
            value={v('reconcileIntervalMin')}
            onChange={(n) => set({ reconcileIntervalMin: n })}
            disabled={!canWrite}
            min={1}
            max={1440}
          />
          <NumField
            label="Janela início (hora local)"
            value={v('reconcileWindowStart')}
            onChange={(n) => set({ reconcileWindowStart: n })}
            disabled={!canWrite}
            min={0}
            max={23}
          />
          <NumField
            label="Janela fim (hora local)"
            value={v('reconcileWindowEnd')}
            onChange={(n) => set({ reconcileWindowEnd: n })}
            disabled={!canWrite}
            min={0}
            max={23}
          />
        </div>
      </Section>

      {/* Rede */}
      <Section title="Rede (PPPoE / VLAN / IPv6)">
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label="Origem do PPPoE"
            value={v('pppoeSource')}
            onChange={(val) => set({ pppoeSource: val as Tr069ConfigView['pppoeSource'] })}
            disabled={!canWrite}
            options={[
              ['CONTRACT', 'Do contrato'],
              ['STATIC', 'Fixo (regra STATIC)'],
              ['OLT', 'Do provisionamento de OLT'],
            ]}
          />
          <NumField
            label="VLAN padrão"
            help="Aplicada nas regras de VLAN do PPPoE."
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
            label="Puxar dados do provisionamento de OLT"
          />
          <Toggle
            id="ipv6-enabled"
            checked={!!v('ipv6Enabled')}
            onChange={(b) => set({ ipv6Enabled: b })}
            disabled={!canWrite}
            label="IPv6 ativo"
          />
          <SelectField
            label="Modo do IPv6"
            value={v('ipv6Mode')}
            onChange={(val) => set({ ipv6Mode: val as Tr069ConfigView['ipv6Mode'] })}
            disabled={!canWrite}
            options={[
              ['AUTOCONFIGURED', 'Automático (AutoConfigured)'],
              ['DHCPV6', 'DHCPv6'],
            ]}
          />
        </div>
      </Section>

      {/* Wi-Fi */}
      <Section title="Wi-Fi">
        <Toggle
          id="wifi-from-contract"
          checked={!!v('wifiFromContract')}
          onChange={(b) => set({ wifiFromContract: b })}
          disabled={!canWrite}
          label="Wi-Fi puxa do contrato"
          help="SSID/senha das regras CONTRACT_WIFI_* só são aplicados quando ligado."
        />
      </Section>

      {/* Acesso */}
      <Section
        title="Acesso (senha padrão / acesso remoto)"
        rightSlot={
          config.hasAccessPassword ? (
            <Badge tone="success">Senha definida</Badge>
          ) : (
            <Badge tone="neutral">Sem senha</Badge>
          )
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Senha de acesso padrão</Label>
            <Input
              type="password"
              value={accessPassword}
              onChange={(e) => setAccessPassword(e.target.value)}
              placeholder={config.hasAccessPassword ? '•••••••• (mantém atual)' : 'definir senha'}
              disabled={!canWrite}
              autoComplete="new-password"
            />
            <FieldHelp>Write-only: nunca é exibida. Vazio mantém a atual.</FieldHelp>
          </div>
          <Toggle
            id="apply-access-pwd"
            checked={!!v('applyAccessPassword')}
            onChange={(b) => set({ applyAccessPassword: b })}
            disabled={!canWrite}
            label="Aplicar senha de acesso (root/supervisor/admin)"
          />
          <Toggle
            id="remote-http"
            checked={!!v('remoteHttpEnabled')}
            onChange={(b) => set({ remoteHttpEnabled: b })}
            disabled={!canWrite}
            label="Acesso remoto HTTP ligado"
          />
          <NumField
            label="Porta de acesso remoto"
            value={v('remoteHttpPort')}
            onChange={(n) => set({ remoteHttpPort: n })}
            disabled={!canWrite}
            min={1}
            max={65535}
          />
          <SelectField
            label="Modo de acesso"
            value={v('remoteMode')}
            onChange={(val) => set({ remoteMode: val as Tr069ConfigView['remoteMode'] })}
            disabled={!canWrite}
            options={[
              ['LAN_ONLY', 'Só LAN'],
              ['LAN_WAN', 'LAN + WAN (remoto)'],
            ]}
          />
        </div>
      </Section>

      {/* Firmware */}
      <Section title="Firmware">
        <div className="grid gap-4 md:grid-cols-2">
          <Toggle
            id="fw-auto"
            checked={!!v('firmwareAutoUpdate')}
            onChange={(b) => set({ firmwareAutoUpdate: b })}
            disabled={!canWrite}
            label="Atualizar firmware de toda a frota"
          />
          <div />
          <div>
            <Label>URL do firmware</Label>
            <Input
              value={(v('firmwareUrl') as string | null) ?? ''}
              onChange={(e) => set({ firmwareUrl: e.target.value || null })}
              placeholder="https://…/firmware.bin"
              disabled={!canWrite}
            />
          </div>
          <div>
            <Label>Versão alvo</Label>
            <Input
              value={(v('firmwareTargetVersion') as string | null) ?? ''}
              onChange={(e) => set({ firmwareTargetVersion: e.target.value || null })}
              placeholder="ex.: V5.44(ACHK.4)b3"
              disabled={!canWrite}
            />
          </div>
        </div>
        {canWrite && (
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
            <FieldHelp>
              Usa a URL salva. Pula CPEs já na versão alvo e os com download em curso.
            </FieldHelp>
            <Button variant="outline" onClick={runCampaign} loading={campaigning}>
              Rodar campanha agora
            </Button>
          </div>
        )}
      </Section>

      {canWrite && (
        <div className="flex justify-end">
          <Button onClick={save} loading={saving}>
            Salvar políticas
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

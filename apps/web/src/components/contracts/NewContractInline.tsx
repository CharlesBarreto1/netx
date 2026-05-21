'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import {
  FieldError,
  FieldHelp,
  Input,
  Label,
  Select,
  Textarea,
} from '@/components/ui/Input';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  contractsApi,
  type Contract,
  type ContractAuthMethod,
  type CreateContractInput,
} from '@/lib/contracts-api';
import type { Customer, Paginated } from '@/lib/crm-types';
import { useTenantConfig } from '@/lib/tenant-config';

/**
 * NewContractInline — formulário reusável de criação de contrato.
 *
 * Suporta os 2 métodos de autenticação: PPPoE (default) e IPoE.
 *
 *   PPPoE: usuário/senha (legado, default).
 *   IPoE : circuit-id (DHCP option 82) e/ou MAC, com IP fixo opcional e
 *          VLAN opcional. Pelo menos um identificador (circuit OU MAC).
 *
 * Compartilhado entre `/contracts/new`, fluxos de criar cliente + contrato e
 * conversão de deal.
 */
export interface NewContractInlineProps {
  /** Quando definido, esconde o seletor de cliente e usa esse customerId fixo. */
  lockedCustomerId?: string | null;
  /** Pré-preenchimento opcional. */
  initial?: Partial<{
    monthlyValue: number | string;
    bandwidthMbps: number | string;
    dueDay: number | string;
    code: string;
    notes: string;
    installationAddress: string;
    installationMapsUrl: string;
    pppoeUsername: string;
    pppoePassword: string;
    firstDueDate: string;
  }>;
  submitLabel?: string;
  cancelLabel?: string;
  onCreated: (contract: Contract) => void;
  onCancel?: () => void;
  onSkip?: () => void;
  skipLabel?: string;
}

export function NewContractInline({
  lockedCustomerId,
  initial,
  submitLabel = 'Criar contrato',
  cancelLabel = 'Cancelar',
  onCreated,
  onCancel,
  onSkip,
  skipLabel = 'Pular',
}: NewContractInlineProps) {
  const { currency, currencySymbol } = useTenantConfig();
  const moneyLabel = `${currencySymbol ?? currency}`;

  const customersKey = lockedCustomerId ? null : '/v1/customers?pageSize=100';
  const { data: customersResp, isLoading: loadingCustomers } = useSWR<Paginated<Customer>>(
    customersKey,
  );
  const customers = useMemo(
    () =>
      (customersResp?.data ?? [])
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR')),
    [customersResp],
  );
  const lockedKey = lockedCustomerId ? `/v1/customers/${lockedCustomerId}` : null;
  const { data: lockedCustomer } = useSWR<Customer>(lockedKey);

  // Default IPoE — padrão moderno (FTTH GPON com circuit-id/MAC). PPPoE
  // fica disponível como opt-in pra cenários com BNG legado.
  const [authMethod, setAuthMethod] = useState<ContractAuthMethod>('IPOE');
  // 'ACTIVE' = comercial confirma instalação realizada (fluxo clássico).
  // 'PENDING_INSTALL' = ZTP — técnico vai instalar em campo via
  // /provisioning/install/:contractId. Sem fatura/RADIUS até ativação.
  const [initialStatus, setInitialStatus] = useState<'ACTIVE' | 'PENDING_INSTALL'>('ACTIVE');
  const [form, setForm] = useState({
    customerId: lockedCustomerId ?? '',
    code: initial?.code ?? '',
    // PPPoE
    pppoeUsername: initial?.pppoeUsername ?? '',
    pppoePassword: initial?.pppoePassword ?? '',
    // IPoE
    circuitId: '',
    remoteId: '',
    macAddress: '',
    framedIpAddress: '',
    vlanId: '',
    // Comuns
    installationAddress: initial?.installationAddress ?? '',
    installationMapsUrl: initial?.installationMapsUrl ?? '',
    monthlyValue:
      initial?.monthlyValue !== undefined ? String(initial.monthlyValue) : '',
    bandwidthMbps:
      initial?.bandwidthMbps !== undefined ? String(initial.bandwidthMbps) : '',
    dueDay: initial?.dueDay !== undefined ? String(initial.dueDay) : '10',
    notes: initial?.notes ?? '',
    firstDueDate: initial?.firstDueDate ?? '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (lockedCustomerId) {
      setForm((s) => ({ ...s, customerId: lockedCustomerId }));
    }
  }, [lockedCustomerId]);

  function update<K extends keyof typeof form>(k: K, v: string) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.customerId) e.customerId = 'Selecione um cliente';

    if (authMethod === 'PPPOE') {
      if (!form.pppoeUsername || form.pppoeUsername.length < 3)
        e.pppoeUsername = 'Mínimo 3 caracteres';
      if (form.pppoeUsername && !/^[A-Za-z0-9._-]+$/.test(form.pppoeUsername))
        e.pppoeUsername = 'Use apenas letras, números, . _ -';
      if (!form.pppoePassword || form.pppoePassword.length < 4)
        e.pppoePassword = 'Mínimo 4 caracteres';
    } else {
      // IPoE: pelo menos circuit OU MAC quando vai entrar ACTIVE direto.
      // Em PENDING_INSTALL o técnico vai vincular SN GPON em campo, então
      // os campos de identificação podem ficar vazios.
      if (
        initialStatus === 'ACTIVE' &&
        !form.circuitId.trim() &&
        !form.macAddress.trim()
      ) {
        e.circuitId = 'Informe circuit-id ou MAC (ou marque "Agendar instalação")';
      }
      if (form.macAddress.trim()) {
        const cleaned = form.macAddress.replace(/[^0-9A-Fa-f]/gu, '');
        if (cleaned.length !== 12) e.macAddress = 'MAC inválido (12 hex digits)';
      }
      if (form.framedIpAddress.trim()) {
        // Validação leve — IPv4 ou IPv6 textual.
        if (
          !/^(\d{1,3}\.){3}\d{1,3}$/u.test(form.framedIpAddress.trim()) &&
          !/^[0-9a-fA-F:]+$/u.test(form.framedIpAddress.trim())
        ) {
          e.framedIpAddress = 'IP inválido';
        }
      }
      if (form.vlanId.trim()) {
        const v = Number(form.vlanId);
        if (!Number.isInteger(v) || v < 1 || v > 4094)
          e.vlanId = 'VLAN entre 1 e 4094';
      }
    }

    if (!form.installationAddress || form.installationAddress.length < 5)
      e.installationAddress = 'Informe o endereço de instalação';
    if (form.installationMapsUrl) {
      const normalized = normalizeMapsUrl(form.installationMapsUrl);
      try {
        const u = new URL(normalized);
        if (!/^https?:$/.test(u.protocol)) e.installationMapsUrl = 'Use http(s)://';
      } catch {
        e.installationMapsUrl = 'URL inválida';
      }
    }
    const mv = Number(String(form.monthlyValue).replace(',', '.'));
    if (!Number.isFinite(mv) || mv <= 0) e.monthlyValue = 'Valor inválido';
    const bw = Number(form.bandwidthMbps);
    if (!Number.isInteger(bw) || bw < 1) e.bandwidthMbps = 'Velocidade em Mbps';
    const dd = Number(form.dueDay);
    if (!Number.isInteger(dd) || dd < 1 || dd > 28) e.dueDay = 'Entre 1 e 28';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate() || submitting) return;
    setSubmitting(true);

    const common = {
      customerId: form.customerId,
      code: form.code || undefined,
      installationAddress: form.installationAddress,
      installationMapsUrl: form.installationMapsUrl.trim()
        ? normalizeMapsUrl(form.installationMapsUrl)
        : null,
      monthlyValue: Number(String(form.monthlyValue).replace(',', '.')),
      bandwidthMbps: Number(form.bandwidthMbps),
      dueDay: Number(form.dueDay),
      notes: form.notes || null,
      firstDueDate: form.firstDueDate || undefined,
      initialStatus,
    };

    const payload: CreateContractInput =
      authMethod === 'IPOE'
        ? {
            ...common,
            authMethod: 'IPOE',
            circuitId: form.circuitId.trim() || null,
            remoteId: form.remoteId.trim() || null,
            macAddress: form.macAddress.trim()
              ? normalizeMac(form.macAddress)
              : null,
            framedIpAddress: form.framedIpAddress.trim() || null,
            vlanId: form.vlanId.trim() ? Number(form.vlanId) : null,
          }
        : {
            ...common,
            authMethod: 'PPPOE',
            pppoeUsername: form.pppoeUsername,
            pppoePassword: form.pppoePassword,
          };

    try {
      const created = await contractsApi.create(payload);
      toast.success('Contrato criado');
      onCreated(created);
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha ao criar contrato: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {/* Cliente */}
      {lockedCustomerId ? (
        <div>
          <Label>Cliente</Label>
          <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-text">
            {lockedCustomer?.displayName ?? 'Carregando…'}
            {lockedCustomer?.code ? (
              <span className="ml-2 text-text-muted">· {lockedCustomer.code}</span>
            ) : null}
          </div>
          <FieldHelp>Cliente já vinculado a este contrato.</FieldHelp>
        </div>
      ) : (
        <div>
          <Label htmlFor="contract-customerId" required>
            Cliente
          </Label>
          <Select
            id="contract-customerId"
            value={form.customerId}
            onChange={(e) => update('customerId', e.target.value)}
            disabled={loadingCustomers}
          >
            <option value="">
              {loadingCustomers ? 'Carregando clientes…' : 'Selecione o cliente'}
            </option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
                {c.code ? ` · ${c.code}` : ''}
              </option>
            ))}
          </Select>
          <FieldError>{errors.customerId}</FieldError>
        </div>
      )}

      {/* ─── Tipo de autenticação ─────────────────────────────────────── */}
      <div>
        <Label>Tipo de autenticação</Label>
        <div className="flex gap-2">
          <AuthMethodTab
            label="IPoE"
            description="Circuit-ID / MAC (FTTH GPON — padrão)"
            active={authMethod === 'IPOE'}
            onClick={() => setAuthMethod('IPOE')}
          />
          <AuthMethodTab
            label="PPPoE"
            description="Usuário/senha (legado)"
            active={authMethod === 'PPPOE'}
            onClick={() => setAuthMethod('PPPOE')}
          />
        </div>
      </div>

      {/* ─── Status inicial — clássico vs ZTP ─────────────────────────── */}
      {/* PPPoE não tem fluxo PENDING_INSTALL: usuário/senha já é tudo, não
          tem ONT pra técnico vincular. Toggle só aparece em IPoE. */}
      {authMethod === 'IPOE' && (
        <div>
          <Label>Início do serviço</Label>
          <div className="flex flex-col gap-2 md:flex-row">
            <AuthMethodTab
              label="Ativar agora"
              description="Instalação concluída — gera 1ª fatura + ativa RADIUS"
              active={initialStatus === 'ACTIVE'}
              onClick={() => setInitialStatus('ACTIVE')}
            />
            <AuthMethodTab
              label="Agendar instalação"
              description="Técnico fará a ativação em campo via Provisionamento"
              active={initialStatus === 'PENDING_INSTALL'}
              onClick={() => setInitialStatus('PENDING_INSTALL')}
            />
          </div>
          {initialStatus === 'PENDING_INSTALL' && (
            <FieldHelp>
              Contrato fica em fila de pendentes. Sem fatura e sem RADIUS até
              o técnico ativar via /provisioning/pending. Identificadores
              (circuit-id, MAC) podem ser preenchidos depois.
            </FieldHelp>
          )}
        </div>
      )}

      {authMethod === 'PPPOE' ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="contract-pppoeUsername" required>
              Usuário PPPoE
            </Label>
            <Input
              id="contract-pppoeUsername"
              value={form.pppoeUsername}
              onChange={(e) => update('pppoeUsername', e.target.value)}
              placeholder="ex. joao.silva"
            />
            <FieldError>{errors.pppoeUsername}</FieldError>
          </div>
          <div>
            <Label htmlFor="contract-pppoePassword" required>
              Senha PPPoE
            </Label>
            <Input
              id="contract-pppoePassword"
              value={form.pppoePassword}
              onChange={(e) => update('pppoePassword', e.target.value)}
              placeholder="senha"
            />
            <FieldError>{errors.pppoePassword}</FieldError>
          </div>
        </div>
      ) : (
        <div className="space-y-4 rounded-md border border-dashed border-border p-3">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="contract-circuitId">Circuit-ID</Label>
              <Input
                id="contract-circuitId"
                value={form.circuitId}
                onChange={(e) => update('circuitId', e.target.value)}
                placeholder="ex. 0/1/2:1.1 (Huawei) ou OLT-A/PON1/ONU12"
              />
              <FieldError>{errors.circuitId}</FieldError>
              <FieldHelp>
                Identificador injetado pelo OLT/BNG em DHCP option 82. Formato livre — varia por fabricante.
              </FieldHelp>
            </div>
            <div>
              <Label htmlFor="contract-remoteId">Remote-ID (opcional)</Label>
              <Input
                id="contract-remoteId"
                value={form.remoteId}
                onChange={(e) => update('remoteId', e.target.value)}
                placeholder="ex. OLT-A"
              />
              <FieldHelp>Sub-option 2 — geralmente identifica o switch/OLT.</FieldHelp>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label htmlFor="contract-macAddress">MAC do CPE (fallback)</Label>
              <Input
                id="contract-macAddress"
                value={form.macAddress}
                onChange={(e) => update('macAddress', e.target.value)}
                placeholder="AA:BB:CC:DD:EE:FF"
              />
              <FieldError>{errors.macAddress}</FieldError>
              <FieldHelp>Aceita 12 hex c/ ou sem separador.</FieldHelp>
            </div>
            <div>
              <Label htmlFor="contract-framedIpAddress">IP fixo (opcional)</Label>
              <Input
                id="contract-framedIpAddress"
                value={form.framedIpAddress}
                onChange={(e) => update('framedIpAddress', e.target.value)}
                placeholder="ex. 200.100.50.10"
              />
              <FieldError>{errors.framedIpAddress}</FieldError>
              <FieldHelp>Vai como Framed-IP-Address; senão usa pool dinâmico.</FieldHelp>
            </div>
            <div>
              <Label htmlFor="contract-vlanId">VLAN (opcional)</Label>
              <Input
                id="contract-vlanId"
                type="number"
                min="1"
                max="4094"
                value={form.vlanId}
                onChange={(e) => update('vlanId', e.target.value)}
                placeholder="100"
              />
              <FieldError>{errors.vlanId}</FieldError>
            </div>
          </div>

          <p className="rounded bg-surface-muted px-2 py-1.5 text-xs text-text-muted">
            <strong>Lembrete:</strong> ao menos circuit-id <em>ou</em> MAC é obrigatório. Sem credencial PPPoE.
          </p>
        </div>
      )}

      <div>
        <Label htmlFor="contract-installationAddress" required>
          Endereço de instalação
        </Label>
        <Textarea
          id="contract-installationAddress"
          value={form.installationAddress}
          onChange={(e) => update('installationAddress', e.target.value)}
          placeholder="Rua, nº, bairro, cidade, CEP"
          rows={2}
        />
        <FieldError>{errors.installationAddress}</FieldError>
      </div>

      <div>
        <Label htmlFor="contract-installationMapsUrl">
          Link de localização (Google Maps)
        </Label>
        <Input
          id="contract-installationMapsUrl"
          type="url"
          value={form.installationMapsUrl}
          onChange={(e) => update('installationMapsUrl', e.target.value)}
          placeholder="https://maps.app.goo.gl/…"
        />
        <FieldError>{errors.installationMapsUrl}</FieldError>
        <FieldHelp>
          Cole o link compartilhável do Google Maps (ou qualquer URL pública). Útil pro técnico abrir direto no celular.
        </FieldHelp>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label htmlFor="contract-monthlyValue" required>
            Mensalidade ({moneyLabel})
          </Label>
          <Input
            id="contract-monthlyValue"
            type="number"
            step="0.01"
            min="0"
            value={form.monthlyValue}
            onChange={(e) => update('monthlyValue', e.target.value)}
            placeholder="99.90"
          />
          <FieldError>{errors.monthlyValue}</FieldError>
        </div>
        <div>
          <Label htmlFor="contract-bandwidthMbps" required>
            Velocidade (Mbps)
          </Label>
          <Input
            id="contract-bandwidthMbps"
            type="number"
            min="1"
            value={form.bandwidthMbps}
            onChange={(e) => update('bandwidthMbps', e.target.value)}
            placeholder="500"
          />
          <FieldError>{errors.bandwidthMbps}</FieldError>
        </div>
        <div>
          <Label htmlFor="contract-dueDay" required>
            Dia de vencimento
          </Label>
          <Input
            id="contract-dueDay"
            type="number"
            min="1"
            max="28"
            value={form.dueDay}
            onChange={(e) => update('dueDay', e.target.value)}
          />
          <FieldError>{errors.dueDay}</FieldError>
          <FieldHelp>1 a 28</FieldHelp>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="contract-code">Código do contrato (opcional)</Label>
          <Input
            id="contract-code"
            value={form.code}
            onChange={(e) => update('code', e.target.value)}
            placeholder="ex. CTR-001234"
          />
        </div>
        <div>
          <Label htmlFor="contract-firstDueDate">1ª fatura vence em (opcional)</Label>
          <Input
            id="contract-firstDueDate"
            type="date"
            value={form.firstDueDate}
            onChange={(e) => update('firstDueDate', e.target.value)}
          />
          <FieldHelp>Se vazio, usa o próximo dia de vencimento.</FieldHelp>
        </div>
      </div>

      <div>
        <Label htmlFor="contract-notes">Observações</Label>
        <Textarea
          id="contract-notes"
          value={form.notes}
          onChange={(e) => update('notes', e.target.value)}
          rows={3}
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {onSkip && (
          <Button type="button" variant="ghost" onClick={onSkip} disabled={submitting}>
            {skipLabel}
          </Button>
        )}
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            {cancelLabel}
          </Button>
        )}
        <Button type="submit" loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Tab visual pra alternar PPPoE / IPoE — estilo segmented control. */
function AuthMethodTab({
  label,
  description,
  active,
  onClick,
}: {
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'flex-1 rounded-md border px-3 py-2 text-left transition-colors ' +
        (active
          ? 'border-accent bg-accent-muted text-text'
          : 'border-border bg-surface text-text-muted hover:bg-surface-hover')
      }
    >
      <div className="text-sm font-semibold">{label}</div>
      <div className="text-xs text-text-muted">{description}</div>
    </button>
  );
}

function normalizeMac(raw: string): string {
  const cleaned = raw.replace(/[^0-9A-Fa-f]/gu, '').toUpperCase();
  if (cleaned.length !== 12) return raw;
  return cleaned.match(/.{2}/gu)!.join(':');
}

function normalizeMapsUrl(raw: string): string {
  const v = raw.trim();
  if (!v) return v;
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

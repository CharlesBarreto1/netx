'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import {
  FieldError,
  FieldHelp,
  Input,
  Label,
  Textarea,
} from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  contractsApi,
  type Contract,
  type ContractAuthMethod,
  type UpdateContractInput,
} from '@/lib/contracts-api';
import { useTenantConfig } from '@/lib/tenant-config';

/**
 * EditContractDialog — modal pra atualizar campos do contrato.
 *
 * O que dá pra mexer aqui:
 *  - Método de autenticação (PPPoE ↔ IPoE) — dispara resync no RADIUS.
 *  - Credenciais PPPoE (usuário + senha) — útil pra rotacionar senha.
 *  - Identificadores IPoE: circuit-id, remote-id, MAC, IP fixo, VLAN.
 *  - Comerciais: mensalidade, velocidade, dia de vencimento.
 *  - Endereço de instalação + link de mapa.
 *  - Observações.
 *
 * Cliente, código e status são imutáveis aqui — outras telas cuidam disso.
 */
export interface EditContractDialogProps {
  open: boolean;
  contract: Contract;
  onClose: () => void;
  onUpdated: (next: Contract) => void;
}

export function EditContractDialog({
  open,
  contract,
  onClose,
  onUpdated,
}: EditContractDialogProps) {
  const { currency, currencySymbol } = useTenantConfig();
  const moneyLabel = currencySymbol ?? currency;

  const [authMethod, setAuthMethod] = useState<ContractAuthMethod>(
    contract.authMethod,
  );
  const [form, setForm] = useState({
    pppoeUsername: contract.pppoeUsername ?? '',
    pppoePassword: contract.pppoePassword ?? '',
    circuitId: contract.circuitId ?? '',
    remoteId: contract.remoteId ?? '',
    macAddress: contract.macAddress ?? '',
    framedIpAddress: contract.framedIpAddress ?? '',
    vlanId: contract.vlanId !== null ? String(contract.vlanId) : '',
    monthlyValue: String(contract.monthlyValue),
    bandwidthMbps: String(contract.bandwidthMbps),
    dueDay: String(contract.dueDay),
    installationAddress: contract.installationAddress,
    installationMapsUrl: contract.installationMapsUrl ?? '',
    notes: contract.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Reset state ao abrir/trocar de contrato.
  useEffect(() => {
    if (!open) return;
    setAuthMethod(contract.authMethod);
    setForm({
      pppoeUsername: contract.pppoeUsername ?? '',
      pppoePassword: contract.pppoePassword ?? '',
      circuitId: contract.circuitId ?? '',
      remoteId: contract.remoteId ?? '',
      macAddress: contract.macAddress ?? '',
      framedIpAddress: contract.framedIpAddress ?? '',
      vlanId: contract.vlanId !== null ? String(contract.vlanId) : '',
      monthlyValue: String(contract.monthlyValue),
      bandwidthMbps: String(contract.bandwidthMbps),
      dueDay: String(contract.dueDay),
      installationAddress: contract.installationAddress,
      installationMapsUrl: contract.installationMapsUrl ?? '',
      notes: contract.notes ?? '',
    });
    setErrors({});
  }, [open, contract]);

  function update<K extends keyof typeof form>(k: K, v: string) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (authMethod === 'PPPOE') {
      if (!form.pppoeUsername || form.pppoeUsername.length < 3)
        e.pppoeUsername = 'Mínimo 3 caracteres';
      else if (!/^[A-Za-z0-9._-]+$/.test(form.pppoeUsername))
        e.pppoeUsername = 'Use apenas letras, números, . _ -';
      if (!form.pppoePassword || form.pppoePassword.length < 4)
        e.pppoePassword = 'Mínimo 4 caracteres';
    } else {
      if (!form.circuitId.trim() && !form.macAddress.trim()) {
        e.circuitId = 'Informe circuit-id ou MAC';
      }
      if (form.macAddress.trim()) {
        const cleaned = form.macAddress.replace(/[^0-9A-Fa-f]/gu, '');
        if (cleaned.length !== 12) e.macAddress = 'MAC inválido';
      }
      if (form.framedIpAddress.trim()) {
        const v = form.framedIpAddress.trim();
        if (!/^(\d{1,3}\.){3}\d{1,3}$/u.test(v) && !/^[0-9a-fA-F:]+$/u.test(v))
          e.framedIpAddress = 'IP inválido';
      }
      if (form.vlanId.trim()) {
        const v = Number(form.vlanId);
        if (!Number.isInteger(v) || v < 1 || v > 4094)
          e.vlanId = 'VLAN entre 1 e 4094';
      }
    }

    if (!form.installationAddress || form.installationAddress.length < 5)
      e.installationAddress = 'Informe o endereço';
    if (form.installationMapsUrl) {
      const norm = normalizeMapsUrl(form.installationMapsUrl);
      try {
        const u = new URL(norm);
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

  async function onSubmit() {
    if (!validate() || submitting) return;
    setSubmitting(true);

    // Monta só os campos que diferem do estado atual — backend aceita patch
    // parcial e isso evita disparar resync RADIUS desnecessário.
    const patch: UpdateContractInput = {
      monthlyValue: Number(String(form.monthlyValue).replace(',', '.')),
      bandwidthMbps: Number(form.bandwidthMbps),
      dueDay: Number(form.dueDay),
      installationAddress: form.installationAddress,
      installationMapsUrl: form.installationMapsUrl.trim()
        ? normalizeMapsUrl(form.installationMapsUrl)
        : null,
      notes: form.notes || null,
    };

    if (authMethod !== contract.authMethod) {
      patch.authMethod = authMethod;
    }
    if (authMethod === 'PPPOE') {
      patch.pppoeUsername = form.pppoeUsername;
      patch.pppoePassword = form.pppoePassword;
      // Se mudou pra PPPoE, limpa identificadores IPoE no backend.
      if (contract.authMethod === 'IPOE') {
        patch.circuitId = null;
        patch.remoteId = null;
        patch.macAddress = null;
        patch.framedIpAddress = null;
        patch.vlanId = null;
      }
    } else {
      patch.circuitId = form.circuitId.trim() || null;
      patch.remoteId = form.remoteId.trim() || null;
      patch.macAddress = form.macAddress.trim()
        ? normalizeMac(form.macAddress)
        : null;
      patch.framedIpAddress = form.framedIpAddress.trim() || null;
      patch.vlanId = form.vlanId.trim() ? Number(form.vlanId) : null;
      // Mudou pra IPoE: limpa creds PPPoE.
      if (contract.authMethod === 'PPPOE') {
        patch.pppoeUsername = '';
        patch.pppoePassword = '';
      }
    }

    try {
      const updated = await contractsApi.update(contract.id, patch);
      toast.success('Contrato atualizado');
      onUpdated(updated);
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha ao atualizar: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  const willChangeMethod = authMethod !== contract.authMethod;

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title="Editar contrato"
      description={
        contract.code
          ? `${contract.code} — ${contract.customer?.displayName ?? ''}`
          : (contract.customer?.displayName ?? '')
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {/* Auth method toggle */}
        <div>
          <Label>Tipo de autenticação</Label>
          <div className="flex gap-2">
            <AuthTab
              label="IPoE"
              description="Circuit-ID / MAC"
              active={authMethod === 'IPOE'}
              onClick={() => setAuthMethod('IPOE')}
            />
            <AuthTab
              label="PPPoE"
              description="Usuário/senha"
              active={authMethod === 'PPPOE'}
              onClick={() => setAuthMethod('PPPOE')}
            />
          </div>
          {willChangeMethod && (
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              ⚠ Trocar o método dispara resync no RADIUS. A sessão atual do
              cliente vai cair (CoA disconnect) e ele autentica de novo com a
              nova credencial.
            </p>
          )}
        </div>

        {authMethod === 'PPPOE' ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="edit-pppoeUsername" required>
                Usuário PPPoE
              </Label>
              <Input
                id="edit-pppoeUsername"
                value={form.pppoeUsername}
                onChange={(e) => update('pppoeUsername', e.target.value)}
              />
              <FieldError>{errors.pppoeUsername}</FieldError>
            </div>
            <div>
              <Label htmlFor="edit-pppoePassword" required>
                Senha PPPoE
              </Label>
              <Input
                id="edit-pppoePassword"
                value={form.pppoePassword}
                onChange={(e) => update('pppoePassword', e.target.value)}
              />
              <FieldError>{errors.pppoePassword}</FieldError>
              <FieldHelp>
                Trocar a senha invalida sessões antigas no próximo CoA.
              </FieldHelp>
            </div>
          </div>
        ) : (
          <div className="space-y-4 rounded-md border border-dashed border-border p-3">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="edit-circuitId">Circuit-ID</Label>
                <Input
                  id="edit-circuitId"
                  value={form.circuitId}
                  onChange={(e) => update('circuitId', e.target.value)}
                  placeholder="ex. 0/1/2:1.1"
                />
                <FieldError>{errors.circuitId}</FieldError>
              </div>
              <div>
                <Label htmlFor="edit-remoteId">Remote-ID</Label>
                <Input
                  id="edit-remoteId"
                  value={form.remoteId}
                  onChange={(e) => update('remoteId', e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <Label htmlFor="edit-mac">MAC</Label>
                <Input
                  id="edit-mac"
                  value={form.macAddress}
                  onChange={(e) => update('macAddress', e.target.value)}
                  placeholder="AA:BB:CC:DD:EE:FF"
                />
                <FieldError>{errors.macAddress}</FieldError>
              </div>
              <div>
                <Label htmlFor="edit-framedIp">IP fixo</Label>
                <Input
                  id="edit-framedIp"
                  value={form.framedIpAddress}
                  onChange={(e) => update('framedIpAddress', e.target.value)}
                />
                <FieldError>{errors.framedIpAddress}</FieldError>
              </div>
              <div>
                <Label htmlFor="edit-vlan">VLAN</Label>
                <Input
                  id="edit-vlan"
                  type="number"
                  min="1"
                  max="4094"
                  value={form.vlanId}
                  onChange={(e) => update('vlanId', e.target.value)}
                />
                <FieldError>{errors.vlanId}</FieldError>
              </div>
            </div>
          </div>
        )}

        {/* Comerciais */}
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <Label htmlFor="edit-monthlyValue" required>
              Mensalidade ({moneyLabel})
            </Label>
            <Input
              id="edit-monthlyValue"
              type="number"
              step="0.01"
              min="0"
              value={form.monthlyValue}
              onChange={(e) => update('monthlyValue', e.target.value)}
            />
            <FieldError>{errors.monthlyValue}</FieldError>
            <FieldHelp>
              Faturas já emitidas mantêm o valor antigo.
            </FieldHelp>
          </div>
          <div>
            <Label htmlFor="edit-bandwidthMbps" required>
              Velocidade (Mbps)
            </Label>
            <Input
              id="edit-bandwidthMbps"
              type="number"
              min="1"
              value={form.bandwidthMbps}
              onChange={(e) => update('bandwidthMbps', e.target.value)}
            />
            <FieldError>{errors.bandwidthMbps}</FieldError>
          </div>
          <div>
            <Label htmlFor="edit-dueDay" required>
              Dia de vencimento
            </Label>
            <Input
              id="edit-dueDay"
              type="number"
              min="1"
              max="28"
              value={form.dueDay}
              onChange={(e) => update('dueDay', e.target.value)}
            />
            <FieldError>{errors.dueDay}</FieldError>
          </div>
        </div>

        {/* Endereço */}
        <div>
          <Label htmlFor="edit-installationAddress" required>
            Endereço de instalação
          </Label>
          <Textarea
            id="edit-installationAddress"
            rows={2}
            value={form.installationAddress}
            onChange={(e) => update('installationAddress', e.target.value)}
          />
          <FieldError>{errors.installationAddress}</FieldError>
        </div>
        <div>
          <Label htmlFor="edit-installationMapsUrl">
            Link de localização
          </Label>
          <Input
            id="edit-installationMapsUrl"
            type="url"
            value={form.installationMapsUrl}
            onChange={(e) => update('installationMapsUrl', e.target.value)}
            placeholder="https://maps.app.goo.gl/…"
          />
          <FieldError>{errors.installationMapsUrl}</FieldError>
        </div>

        <div>
          <Label htmlFor="edit-notes">Observações</Label>
          <Textarea
            id="edit-notes"
            rows={3}
            value={form.notes}
            onChange={(e) => update('notes', e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

function AuthTab({
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

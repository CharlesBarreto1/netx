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
import { contractsApi, type Contract } from '@/lib/contracts-api';
import type { Customer, Paginated } from '@/lib/crm-types';
import { useTenantConfig } from '@/lib/tenant-config';

/**
 * NewContractInline — formulário reusável de criação de contrato.
 *
 * Compartilhado entre `/contracts/new` (página dedicada) e os fluxos
 * "criar cliente + contrato" e "converter deal em cliente". Mantém a mesma
 * UX da página dedicada, mas:
 *   - permite travar/ocultar a seleção de cliente (`lockedCustomerId`);
 *   - permite pré-preencher mensalidade (a partir do `value` do deal, p.ex.);
 *   - aceita `onCancel` opcional p/ uso em modal/wizard;
 *   - notifica via `onCreated` em vez de redirecionar.
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
  /** Texto do CTA principal — default "Criar contrato". */
  submitLabel?: string;
  /** Texto do botão secundário — default "Cancelar" (omitido se `onCancel` não for fornecido). */
  cancelLabel?: string;
  onCreated: (contract: Contract) => void;
  onCancel?: () => void;
  /**
   * Mostra também um botão "Pular" para fluxos opcionais (ex.: "criar cliente
   * sem contrato"). Quando clicado, chama `onSkip`.
   */
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
  // Carrega clientes para o Select só quando precisamos (i.e., não está travado).
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

  // Para mostrar o nome do cliente travado, busca o registro.
  const lockedKey = lockedCustomerId ? `/v1/customers/${lockedCustomerId}` : null;
  const { data: lockedCustomer } = useSWR<Customer>(lockedKey);

  const [form, setForm] = useState({
    customerId: lockedCustomerId ?? '',
    code: initial?.code ?? '',
    pppoeUsername: initial?.pppoeUsername ?? '',
    pppoePassword: initial?.pppoePassword ?? '',
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

  // Mantém customerId sincronizado se o pai trocar (ex.: depois do step "criar cliente").
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
    if (!form.pppoeUsername || form.pppoeUsername.length < 3)
      e.pppoeUsername = 'Mínimo 3 caracteres';
    if (form.pppoeUsername && !/^[A-Za-z0-9._-]+$/.test(form.pppoeUsername))
      e.pppoeUsername = 'Use apenas letras, números, . _ -';
    if (!form.pppoePassword || form.pppoePassword.length < 4)
      e.pppoePassword = 'Mínimo 4 caracteres';
    if (!form.installationAddress || form.installationAddress.length < 5)
      e.installationAddress = 'Informe o endereço de instalação';
    if (form.installationMapsUrl) {
      // Aceita URL com ou sem protocolo: se faltar, normalizamos pra https://
      // antes de mandar pro backend (Zod `.url()` exige protocolo). Validamos
      // o resultado aqui pra dar feedback inline em vez de receber 400.
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
    try {
      const created = await contractsApi.create({
        customerId: form.customerId,
        code: form.code || undefined,
        pppoeUsername: form.pppoeUsername,
        pppoePassword: form.pppoePassword,
        installationAddress: form.installationAddress,
        installationMapsUrl: form.installationMapsUrl.trim()
          ? normalizeMapsUrl(form.installationMapsUrl)
          : null,
        monthlyValue: Number(String(form.monthlyValue).replace(',', '.')),
        bandwidthMbps: Number(form.bandwidthMbps),
        dueDay: Number(form.dueDay),
        notes: form.notes || null,
        firstDueDate: form.firstDueDate || undefined,
      });
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

/**
 * Normaliza URL do Google Maps (ou qualquer link público): se o usuário colar
 * `maps.app.goo.gl/abc` sem protocolo, prepend `https://`. O backend usa
 * `z.string().url()`, que exige protocolo — sem essa normalização a UX fica
 * frustrante (erro 400 silencioso no submit).
 */
function normalizeMapsUrl(raw: string): string {
  const v = raw.trim();
  if (!v) return v;
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

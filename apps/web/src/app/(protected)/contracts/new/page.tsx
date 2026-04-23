'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { FieldError, FieldHelp, Input, Label, Select, Textarea } from '@/components/ui/Input';
import { contractsApi } from '@/lib/contracts-api';
import type { Customer, Paginated } from '@/lib/crm-types';
import { ApiError } from '@/lib/api';

/**
 * /contracts/new — form simples de criação de contrato.
 *
 * Pode receber `?customerId=<uuid>` na URL para pré-selecionar um cliente
 * (quando vier do detalhe de cliente).
 */
export default function NewContractPage() {
  const router = useRouter();
  const params = useSearchParams();
  const prefilledCustomerId = params.get('customerId');

  // Carrega clientes para o Select (limite 200 ativos — suficiente p/ MVP).
  const { data: customersResp, isLoading: loadingCustomers } = useSWR<Paginated<Customer>>(
    '/v1/customers?pageSize=200&sortBy=displayName&sortDir=asc',
  );
  const customers = customersResp?.data ?? [];

  const [form, setForm] = useState({
    customerId: prefilledCustomerId ?? '',
    code: '',
    pppoeUsername: '',
    pppoePassword: '',
    installationAddress: '',
    monthlyValue: '',
    bandwidthMbps: '',
    dueDay: '10',
    notes: '',
    firstDueDate: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (prefilledCustomerId) {
      setForm((s) => ({ ...s, customerId: prefilledCustomerId }));
    }
  }, [prefilledCustomerId]);

  function update<K extends keyof typeof form>(k: K, v: string) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.customerId) e.customerId = 'Selecione um cliente';
    if (!form.pppoeUsername || form.pppoeUsername.length < 3)
      e.pppoeUsername = 'Mínimo 3 caracteres';
    if (!/^[A-Za-z0-9._-]+$/.test(form.pppoeUsername || ''))
      e.pppoeUsername = 'Use apenas letras, números, . _ -';
    if (!form.pppoePassword || form.pppoePassword.length < 4) e.pppoePassword = 'Mínimo 4 caracteres';
    if (!form.installationAddress || form.installationAddress.length < 5)
      e.installationAddress = 'Informe o endereço de instalação';
    const mv = Number(form.monthlyValue);
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
        monthlyValue: Number(form.monthlyValue),
        bandwidthMbps: Number(form.bandwidthMbps),
        dueDay: Number(form.dueDay),
        notes: form.notes || null,
        firstDueDate: form.firstDueDate || undefined,
      });
      toast.success('Contrato criado');
      router.push(`/contracts/${created.id}`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha ao criar contrato: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/contracts" className="text-xs text-text-muted hover:text-text">
          ← Contratos
        </Link>
      </div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-text">Novo contrato</h1>
        <p className="text-xs text-text-muted">
          Ao criar, geramos a 1ª fatura automaticamente e registramos a autorização no RADIUS.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-5 rounded-md border border-border bg-surface p-4">
        {/* Cliente */}
        <div>
          <Label htmlFor="customerId" required>
            Cliente
          </Label>
          <Select
            id="customerId"
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

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="pppoeUsername" required>
              Usuário PPPoE
            </Label>
            <Input
              id="pppoeUsername"
              value={form.pppoeUsername}
              onChange={(e) => update('pppoeUsername', e.target.value)}
              placeholder="ex. joao.silva"
            />
            <FieldError>{errors.pppoeUsername}</FieldError>
          </div>
          <div>
            <Label htmlFor="pppoePassword" required>
              Senha PPPoE
            </Label>
            <Input
              id="pppoePassword"
              value={form.pppoePassword}
              onChange={(e) => update('pppoePassword', e.target.value)}
              placeholder="senha"
            />
            <FieldError>{errors.pppoePassword}</FieldError>
          </div>
        </div>

        <div>
          <Label htmlFor="installationAddress" required>
            Endereço de instalação
          </Label>
          <Textarea
            id="installationAddress"
            value={form.installationAddress}
            onChange={(e) => update('installationAddress', e.target.value)}
            placeholder="Rua, nº, bairro, cidade, CEP"
            rows={2}
          />
          <FieldError>{errors.installationAddress}</FieldError>
          <FieldHelp>
            Por enquanto texto livre. Será vinculado ao endereço do cliente numa próxima versão.
          </FieldHelp>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <Label htmlFor="monthlyValue" required>
              Mensalidade (R$)
            </Label>
            <Input
              id="monthlyValue"
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
            <Label htmlFor="bandwidthMbps" required>
              Velocidade (Mbps)
            </Label>
            <Input
              id="bandwidthMbps"
              type="number"
              min="1"
              value={form.bandwidthMbps}
              onChange={(e) => update('bandwidthMbps', e.target.value)}
              placeholder="500"
            />
            <FieldError>{errors.bandwidthMbps}</FieldError>
          </div>
          <div>
            <Label htmlFor="dueDay" required>
              Dia de vencimento
            </Label>
            <Input
              id="dueDay"
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
            <Label htmlFor="code">Código do contrato (opcional)</Label>
            <Input
              id="code"
              value={form.code}
              onChange={(e) => update('code', e.target.value)}
              placeholder="ex. CTR-001234"
            />
          </div>
          <div>
            <Label htmlFor="firstDueDate">1ª fatura vence em (opcional)</Label>
            <Input
              id="firstDueDate"
              type="date"
              value={form.firstDueDate}
              onChange={(e) => update('firstDueDate', e.target.value)}
            />
            <FieldHelp>Se vazio, usa o próximo dia de vencimento.</FieldHelp>
          </div>
        </div>

        <div>
          <Label htmlFor="notes">Observações</Label>
          <Textarea
            id="notes"
            value={form.notes}
            onChange={(e) => update('notes', e.target.value)}
            rows={3}
          />
        </div>

        <div className="flex gap-2">
          <Button type="submit" loading={submitting}>
            Criar contrato
          </Button>
          <Link href="/contracts">
            <Button type="button" variant="outline">
              Cancelar
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}

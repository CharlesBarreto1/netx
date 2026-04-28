'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldError, FieldHelp, Input, Label, Select } from '@/components/ui/Input';
import { toast } from '@/components/ui/sonner';
import { dealsApi, type CreateDealInput } from '@/lib/crm-sales-api';
import type { Pipeline } from '@/lib/crm-sales-types';
import type { Customer, Paginated } from '@/lib/crm-types';
import { ApiError } from '@/lib/api';
import { useTenantConfig } from '@/lib/tenant-config';

/**
 * NewDealDialog — modal de criação rápida de deal.
 *
 * Mantém propositalmente os campos mínimos (título, valor, estágio inicial,
 * cliente opcional). Edição completa fica na tela de detalhe do deal.
 */
export function NewDealDialog({
  open,
  onOpenChange,
  pipeline,
  defaultStageId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pipeline: Pipeline | null;
  defaultStageId?: string | null;
  onCreated: () => void;
}) {
  const { currency: tenantCurrency } = useTenantConfig();

  const [title, setTitle] = useState('');
  const [value, setValue] = useState<string>(''); // string p/ aceitar input vazio
  const [currency, setCurrency] = useState(tenantCurrency);
  const [stageId, setStageId] = useState<string>('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state quando o dialog abre/fecha ou o estágio default muda.
  useEffect(() => {
    if (open) {
      setTitle('');
      setValue('');
      setCurrency(tenantCurrency);
      setStageId(defaultStageId ?? pipeline?.stages[0]?.id ?? '');
      setCustomerSearch('');
      setCustomerId(null);
      setError(null);
    }
  }, [open, defaultStageId, pipeline, tenantCurrency]);

  // Busca de clientes — só dispara se digitar 2+ chars.
  const customerKey =
    open && customerSearch.trim().length >= 2
      ? `/v1/customers?search=${encodeURIComponent(customerSearch.trim())}&pageSize=8`
      : null;
  const { data: customerHits } = useSWR<Paginated<Customer>>(customerKey);
  const customerOptions = customerHits?.data ?? [];

  const stages = useMemo(() => pipeline?.stages ?? [], [pipeline]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pipeline) return;
    if (!title.trim()) {
      setError('Informe um título');
      return;
    }
    if (!stageId) {
      setError('Selecione um estágio');
      return;
    }

    setSubmitting(true);
    setError(null);
    const payload: CreateDealInput = {
      pipelineId: pipeline.id,
      stageId,
      title: title.trim(),
      currency,
    };
    const num = Number(value.replace(',', '.'));
    if (Number.isFinite(num) && num > 0) payload.value = num;
    if (customerId) payload.customerId = customerId;

    try {
      await dealsApi.create(payload);
      toast.success('Deal criado');
      onCreated();
      onOpenChange(false);
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.friendlyMessage : 'Falha ao criar deal';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Novo deal</DialogTitle>
            <DialogDescription>
              Pipeline: <span className="font-medium text-text">{pipeline?.name ?? '—'}</span>
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="flex flex-col gap-3">
            <div>
              <Label htmlFor="deal-title" required>
                Título
              </Label>
              <Input
                id="deal-title"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Plano Fibra 600 Mbps — João Silva"
                maxLength={255}
              />
            </div>

            <div className="grid grid-cols-[1fr,80px] gap-2">
              <div>
                <Label htmlFor="deal-value">Valor</Label>
                <Input
                  id="deal-value"
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="0,00"
                />
              </div>
              <div>
                <Label htmlFor="deal-currency">Moeda</Label>
                <Select
                  id="deal-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  <option value="BRL">BRL</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="ARS">ARS</option>
                  <option value="PYG">PYG</option>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="deal-stage" required>
                Estágio inicial
              </Label>
              <Select
                id="deal-stage"
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="deal-customer">Cliente (opcional)</Label>
              <Input
                id="deal-customer"
                placeholder="Buscar por nome…"
                value={customerSearch}
                onChange={(e) => {
                  setCustomerSearch(e.target.value);
                  setCustomerId(null);
                }}
              />
              {customerSearch.trim().length >= 2 && (
                <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-surface">
                  {customerOptions.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-text-subtle">
                      Nenhum cliente encontrado
                    </div>
                  ) : (
                    customerOptions.map((c) => (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => {
                          setCustomerId(c.id);
                          setCustomerSearch(c.displayName);
                        }}
                        className={
                          'flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface-hover ' +
                          (customerId === c.id ? 'bg-accent-muted text-accent' : 'text-text')
                        }
                      >
                        <span className="truncate">{c.displayName}</span>
                        <span className="shrink-0 text-2xs text-text-subtle">
                          {c.primaryEmail ?? c.primaryPhone ?? ''}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
              <FieldHelp>Você pode associar/alterar o cliente depois.</FieldHelp>
            </div>

            {error && <FieldError>{error}</FieldError>}
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={submitting}>
              Criar deal
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

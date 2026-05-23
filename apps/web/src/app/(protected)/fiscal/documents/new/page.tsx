'use client';

/**
 * /fiscal/documents/new — emissão manual de DTE.
 *
 * Fluxo:
 *   1. Operador escolhe tipo (FACTURA, NOTA_CREDITO, etc).
 *   2. Escolhe origem: ContractInvoice OPEN/PAID (busca por código/cliente).
 *   3. Confirma → POST /v1/sifen/documents → redirect pra detalhe.
 *
 * Pra NC/ND, opcionalmente informa CDC do documento original (não persiste
 * aqui — backend valida obrigatoriedade durante xmlgen).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { FieldError, FieldHelp, Input, Label, Textarea } from '@/components/ui/Input';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  contractInvoicesApi,
  type ContractInvoice,
} from '@/lib/contracts-api';
import { sifenApi, type SifenDocumentType } from '@/lib/sifen-api';
import { useFormatMoney } from '@/lib/use-money';

const TYPE_OPTIONS: Array<{ value: SifenDocumentType; label: string; help: string }> = [
  { value: 'FACTURA', label: 'Factura (1)', help: 'Venda de serviço — mais comum' },
  { value: 'NOTA_CREDITO', label: 'Nota de Crédito (5)', help: 'Devolução / desconto pós-emissão; exige CDC associado' },
  { value: 'NOTA_DEBITO', label: 'Nota de Débito (6)', help: 'Cobrança adicional; exige CDC associado' },
  { value: 'AUTOFACTURA', label: 'Autofactura (4)', help: 'Compra de serviço de contribuyente sem timbrado' },
  { value: 'NOTA_REMISION', label: 'Nota de Remisión (7)', help: 'Transporte de mercadoria' },
];

export default function NewFiscalDocumentPage() {
  const router = useRouter();
  const formatMoney = useFormatMoney();

  const [type, setType] = useState<SifenDocumentType>('FACTURA');
  const [search, setSearch] = useState('');
  const [invoices, setInvoices] = useState<ContractInvoice[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<ContractInvoice | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Busca lazy de faturas OPEN/PAID (debounce simples).
  useEffect(() => {
    if (!search || search.length < 2) {
      setInvoices([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await contractInvoicesApi.list({
          page: 1,
          pageSize: 20,
          status: 'OPEN',
        });
        if (!cancelled) {
          // Filtra client-side por código/customer (back não tem search aqui).
          const q = search.toLowerCase();
          setInvoices(
            res.data.filter((inv) =>
              (inv.reference ?? '').toLowerCase().includes(q) ||
              (inv.contract?.code ?? '').toLowerCase().includes(q) ||
              (inv.contract?.pppoeUsername ?? '').toLowerCase().includes(q) ||
              inv.id.toLowerCase().includes(q),
            ),
          );
        }
      } catch {
        if (!cancelled) setInvoices([]);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search]);

  async function submit() {
    const e: Record<string, string> = {};
    if (!selectedInvoice) e.invoice = 'Selecione uma fatura';
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setSubmitting(true);
    try {
      const doc = await sifenApi.emit({
        type,
        contractInvoiceId: selectedInvoice!.id,
        note: note || undefined,
      });
      toast.success(
        doc.status === 'APPROVED'
          ? 'DTE emitido e aprovado pelo SET'
          : `DTE criado com status ${doc.status}`,
      );
      router.push(`/fiscal/documents/${doc.id}`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha: ${msg}`);
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <Link href="/fiscal/documents" className="text-xs text-brand-500 hover:underline">
          ← Documentos fiscais
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Nova emissão</h1>
        <p className="text-sm text-text-muted">
          Emita um DTE SIFEN a partir de uma fatura do contrato. O sistema
          gera o XML, assina com o .p12 do tenant, embute o QR e envia ao SET.
        </p>
      </header>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <Label>Tipo de documento</Label>
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setType(opt.value)}
              aria-pressed={type === opt.value}
              className={
                'rounded-md border px-3 py-2 text-left transition-colors ' +
                (type === opt.value
                  ? 'border-accent bg-accent-muted text-text'
                  : 'border-border bg-surface text-text-muted hover:bg-surface-hover')
              }
            >
              <div className="text-sm font-semibold">{opt.label}</div>
              <div className="text-xs text-text-muted">{opt.help}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <Label>Origem — fatura do contrato</Label>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por código, cliente, PPPoE, referência…"
        />
        <FieldError>{errors.invoice}</FieldError>

        {selectedInvoice && (
          <div className="mt-2 rounded-md border border-accent bg-accent-muted p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium text-text">
                  {selectedInvoice.reference ?? `Fatura ${selectedInvoice.id.slice(0, 8)}`}
                </div>
                <div className="text-xs text-text-muted">
                  Contrato {selectedInvoice.contract?.code ?? '—'} ·{' '}
                  Vence {selectedInvoice.dueDate}
                </div>
              </div>
              <div className="text-right">
                <div className="text-text">{formatMoney(selectedInvoice.amount)}</div>
                <button
                  type="button"
                  className="text-xs text-rose-500 hover:underline"
                  onClick={() => setSelectedInvoice(null)}
                >
                  remover
                </button>
              </div>
            </div>
          </div>
        )}

        {!selectedInvoice && invoices.length > 0 && (
          <ul className="mt-2 max-h-72 overflow-y-auto rounded-md border border-border bg-surface text-sm">
            {invoices.map((inv) => (
              <li
                key={inv.id}
                className="flex cursor-pointer items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-0 hover:bg-surface-hover"
                onClick={() => {
                  setSelectedInvoice(inv);
                  setSearch('');
                  setInvoices([]);
                }}
              >
                <div>
                  <div className="text-text">{inv.reference ?? `Fatura ${inv.id.slice(0, 8)}`}</div>
                  <div className="text-xs text-text-muted">
                    {inv.contract?.code ?? '—'} · vence {inv.dueDate}
                  </div>
                </div>
                <div className="text-text">{formatMoney(inv.amount)}</div>
              </li>
            ))}
          </ul>
        )}
        {!selectedInvoice && search.length >= 2 && invoices.length === 0 && (
          <FieldHelp>Nenhuma fatura OPEN encontrada com esse texto.</FieldHelp>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <Label>Observação (opcional)</Label>
        <Textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anotação interna — não vai pro SET"
        />
      </section>

      <div className="flex justify-end gap-2">
        <Link href="/fiscal/documents">
          <Button variant="ghost">Cancelar</Button>
        </Link>
        <Button onClick={submit} loading={submitting} disabled={!selectedInvoice}>
          Emitir DTE
        </Button>
      </div>
    </div>
  );
}

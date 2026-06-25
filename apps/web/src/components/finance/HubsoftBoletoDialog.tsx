'use client';

/**
 * Reimpressão do boleto/Pix JÁ gerado no sistema de origem (ex.: Hubsoft),
 * importado na fatura. NÃO gera nova cobrança bancária — apenas reexibe o
 * documento existente (PDF, linha digitável, Pix copia-e-cola). O pagamento
 * baixa nos dois sistemas via o sync do legado (status pago → NetX).
 */
import { Check, Copy, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

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
import type { ContractInvoice } from '@/lib/contracts-api';

export function HubsoftBoletoDialog({
  invoice,
  open,
  onOpenChange,
}: {
  invoice: ContractInvoice;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const source = invoice.extSource ?? 'origem';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reimprimir boleto / Pix</DialogTitle>
          <DialogDescription>
            Documento já gerado no {source}. Reimpressão — não gera nova cobrança no NetX. O
            pagamento é reconciliado pelo sync.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3">
          {invoice.extBoletoUrl && (
            <a href={invoice.extBoletoUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="primary" className="w-full">
                <ExternalLink className="mr-1.5 h-4 w-4" /> Abrir boleto (PDF)
              </Button>
            </a>
          )}

          <CopyRow label="Linha digitável" value={invoice.extDigitableLine} mono />
          <CopyRow label="Código de barras" value={invoice.extBarcode} mono />
          <CopyRow label="Pix copia-e-cola" value={invoice.extPixCode} />

          {!invoice.extBoletoUrl &&
            !invoice.extDigitableLine &&
            !invoice.extBarcode &&
            !invoice.extPixCode && (
              <p className="rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-text-muted">
                Esta fatura não trouxe boleto/Pix do {source}. Reimporte o financeiro do cliente
                para atualizar.
              </p>
            )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyRow({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value!);
      setCopied(true);
      toast.success(`${label} copiado`);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Não foi possível copiar');
    }
  }

  return (
    <div>
      <div className="mb-1 text-xs font-medium text-text-muted">{label}</div>
      <div className="flex items-center gap-2">
        <code
          className={
            'min-w-0 flex-1 truncate rounded-md border border-border bg-surface-muted px-2 py-1.5 text-xs text-text ' +
            (mono ? 'font-mono' : '')
          }
        >
          {value}
        </code>
        <Button variant="ghost" size="sm" onClick={copy} aria-label={`Copiar ${label}`}>
          {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

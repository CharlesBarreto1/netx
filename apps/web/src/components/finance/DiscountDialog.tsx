'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldHelp, Input, Label, Textarea } from '@/components/ui/Input';
import { ApiError } from '@/lib/api';

/**
 * DiscountDialog — define/atualiza desconto antes do pagamento.
 *
 * Persiste em ContractInvoice.discountAmount sem mudar status. Quando o
 * atendente abrir "Dar baixa", o PaymentDialog já mostra esse valor como
 * default no campo desconto.
 *
 * Passar 0 zera o desconto.
 */
export interface DiscountDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  amount: number;
  currentDiscount: number | null;
  description?: string;
  onConfirm: (discountAmount: number, note?: string) => Promise<void>;
}

export function DiscountDialog({
  open,
  onOpenChange,
  amount,
  currentDiscount,
  description,
  onConfirm,
}: DiscountDialogProps) {
  const [discount, setDiscount] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDiscount(currentDiscount ? String(currentDiscount) : '');
      setNote('');
      setError(null);
    }
  }, [open, currentDiscount]);

  const value = Number(discount.replace(',', '.'));
  const isValid = Number.isFinite(value) && value >= 0 && value <= amount;
  const net = Math.max(0, amount - (Number.isFinite(value) ? value : 0));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) {
      setError('Descuento inválido');
      return;
    }
    setSubmitting(true);
    try {
      await onConfirm(value, note.trim() || undefined);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : 'Error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Aplicar descuento</DialogTitle>
            {description && (
              <p className="mt-1 text-xs text-text-muted">{description}</p>
            )}
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="rounded-md bg-surface-muted p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-text-muted">Valor original</span>
                <span className="font-semibold tabular-nums">{amount.toFixed(2)}</span>
              </div>
              <div className="mt-1 flex justify-between border-t border-border pt-1">
                <span className="text-text-muted">Total a recibir</span>
                <span className="font-semibold tabular-nums">{net.toFixed(2)}</span>
              </div>
            </div>
            <div>
              <Label htmlFor="discount-value" required>
                Valor del descuento
              </Label>
              <Input
                id="discount-value"
                inputMode="decimal"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                placeholder="0,00"
                autoFocus
              />
              <FieldHelp>
                Pasá 0 para quitar el descuento. No puede superar el valor de la
                factura.
              </FieldHelp>
            </div>
            <div>
              <Label htmlFor="discount-note">Motivo (opcional)</Label>
              <Textarea
                id="discount-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ej.: cliente pagó adelantado, política de fidelidad…"
              />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
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
            <Button type="submit" loading={submitting} disabled={!isValid}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

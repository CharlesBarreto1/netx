'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
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
  cashRegistersApi,
  type CashRegister,
  type PayPaymentInput,
  type PaymentMethod,
} from '@/lib/finance-api';
import { hasPermission } from '@/lib/session';

const METHOD_OPTIONS: PaymentMethod[] = [
  'CASH',
  'PIX',
  'CARD',
  'BANK_TRANSFER',
  'OTHER',
];

/**
 * PaymentDialog — modal único usado pra dar baixa em qualquer cobrança
 * (fatura ou cobrança avulsa).
 *
 * O caller passa:
 *   - amount: valor base da cobrança (pra mostrar no header e default do paid).
 *   - onConfirm: callback recebe `PayPaymentInput` parcial. Caller faz o
 *     POST /pay (separa contractInvoicesApi.pay vs chargesApi.pay).
 *
 * O componente cuida de:
 *   - Carregar lista de caixas que o user opera.
 *   - Validar discount > 0 contra perm `finance.discount.apply` (esconde input
 *     se user não tem perm).
 *   - Calcular `paidAmount = amount - discount` automaticamente.
 */
export interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Valor original da cobrança/fatura. */
  amount: number;
  /** Currency pra rótulo. */
  currency?: string;
  /** Header descritivo (ex.: "Mensalidade · Outubro 2025"). */
  description?: string;
  onConfirm: (input: PayPaymentInput) => Promise<void>;
  /** Default = "Confirmar pagamento". */
  confirmLabel?: string;
  /** Desconto já persistido na fatura (POST /discount prévio). Pré-preenche. */
  initialDiscount?: number | null;
}

export function PaymentDialog({
  open,
  onOpenChange,
  amount,
  description,
  onConfirm,
  confirmLabel,
  initialDiscount,
}: PaymentDialogProps) {
  const tFinance = useTranslations('finance.payment');
  const tMethod = useTranslations('finance.paymentMethod');
  const tCommon = useTranslations('common');
  const canDiscount = hasPermission('finance.discount.apply');

  // Caixas visíveis pelo user (membership ou admin).
  const { data: registers } = useSWR<CashRegister[]>(
    open ? cashRegistersApi.listPath() : null,
  );

  const [cashRegisterId, setCashRegisterId] = useState<string>('');
  const [paidVia, setPaidVia] = useState<PaymentMethod>('CASH');
  const [discountAmount, setDiscountAmount] = useState<string>('');
  const [paidAt, setPaidAt] = useState<string>(''); // YYYY-MM-DDTHH:MM
  const [note, setNote] = useState('');
  const [zeroPaidConfirmed, setZeroPaidConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset quando abre. Auto-seleciona se há só 1 caixa — fluxo mais comum em
  // operações pequenas, evita 1 clique sem perda de visibilidade (o caixa
  // continua mostrado no select). Se a fatura tem desconto prévio gravado,
  // pré-preenche pra que o atendente veja e possa ajustar.
  useEffect(() => {
    if (open) {
      setCashRegisterId('');
      setPaidVia('CASH');
      setDiscountAmount(
        initialDiscount && initialDiscount > 0 ? String(initialDiscount) : '',
      );
      setPaidAt('');
      setNote('');
      setZeroPaidConfirmed(false);
      setError(null);
    }
  }, [open, initialDiscount]);

  useEffect(() => {
    if (open && registers && registers.length === 1 && !cashRegisterId) {
      setCashRegisterId(registers[0].id);
    }
  }, [open, registers, cashRegisterId]);

  const discountNum = useMemo(() => {
    const n = Number(discountAmount.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [discountAmount]);
  const paidAmount = Math.max(0, amount - discountNum);
  // Desconto cobre 100% do valor: nada entra no caixa. Exige confirmação
  // explícita (checkbox) — o backend rejeita sem `confirmZeroPaid`.
  const isZeroPaid = amount > 0 && discountNum >= amount;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (discountNum > amount) {
      setError(tFinance('discountTooHigh'));
      return;
    }
    if (!cashRegisterId) {
      setError(tFinance('cashRegisterRequired'));
      return;
    }
    if (isZeroPaid && !zeroPaidConfirmed) {
      setError(tFinance('zeroPaidWarning'));
      return;
    }
    setSubmitting(true);
    try {
      const body: PayPaymentInput = {
        cashRegisterId,
        paidVia,
        ...(discountNum > 0 ? { discountAmount: discountNum } : {}),
        ...(isZeroPaid ? { confirmZeroPaid: true } : {}),
        ...(paidAt
          ? { paidAt: new Date(`${paidAt}:00`).toISOString() }
          : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      };
      await onConfirm(body);
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : 'Erro';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{tFinance('title')}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <div className="rounded-md border border-border bg-surface-muted p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-text-muted">{tFinance('amount')}</span>
                <span className="tabular font-semibold">{amount.toFixed(2)}</span>
              </div>
              {discountNum > 0 && (
                <>
                  <div className="mt-1 flex items-center justify-between text-text-muted">
                    <span>{tFinance('discount')}</span>
                    <span className="tabular">- {discountNum.toFixed(2)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between border-t border-border pt-1 font-semibold">
                    <span>{tFinance('netAmount')}</span>
                    <span className="tabular">{paidAmount.toFixed(2)}</span>
                  </div>
                </>
              )}
            </div>

            <div>
              <Label htmlFor="pay-cash" required>
                {tFinance('cashRegister')}
              </Label>
              <Select
                id="pay-cash"
                value={cashRegisterId}
                onChange={(e) => setCashRegisterId(e.target.value)}
                required
              >
                <option value="">{tFinance('cashRegisterPlaceholder')}</option>
                {(registers ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
              <FieldHelp>
                {(registers ?? []).length === 0
                  ? tFinance('noRegistersAvailable')
                  : tFinance('cashRegisterHelp')}
              </FieldHelp>
            </div>

            <div>
              <Label htmlFor="pay-method">{tFinance('paidVia')}</Label>
              <Select
                id="pay-method"
                value={paidVia}
                onChange={(e) => setPaidVia(e.target.value as PaymentMethod)}
              >
                {METHOD_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {tMethod(m as 'CASH')}
                  </option>
                ))}
              </Select>
            </div>

            {canDiscount && (
              <div>
                <Label htmlFor="pay-discount">{tFinance('discount')}</Label>
                <Input
                  id="pay-discount"
                  inputMode="decimal"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(e.target.value)}
                  placeholder="0,00"
                />
                <FieldHelp>{tFinance('discountHelp')}</FieldHelp>
              </div>
            )}

            {isZeroPaid && (
              <div className="rounded-md border border-border bg-warning-muted p-3 text-sm text-warning">
                <p className="font-medium">{tFinance('zeroPaidWarning')}</p>
                <label className="mt-2 flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={zeroPaidConfirmed}
                    onChange={(e) => setZeroPaidConfirmed(e.target.checked)}
                  />
                  <span>{tFinance('zeroPaidConfirm')}</span>
                </label>
              </div>
            )}

            <div>
              <Label htmlFor="pay-date">{tFinance('paidAt')}</Label>
              <Input
                id="pay-date"
                type="datetime-local"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
              />
              <FieldHelp>{tFinance('paidAtHelp')}</FieldHelp>
            </div>

            <div>
              <Label htmlFor="pay-note">{tFinance('note')}</Label>
              <Textarea
                id="pay-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
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
              {tCommon('cancel')}
            </Button>
            <Button
              type="submit"
              loading={submitting}
              disabled={!cashRegisterId || (isZeroPaid && !zeroPaidConfirmed)}
            >
              {confirmLabel ?? tFinance('confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

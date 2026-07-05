import { z } from 'zod';

/**
 * Forma de pagamento. Independe do caixa — uma maquininha pode aceitar tanto
 * CARD quanto PIX. O usuário informa qual foi usado na hora de dar baixa.
 */
export const PaymentMethodSchema = z.enum([
  'CASH',
  'PIX',
  'CARD',
  'BANK_TRANSFER',
  // BOLETO — baixa de fatura paga via boleto/Bolix do gateway EFI (espelha o
  // enum PaymentMethod do Prisma).
  'BOLETO',
  'OTHER',
]);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

/**
 * Campos comuns ao pagar (fatura ou cobrança avulsa). Usado por:
 *   - PayContractInvoiceRequest (extends este)
 *   - PayOneTimeChargeRequest
 */
export const PaymentDetailsSchema = z.object({
  /** Caixa que recebeu. Se vazio, registramos como "sem caixa". */
  cashRegisterId: z.string().uuid().nullish(),
  /** Forma como o cliente pagou. */
  paidVia: PaymentMethodSchema.optional(),
  /**
   * Desconto aplicado (positivo). Quando preenchido, o user precisa ter perm
   * `finance.discount.apply`.
   */
  discountAmount: z.coerce.number().min(0).optional(),
  /** Valor pago (sem o desconto). Default = amount - discount. */
  paidAmount: z.coerce.number().min(0).optional(),
  /** Override da data — default = now. */
  paidAt: z.string().datetime({ offset: true }).optional(),
  /** Nota livre. */
  note: z.string().max(500).optional(),
  /**
   * Baixa sem recebimento (desconto cobre 100% do valor). Sem esse flag o
   * backend rejeita paidAmount = 0 — evita fatura "paga" sem nada entrar no
   * caixa por desconto digitado errado.
   */
  confirmZeroPaid: z.boolean().optional(),
});
export type PaymentDetails = z.infer<typeof PaymentDetailsSchema>;

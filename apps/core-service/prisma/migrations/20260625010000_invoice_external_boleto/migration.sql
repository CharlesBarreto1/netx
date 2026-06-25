-- ContractInvoice — boleto/Pix de ORIGEM (migração). Guarda o documento já
-- gerado no sistema legado (ex.: Hubsoft) para REIMPRIMIR, em vez de o NetX
-- emitir uma nova cobrança bancária. O pagamento baixa nos dois sistemas via
-- o sync do legado (status pago) → NetX.

ALTER TABLE "contract_invoices"
  ADD COLUMN "ext_source" VARCHAR(16),
  ADD COLUMN "ext_boleto_url" VARCHAR(500),
  ADD COLUMN "ext_digitable_line" VARCHAR(64),
  ADD COLUMN "ext_barcode" VARCHAR(64),
  ADD COLUMN "ext_pix_code" TEXT;

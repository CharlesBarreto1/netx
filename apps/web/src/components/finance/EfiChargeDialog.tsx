'use client';

import { Check, Copy, ExternalLink, FileText, Loader2, QrCode } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
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
import { ApiError } from '@/lib/api';
import {
  efiApi,
  type EfiCharge,
  type EfiChargeKind,
  type EfiConfigView,
} from '@/lib/finance-api';
import { useFormatMoney } from '@/lib/use-money';

interface EfiChargeDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoiceId: string;
  amount: number;
  description?: string;
  /** Chamado quando uma cobrança é emitida com sucesso (pra revalidar a lista). */
  onGenerated?: () => void;
}

/**
 * EfiChargeDialog — gera e exibe a cobrança EFI (Pix imediato ou boleto+Pix
 * "Bolix") de uma fatura. Princípio "hub do atendente": o operador gera o
 * Pix/boleto sem sair da tela do cliente e copia/envia ao cliente na hora.
 *
 * Carrega a config EFI (pra saber se está habilitada e o kind default) e a
 * cobrança já existente da fatura. Se já houver cobrança ACTIVE, mostra ela;
 * senão, oferece os botões de gerar.
 */
export function EfiChargeDialog({
  open,
  onOpenChange,
  invoiceId,
  amount,
  description,
  onGenerated,
}: EfiChargeDialogProps) {
  const formatMoney = useFormatMoney();
  const [generating, setGenerating] = useState<EfiChargeKind | null>(null);

  const { data: config } = useSWR<EfiConfigView>(open ? efiApi.configPath() : null);
  const {
    data: charge,
    mutate,
    isLoading,
  } = useSWR<EfiCharge | null>(open ? efiApi.invoiceChargePath(invoiceId) : null);

  const enabled = config?.enabled ?? false;
  const defaultKind = config?.defaultChargeKind ?? 'BOLIX';
  const active = charge && charge.status === 'ACTIVE' ? charge : null;

  async function generate(kind: EfiChargeKind, force = false) {
    setGenerating(kind);
    try {
      const result = await efiApi.generate(invoiceId, { kind, force });
      await mutate(result, { revalidate: false });
      onGenerated?.();
      toast.success(kind === 'PIX' ? 'Pix gerado' : 'Boleto gerado');
    } catch (e) {
      const msg = e instanceof ApiError ? e.friendlyMessage : 'Falha ao gerar cobrança';
      toast.error(msg);
    } finally {
      setGenerating(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cobrança EFI</DialogTitle>
          <DialogDescription>
            {description ? `${description} · ` : ''}
            {formatMoney(amount)}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {!enabled && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              A integração EFI não está habilitada para este provedor. Configure
              em Configurações → Pagamentos (EFI).
            </p>
          )}

          {enabled && isLoading && (
            <div className="flex items-center justify-center py-6 text-text-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}

          {enabled && !isLoading && !active && (
            <div className="space-y-3">
              <p className="text-sm text-text-muted">
                Gere uma cobrança para enviar ao cliente:
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={() => generate('BOLIX')}
                  loading={generating === 'BOLIX'}
                  disabled={generating != null}
                  variant={defaultKind === 'BOLIX' ? 'primary' : 'outline'}
                >
                  <FileText className="mr-1.5 h-4 w-4" /> Boleto + Pix
                </Button>
                <Button
                  onClick={() => generate('PIX')}
                  loading={generating === 'PIX'}
                  disabled={generating != null}
                  variant={defaultKind === 'PIX' ? 'primary' : 'outline'}
                >
                  <QrCode className="mr-1.5 h-4 w-4" /> Pix
                </Button>
              </div>
              {charge && charge.status === 'ERROR' && charge.lastError && (
                <p className="text-2xs text-red-600 dark:text-red-400">
                  Última tentativa falhou: {charge.lastError}
                </p>
              )}
            </div>
          )}

          {active && <ChargeView charge={active} />}
        </DialogBody>

        <DialogFooter>
          {active && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => generate(active.kind, true)}
              loading={generating != null}
              title="Cancela a cobrança atual e emite uma nova"
            >
              Reemitir
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Exibe os artefatos de uma cobrança ATIVA (QR, copia-e-cola, boleto, PDF). */
function ChargeView({ charge }: { charge: EfiCharge }) {
  const hasPix = !!(charge.pixCopiaECola || charge.pixQrImage);
  const hasBoleto = !!(charge.barcode || charge.pdfUrl || charge.paymentLink);

  return (
    <div className="space-y-4">
      {charge.expiresAt && (
        <p className="text-2xs text-text-muted">
          Expira em {new Date(charge.expiresAt).toLocaleString('pt-BR')}
        </p>
      )}

      {hasPix && (
        <div className="space-y-2">
          {charge.pixQrImage && (
            <div className="flex justify-center">
              {/* QR é um dataURL (image/png base64) gerado pelo EFI; next/image
                  não agrega aqui e exigiria allowlist de domínio. */}
              <img
                src={charge.pixQrImage}
                alt="QR Code Pix"
                className="h-44 w-44 rounded-md border border-border bg-white p-2"
              />
            </div>
          )}
          {charge.pixCopiaECola && (
            <CopyField label="Pix copia-e-cola" value={charge.pixCopiaECola} mono />
          )}
        </div>
      )}

      {hasBoleto && (
        <div className="space-y-2">
          {charge.barcode && (
            <CopyField label="Linha digitável" value={charge.barcode} mono />
          )}
          <div className="flex gap-2">
            {charge.pdfUrl && (
              <a href={charge.pdfUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">
                  <FileText className="mr-1.5 h-4 w-4" /> Abrir PDF
                </Button>
              </a>
            )}
            {charge.paymentLink && (
              <a href={charge.paymentLink} target="_blank" rel="noopener noreferrer">
                <Button variant="ghost" size="sm">
                  <ExternalLink className="mr-1.5 h-4 w-4" /> Link de pagamento
                </Button>
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Campo somente-leitura com botão de copiar. */
function CopyField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard?.writeText(value);
    setCopied(true);
    toast.success('Copiado');
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div>
      <div className="mb-1 text-2xs font-semibold uppercase tracking-wider text-text-muted">
        {label}
      </div>
      <div className="flex items-stretch gap-2">
        <code
          className={`flex-1 overflow-x-auto rounded-md border border-border bg-surface-hover px-2 py-1.5 text-xs ${
            mono ? 'font-mono' : ''
          } whitespace-nowrap`}
        >
          {value}
        </code>
        <Button variant="outline" size="icon" onClick={copy} title="Copiar">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

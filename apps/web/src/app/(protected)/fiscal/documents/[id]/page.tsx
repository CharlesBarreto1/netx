'use client';

/**
 * /fiscal/documents/[id] — detalhe de um DTE SIFEN.
 *
 * 3 cards (Identificação, Receptor, Resposta SET) + QR + XML viewer.
 * Ações: baixar XML, cancelar (só APPROVED < 48h), copiar CDC.
 */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import useSWR, { mutate } from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { FieldHelp, Label, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { hasPermission } from '@/lib/session';
import { useFormatMoney } from '@/lib/use-money';
import { sifenApi, type SifenDocument } from '@/lib/sifen-api';

export default function FiscalDocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const canCancel = hasPermission('sifen.cancel');
  const formatMoney = useFormatMoney();

  const key = id ? `/v1/sifen/documents/${id}` : null;
  const { data: doc, isLoading } = useSWR<SifenDocument>(key, () => sifenApi.get(id!));

  const [xml, setXml] = useState<string | null>(null);
  const [xmlLoading, setXmlLoading] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!doc?.qrUrl) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(doc.qrUrl, { width: 220, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [doc?.qrUrl]);

  if (isLoading || !doc) return <PageLoader />;

  // Janela de cancelamento por tipo (Manual SIFEN v150):
  //   FACTURA = 48h, demais (NC/ND/Auto/Remision) = 168h.
  const windowHours = doc.type === 'FACTURA' ? 48 : 168;
  const cancellable = isCancellable(doc, windowHours);
  const hoursLeft = doc.approvedAt
    ? Math.max(0, windowHours - (Date.now() - new Date(doc.approvedAt).getTime()) / (3600 * 1000))
    : 0;

  async function loadXml() {
    if (xml || !id) return;
    setXmlLoading(true);
    try {
      const x = await sifenApi.getXml(id);
      setXml(x);
    } catch (err) {
      toast.error(`Falha ao baixar XML: ${(err as Error).message}`);
    } finally {
      setXmlLoading(false);
    }
  }

  // `doc` foi narrowed pra non-null logo acima (early return). TS perde a
  // narrow nas closures porque `doc` vem de useSWR e pode mudar entre renders
  // — capturamos numa const local pra restabelecer o narrow dentro do escopo.
  const safeDoc = doc;

  function downloadXml() {
    if (!xml) return;
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeDoc.cdc}.xml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function copyCdc() {
    navigator.clipboard.writeText(safeDoc.cdc);
    toast.success('CDC copiado');
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <Link href="/fiscal/documents" className="text-xs text-brand-500 hover:underline">
            ← Documentos fiscais
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            {TYPE_LABELS[doc.type]} {doc.numeroDocumento}
          </h1>
          <p className="text-xs text-text-muted">
            Emitido em {formatDateTime(doc.issuedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => { void loadXml().then(downloadXml); }}>
            {xmlLoading ? 'Baixando…' : 'Baixar XML'}
          </Button>
          {doc.qrUrl && (
            <a href={doc.qrUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm">Abrir no eKuatia ↗</Button>
            </a>
          )}
          {canCancel && cancellable && (
            <Button variant="danger" size="sm" onClick={() => setCancelOpen(true)}>
              Cancelar DTE
            </Button>
          )}
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Identificação */}
        <Card title="Identificação">
          <Row label="Status">
            <StatusBadge status={doc.status} />
          </Row>
          <Row label="Tipo">{TYPE_LABELS[doc.type] ?? doc.type}</Row>
          <Row label="CDC">
            <span className="font-mono text-xs break-all">{doc.cdc}</span>
            <button
              type="button"
              onClick={copyCdc}
              className="ml-2 text-xs text-brand-500 hover:underline"
            >
              copiar
            </button>
          </Row>
          <Row label="Estab/Punto/Número">
            {doc.establecimiento}-{doc.puntoExpedicion}-{String(doc.numero).padStart(7, '0')}
          </Row>
          <Row label="Emisor RUC">{doc.emisorRuc}</Row>
          <Row label="Timbrado">{doc.emisorTimbrado}</Row>
          {doc.signedAt && <Row label="Assinado">{formatDateTime(doc.signedAt)}</Row>}
          {doc.sentAt && <Row label="Enviado">{formatDateTime(doc.sentAt)}</Row>}
          {doc.approvedAt && <Row label="Aprovado">{formatDateTime(doc.approvedAt)}</Row>}
          {doc.rejectedAt && <Row label="Rejeitado">{formatDateTime(doc.rejectedAt)}</Row>}
          {doc.cancelledAt && <Row label="Cancelado">{formatDateTime(doc.cancelledAt)}</Row>}
          {doc.status === 'APPROVED' && cancellable && (
            <Row label="Janela de cancelamento">
              <Badge tone="warning">expira em {hoursLeft.toFixed(1)}h</Badge>
            </Row>
          )}
        </Card>

        {/* Receptor + total */}
        <Card title="Receptor">
          <Row label="Nome">{doc.receptorName ?? <em className="text-text-muted">Sin nombre</em>}</Row>
          <Row label="RUC/CI">{doc.receptorTaxId ?? <em className="text-text-muted">—</em>}</Row>
          <Row label="Total">
            <strong>{formatMoney(doc.totalAmount)}</strong> {doc.currency}
          </Row>
          {doc.contractInvoiceId && (
            <Row label="Origem">
              <Link
                href={`/contracts?invoiceId=${doc.contractInvoiceId}`}
                className="text-brand-500 hover:underline"
              >
                Fatura de contrato
              </Link>
            </Row>
          )}
          {doc.oneTimeChargeId && (
            <Row label="Origem">Cobrança avulsa</Row>
          )}
        </Card>

        {/* QR */}
        {doc.qrUrl && (
          <Card title="QR Code / KuDE">
            <div className="flex flex-col items-center gap-3 py-2">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="QR SIFEN" className="rounded border border-border" width={220} height={220} />
              ) : (
                <div className="h-[220px] w-[220px] animate-pulse rounded bg-surface-muted" />
              )}
              <p className="text-center text-xs text-text-muted break-all">{doc.qrUrl}</p>
            </div>
          </Card>
        )}

        {/* Resposta SET */}
        <Card title="Resposta SET">
          {doc.status === 'APPROVED' && (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">
              ✓ Autorizado pela SET.
            </p>
          )}
          {doc.status === 'REJECTED' && (
            <div className="space-y-2">
              <p className="text-sm text-rose-600 dark:text-rose-400">
                ✗ Documento rejeitado pela SET.
              </p>
              {doc.rejectionCode && <Row label="Código">{doc.rejectionCode}</Row>}
              {doc.rejectionReason && <Row label="Mensagem">{doc.rejectionReason}</Row>}
            </div>
          )}
          {doc.lastError && doc.status !== 'APPROVED' && (
            <Row label="Último erro">
              <span className="text-xs text-rose-600 dark:text-rose-400">{doc.lastError}</span>
            </Row>
          )}
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-brand-500 hover:underline">
              Ver XML assinado
            </summary>
            <div className="mt-2">
              {!xml ? (
                <Button size="sm" variant="ghost" onClick={loadXml} loading={xmlLoading}>
                  Carregar XML
                </Button>
              ) : (
                <Textarea
                  value={xml}
                  readOnly
                  rows={12}
                  className="font-mono text-xs"
                />
              )}
            </div>
          </details>
        </Card>
      </div>

      {cancelOpen && (
        <CancelDialog
          docId={doc.id}
          onClose={() => setCancelOpen(false)}
          onCancelled={() => {
            if (key) mutate(key);
            setCancelOpen(false);
          }}
        />
      )}
    </div>
  );
}

const TYPE_LABELS: Record<string, string> = {
  FACTURA: 'Factura',
  NOTA_CREDITO: 'Nota de Crédito',
  NOTA_DEBITO: 'Nota de Débito',
  AUTOFACTURA: 'Autofactura',
  NOTA_REMISION: 'Nota de Remisión',
};

function isCancellable(doc: SifenDocument, windowHours: number): boolean {
  if (doc.status !== 'APPROVED' || !doc.approvedAt) return false;
  const ageMs = Date.now() - new Date(doc.approvedAt).getTime();
  return ageMs < windowHours * 3600 * 1000;
}

function StatusBadge({ status }: { status: SifenDocument['status'] }) {
  const tone: 'neutral' | 'success' | 'warning' | 'danger' = (
    {
      DRAFT: 'neutral',
      SIGNED: 'neutral',
      SENT: 'warning',
      APPROVED: 'success',
      REJECTED: 'danger',
      CANCELLED: 'neutral',
    } as const
  )[status];
  return <Badge tone={tone}>{status}</Badge>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <h2 className="mb-3 text-base font-semibold text-text">{title}</h2>
      <div className="space-y-2 text-sm">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-dashed border-border pb-1.5 last:border-0">
      <span className="text-text-muted">{label}</span>
      <span className="text-text text-right">{children}</span>
    </div>
  );
}

// =============================================================================
// Cancel dialog
// =============================================================================
function CancelDialog({
  docId,
  onClose,
  onCancelled,
}: {
  docId: string;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (reason.trim().length < 5) {
      toast.error('Motivo deve ter pelo menos 5 caracteres');
      return;
    }
    setSubmitting(true);
    try {
      await sifenApi.cancel(docId, reason.trim());
      toast.success('DTE cancelado');
      onCancelled();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={submitting ? () => {} : onClose}
      title="Cancelar DTE"
      description="Esta operação envia um evento de cancelación ao SET. Não pode ser desfeita."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Voltar
          </Button>
          <Button variant="danger" onClick={submit} loading={submitting}>
            Cancelar DTE
          </Button>
        </>
      }
    >
      <div>
        <Label required>Motivo (5–500 caracteres)</Label>
        <Textarea
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ex.: Erro no valor cobrado; emitida nova fatura."
          maxLength={500}
        />
        <FieldHelp>
          O SET exige motivo entre 5 e 500 caracteres. Será gravado no histórico
          e fica visível no portal eKuatia.
        </FieldHelp>
      </div>
    </Modal>
  );
}

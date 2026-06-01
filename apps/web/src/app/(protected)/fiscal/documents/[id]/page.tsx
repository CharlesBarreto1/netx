'use client';

/**
 * /fiscal/documents/[id] — detalhe de um DTE SIFEN.
 *
 * 3 cards (Identificação, Receptor, Resposta SET) + QR + XML viewer.
 * Ações: baixar XML, cancelar (só APPROVED < 48h), copiar CDC.
 */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('fiscal.documentDetail');
  const tc = useTranslations('common');
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
      toast.error(t('toast.downloadXmlFailed', { message: (err as Error).message }));
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
    toast.success(t('toast.cdcCopied'));
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <Link href="/fiscal/documents" className="text-xs text-brand-500 hover:underline">
            {t('backToList')}
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            {t(`docType.${doc.type}`)} {doc.numeroDocumento}
          </h1>
          <p className="text-xs text-text-muted">
            {t('issuedAt', { date: formatDateTime(doc.issuedAt) })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => { void loadXml().then(downloadXml); }}>
            {xmlLoading ? t('downloadingXml') : t('downloadXml')}
          </Button>
          {doc.qrUrl && (
            <a href={doc.qrUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm">{t('openInEkuatia')}</Button>
            </a>
          )}
          {canCancel && cancellable && (
            <Button variant="danger" size="sm" onClick={() => setCancelOpen(true)}>
              {t('cancelDte')}
            </Button>
          )}
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Identificação */}
        <Card title={t('card.identification')}>
          <Row label={tc('status')}>
            <StatusBadge status={doc.status} />
          </Row>
          <Row label={tc('type')}>{t(`docType.${doc.type}`)}</Row>
          <Row label={t('field.cdc')}>
            <span className="font-mono text-xs break-all">{doc.cdc}</span>
            <button
              type="button"
              onClick={copyCdc}
              className="ml-2 text-xs text-brand-500 hover:underline"
            >
              {t('copy')}
            </button>
          </Row>
          <Row label={t('field.estabPointNumber')}>
            {doc.establecimiento}-{doc.puntoExpedicion}-{String(doc.numero).padStart(7, '0')}
          </Row>
          <Row label={t('field.emisorRuc')}>{doc.emisorRuc}</Row>
          <Row label={t('field.timbrado')}>{doc.emisorTimbrado}</Row>
          {doc.signedAt && <Row label={t('field.signed')}>{formatDateTime(doc.signedAt)}</Row>}
          {doc.sentAt && <Row label={t('field.sent')}>{formatDateTime(doc.sentAt)}</Row>}
          {doc.approvedAt && <Row label={t('field.approved')}>{formatDateTime(doc.approvedAt)}</Row>}
          {doc.rejectedAt && <Row label={t('field.rejected')}>{formatDateTime(doc.rejectedAt)}</Row>}
          {doc.cancelledAt && <Row label={t('field.cancelled')}>{formatDateTime(doc.cancelledAt)}</Row>}
          {doc.status === 'APPROVED' && cancellable && (
            <Row label={t('field.cancellationWindow')}>
              <Badge tone="warning">{t('expiresIn', { hours: hoursLeft.toFixed(1) })}</Badge>
            </Row>
          )}
        </Card>

        {/* Receptor + total */}
        <Card title={t('card.receiver')}>
          <Row label={t('field.name')}>{doc.receptorName ?? <em className="text-text-muted">{t('noName')}</em>}</Row>
          <Row label={t('field.rucCi')}>{doc.receptorTaxId ?? <em className="text-text-muted">—</em>}</Row>
          <Row label={t('field.total')}>
            <strong>{formatMoney(doc.totalAmount)}</strong> {doc.currency}
          </Row>
          {doc.contractInvoiceId && (
            <Row label={t('field.origin')}>
              <Link
                href={`/contracts?invoiceId=${doc.contractInvoiceId}`}
                className="text-brand-500 hover:underline"
              >
                {t('origin.contractInvoice')}
              </Link>
            </Row>
          )}
          {doc.oneTimeChargeId && (
            <Row label={t('field.origin')}>{t('origin.oneTimeCharge')}</Row>
          )}
        </Card>

        {/* QR */}
        {doc.qrUrl && (
          <Card title={t('card.qrCode')}>
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
        <Card title={t('card.setResponse')}>
          {doc.status === 'APPROVED' && (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">
              {t('setAuthorized')}
            </p>
          )}
          {doc.status === 'REJECTED' && (
            <div className="space-y-2">
              <p className="text-sm text-rose-600 dark:text-rose-400">
                {t('setRejected')}
              </p>
              {doc.rejectionCode && <Row label={t('field.code')}>{doc.rejectionCode}</Row>}
              {doc.rejectionReason && <Row label={t('field.message')}>{doc.rejectionReason}</Row>}
            </div>
          )}
          {doc.lastError && doc.status !== 'APPROVED' && (
            <Row label={t('field.lastError')}>
              <span className="text-xs text-rose-600 dark:text-rose-400">{doc.lastError}</span>
            </Row>
          )}
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-brand-500 hover:underline">
              {t('viewSignedXml')}
            </summary>
            <div className="mt-2">
              {!xml ? (
                <Button size="sm" variant="ghost" onClick={loadXml} loading={xmlLoading}>
                  {t('loadXml')}
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
  const t = useTranslations('fiscal.documentDetail');
  const tc = useTranslations('common');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (reason.trim().length < 5) {
      toast.error(t('toast.reasonTooShort'));
      return;
    }
    setSubmitting(true);
    try {
      await sifenApi.cancel(docId, reason.trim());
      toast.success(t('toast.dteCancelled'));
      onCancelled();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(t('toast.cancelFailed', { message: msg }));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={submitting ? () => {} : onClose}
      title={t('cancelDte')}
      description={t('cancelDialog.description')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {tc('back')}
          </Button>
          <Button variant="danger" onClick={submit} loading={submitting}>
            {t('cancelDte')}
          </Button>
        </>
      }
    >
      <div>
        <Label required>{t('cancelDialog.reasonLabel')}</Label>
        <Textarea
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('cancelDialog.reasonPlaceholder')}
          maxLength={500}
        />
        <FieldHelp>
          {t('cancelDialog.reasonHelp')}
        </FieldHelp>
      </div>
    </Modal>
  );
}

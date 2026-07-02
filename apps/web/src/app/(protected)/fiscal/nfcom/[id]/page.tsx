'use client';

/**
 * /fiscal/nfcom/[id] — detalhe de uma NFCom: status, chave, protocolo, XML,
 * cancelamento (dentro do prazo).
 */
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import { useFormatMoney } from '@/lib/use-money';
import { nfcomApi, type NfcomDocument, type NfcomDocumentStatus } from '@/lib/nfcom-api';

const TONE: Record<NfcomDocumentStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'neutral', SIGNED: 'neutral', SENT: 'warning', AUTHORIZED: 'success',
  REJECTED: 'danger', DENIED: 'danger', CANCELLED: 'neutral',
};

export default function NfcomDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const fmt = useFormatMoney();
  const { data, isLoading, mutate } = useSWR<NfcomDocument>(
    id ? `/v1/nfcom/documents/${id}` : null,
    () => nfcomApi.get(id),
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const canCancel = hasPermission('nfcom.cancel');

  if (isLoading || !data) return <PageLoader />;

  async function cancel() {
    if (reason.trim().length < 15) {
      toast.error('A justificativa deve ter pelo menos 15 caracteres.');
      return;
    }
    setBusy(true);
    try {
      await nfcomApi.cancel(id, reason.trim());
      toast.success('NFCom cancelada.');
      setReason('');
      void mutate();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Erro: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  const xmlHref = `${(process.env.NEXT_PUBLIC_API_URL ?? '/api').replace(/\/$/, '')}/v1/nfcom/documents/${id}/xml`;

  return (
    <div className="max-w-3xl space-y-5">
      <header className="flex items-center justify-between gap-3">
        <div>
          <button onClick={() => router.back()} className="text-xs text-text-muted hover:underline">
            ← voltar
          </button>
          <h1 className="text-2xl font-bold tracking-tight">NFCom {data.numeroDocumento}</h1>
        </div>
        <Badge tone={TONE[data.status]}>{data.status}</Badge>
      </header>

      <section className="rounded-lg border border-border bg-surface p-4 text-sm">
        <Row label="Destinatário" value={data.receptorName ?? '—'} />
        <Row label="CNPJ/CPF" value={data.receptorTaxId ?? '—'} />
        <Row label="Valor total" value={fmt(data.totalAmount)} />
        <Row label="ICMS" value={data.valorIcms != null ? `${fmt(data.valorIcms)} (${data.aliquotaIcms ?? 0}%)` : '—'} />
        <Row label="Chave de acesso" value={data.chaveAcesso ?? '—'} mono />
        <Row label="Protocolo" value={data.protocolo ?? '—'} mono />
        <Row label="Emissão" value={new Date(data.issuedAt).toLocaleString('pt-BR')} />
        {data.rejectionReason && (
          <Row label="Rejeição" value={`${data.rejectionCode ?? ''} ${data.rejectionReason}`} danger />
        )}
        {data.lastError && <Row label="Erro" value={data.lastError} danger />}
        {data.cancelReason && <Row label="Cancelamento" value={data.cancelReason} />}
      </section>

      {(data.signedAt || data.chaveAcesso) && (
        <a href={xmlHref} target="_blank" rel="noreferrer" className="inline-block text-sm text-accent hover:underline">
          Baixar XML
        </a>
      )}

      {data.status === 'AUTHORIZED' && canCancel && (
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 text-base font-semibold">Cancelar NFCom</h2>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Justificativa (mín. 15 caracteres)"
            rows={2}
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
          />
          <div className="mt-2 flex justify-end">
            <Button variant="danger" onClick={cancel} loading={busy}>
              Cancelar NFCom
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  danger,
}: {
  label: string;
  value: string;
  mono?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/40 py-1.5 last:border-0">
      <span className="text-text-muted">{label}</span>
      <span className={`text-right ${mono ? 'font-mono text-xs' : ''} ${danger ? 'text-danger' : 'text-text'}`}>
        {value}
      </span>
    </div>
  );
}

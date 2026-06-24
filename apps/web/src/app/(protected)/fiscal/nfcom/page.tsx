'use client';

/**
 * /fiscal/nfcom — lista de NFCom (modelo 62) emitidas pelo tenant.
 */
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { PageLoader } from '@/components/ui/Spinner';
import { useFormatMoney } from '@/lib/use-money';
import {
  nfcomApi,
  type ListNfcomParams,
  type NfcomDocument,
  type NfcomDocumentStatus,
} from '@/lib/nfcom-api';

const STATUS_TONE: Record<NfcomDocumentStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'neutral',
  SIGNED: 'neutral',
  SENT: 'warning',
  AUTHORIZED: 'success',
  REJECTED: 'danger',
  DENIED: 'danger',
  CANCELLED: 'neutral',
};

const STATUS_LABEL: Record<NfcomDocumentStatus, string> = {
  DRAFT: 'Rascunho',
  SIGNED: 'Assinada',
  SENT: 'Enviada',
  AUTHORIZED: 'Autorizada',
  REJECTED: 'Rejeitada',
  DENIED: 'Denegada',
  CANCELLED: 'Cancelada',
};

export default function NfcomListPage() {
  const [status, setStatus] = useState<NfcomDocumentStatus | ''>('');
  const params: ListNfcomParams = { pageSize: 50, ...(status ? { status } : {}) };
  const { data, isLoading } = useSWR(nfcomApi.listPath(params), () => nfcomApi.list(params));
  const fmt = useFormatMoney();

  if (isLoading || !data) return <PageLoader />;

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">NFCom</h1>
          <p className="mt-1 text-sm text-text-muted">
            Notas Fiscais Fatura de Serviço de Comunicação (modelo 62).
          </p>
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as NfcomDocumentStatus | '')}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
        >
          <option value="">Todos os status</option>
          {Object.keys(STATUS_LABEL).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s as NfcomDocumentStatus]}
            </option>
          ))}
        </select>
      </header>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-text-muted">
            <tr>
              <th className="px-3 py-2">Número</th>
              <th className="px-3 py-2">Destinatário</th>
              <th className="px-3 py-2">Chave / Protocolo</th>
              <th className="px-3 py-2 text-right">Valor</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Emissão</th>
            </tr>
          </thead>
          <tbody>
            {data.data.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-text-muted">
                  Nenhuma NFCom emitida ainda.
                </td>
              </tr>
            )}
            {data.data.map((d: NfcomDocument) => (
              <tr key={d.id} className="border-b border-border/50 hover:bg-surface-hover">
                <td className="px-3 py-2">
                  <Link href={`/fiscal/nfcom/${d.id}`} className="font-medium text-accent hover:underline">
                    {d.numeroDocumento}
                  </Link>
                </td>
                <td className="px-3 py-2">{d.receptorName ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-xs text-text-muted">
                  {d.chaveAcesso ? `${d.chaveAcesso.slice(0, 8)}…${d.chaveAcesso.slice(-6)}` : '—'}
                  {d.protocolo ? ` · ${d.protocolo}` : ''}
                </td>
                <td className="px-3 py-2 text-right">{fmt(d.totalAmount)}</td>
                <td className="px-3 py-2">
                  <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
                </td>
                <td className="px-3 py-2 text-text-muted">
                  {new Date(d.issuedAt).toLocaleDateString('pt-BR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

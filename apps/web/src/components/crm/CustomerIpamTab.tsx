'use client';

import { Network } from 'lucide-react';
import Link from 'next/link';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { PageLoader } from '@/components/ui/Spinner';
import { ipamApi, type IpamAddress } from '@/lib/ipam-api';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  FREE: 'neutral',
  USED: 'success',
  RESERVED: 'warning',
  DHCP: 'info',
  DEPRECATED: 'danger',
};

const KIND_LABEL: Record<string, string> = {
  CONTRACT: 'Contrato',
  EQUIPMENT: 'Equipamento',
  CUSTOMER: 'Bloco do cliente',
  GATEWAY: 'Gateway',
  OTHER: 'Outro',
};

/**
 * IPs documentados no IPAM vinculados a este cliente — inclui os IPs fixos dos
 * contratos (espelhados automaticamente do Framed-IP) e blocos corporativos.
 */
export function CustomerIpamTab({ customerId }: { customerId: string }) {
  const { data, isLoading } = useSWR(['customer-ipam', customerId], () =>
    ipamApi.listAddresses({ customerId }),
  );

  if (isLoading) return <PageLoader />;

  const addresses = (data ?? []) as IpamAddress[];

  if (!addresses.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-text-muted">
        <Network className="h-8 w-8 opacity-40" />
        <p>Nenhum IP documentado no IPAM para este cliente.</p>
        <p className="text-xs">
          IPs fixos definidos nos contratos aparecem aqui automaticamente.
        </p>
        <Link href="/network/ipam" className="text-brand-600 hover:underline">
          Abrir IPAM
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">IPs no IPAM</h3>
        <Link href="/network/ipam" className="text-xs text-brand-600 hover:underline">
          Gerenciar no IPAM
        </Link>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase text-text-muted">
            <tr>
              <th className="px-3 py-2">IP</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Vínculo</th>
            </tr>
          </thead>
          <tbody>
            {addresses.map((a) => (
              <tr key={a.id} className="border-t border-border">
                <td className="px-3 py-2 font-mono">
                  {a.address}
                  {a.prefix?.cidr ? (
                    <span className="ml-2 text-xs text-text-muted">{a.prefix.cidr}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2">{a.kind ? KIND_LABEL[a.kind] ?? a.kind : '—'}</td>
                <td className="px-3 py-2">
                  <Badge tone={STATUS_TONE[a.status] ?? 'neutral'}>{a.status}</Badge>
                </td>
                <td className="px-3 py-2 text-xs text-text-muted">
                  {a.contract?.code ? (
                    <Link href={`/contracts/${a.contract.id}`} className="text-brand-600 hover:underline">
                      Contrato {a.contract.code}
                    </Link>
                  ) : (
                    a.description ?? '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

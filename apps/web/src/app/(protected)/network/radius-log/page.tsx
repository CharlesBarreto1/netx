'use client';

import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import {
  radiusAuthLogApi,
  type AuthLogResponse,
} from '@/lib/radius-auth-log-api';
import { formatDateTime } from '@/lib/format';

const PAGE_SIZE = 50;

/**
 * /network/radius-log — log de autenticação RADIUS.
 *
 * Lê de radius.radpostauth (FreeRADIUS post-auth log) com lookup do
 * contrato/cliente correspondente. Mostra cada tentativa de auth com
 * resultado (Accept/Reject), motivo (se policy preencher `class`),
 * username, IP de origem e o cliente identificado.
 *
 * Auto-refresh a cada 30s (operador-NOC pode deixar aberto).
 */
export default function RadiusLogPage() {
  const [page, setPage] = useState(1);
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState<'' | 'accepted' | 'rejected'>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const path = radiusAuthLogApi.listPath({
    page,
    pageSize: PAGE_SIZE,
    username: username.trim() || undefined,
    status: status || undefined,
    dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
    dateTo: dateTo ? new Date(dateTo).toISOString() : undefined,
  });
  const { data, isLoading, mutate } = useSWR<AuthLogResponse>(path, {
    refreshInterval: 30_000,
  });

  if (isLoading && !data) return <PageLoader />;

  const entries = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function clearFilters() {
    setUsername('');
    setStatus('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Log RADIUS</h1>
          <p className="text-sm text-text-muted">
            Tentativas de autenticación recibidas por el RADIUS — aceptadas y
            rechazadas, con cliente identificado.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void mutate()}
          title="Recargar"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </header>

      <div className="grid gap-3 rounded-md border border-border bg-surface p-3 md:grid-cols-5">
        <div className="md:col-span-2">
          <Label htmlFor="rl-username">Username</Label>
          <Input
            id="rl-username"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setPage(1);
            }}
            placeholder="PPPoE / MAC / circuit-id"
          />
        </div>
        <div>
          <Label htmlFor="rl-status">Status</Label>
          <Select
            id="rl-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as '' | 'accepted' | 'rejected');
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            <option value="accepted">Aceptados</option>
            <option value="rejected">Rechazados</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="rl-from">Desde</Label>
          <Input
            id="rl-from"
            type="datetime-local"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div>
          <Label htmlFor="rl-to">Hasta</Label>
          <Input
            id="rl-to"
            type="datetime-local"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="flex items-end md:col-span-5">
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Limpiar
          </Button>
          <span className="ml-3 text-xs text-text-muted">
            {total} {total === 1 ? 'registro' : 'registros'}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <tr>
              <th className="px-3 py-2">Cuándo</th>
              <th className="px-3 py-2">Resultado</th>
              <th className="px-3 py-2">Username</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Contrato</th>
              <th className="px-3 py-2">Calling Station</th>
              <th className="px-3 py-2">Motivo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entries.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-6 text-center text-text-muted"
                >
                  Sin registros para el filtro actual.
                </td>
              </tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id} className="hover:bg-surface-hover">
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-text-muted">
                    {formatDateTime(e.authdate)}
                  </td>
                  <td className="px-3 py-2">
                    {e.accepted ? (
                      <Badge tone="success">
                        <CheckCircle2 className="mr-1 inline h-3 w-3" />
                        Aceptado
                      </Badge>
                    ) : (
                      <Badge tone="danger">
                        <XCircle className="mr-1 inline h-3 w-3" />
                        Rechazado
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{e.username}</td>
                  <td className="px-3 py-2">
                    {e.customer ? (
                      <Link
                        href={`/customers/${e.customer.id}`}
                        className="text-brand-600 hover:underline dark:text-brand-300"
                      >
                        {e.customer.displayName}
                      </Link>
                    ) : (
                      <span className="text-xs text-text-subtle">
                        — sin contrato vinculado —
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted">
                    {e.contract ? (
                      <Link
                        href={`/contracts/${e.contract.id}`}
                        className="text-brand-600 hover:underline dark:text-brand-300"
                      >
                        {e.contract.code ?? `#${e.contract.id.slice(0, 8)}`}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-2xs text-text-muted">
                    {e.callingStationId ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-2xs text-text-muted">
                    {e.reason ?? (e.accepted ? '—' : 'Sin detalle')}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-text-muted">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </Button>
          <span>
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Siguiente
          </Button>
        </div>
      )}

      <p className="text-2xs text-text-muted">
        Para que aparezcan motivos de rechazo (usuario inexistente, contraseña
        incorrecta, etc.) hay que configurar la policy{' '}
        <code className="font-mono">post-auth-fail</code> del FreeRADIUS para
        escribir <code className="font-mono">Module-Failure-Message</code> en{' '}
        <code className="font-mono">radpostauth.class</code>.
      </p>
    </div>
  );
}

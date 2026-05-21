'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { hasPermission } from '@/lib/session';
import { usersApi, type UserResponse } from '@/lib/users-api';
import type { Paginated } from '@/lib/crm-types';
import { formatDateTime } from '@/lib/format';

const STATUS_TONE: Record<UserResponse['status'], 'success' | 'warning' | 'info' | 'danger'> = {
  ACTIVE: 'success',
  INVITED: 'info',
  SUSPENDED: 'warning',
  DISABLED: 'danger',
};

/**
 * /settings/users — gestão de usuários do tenant.
 *
 * Permissão: `users.read` pra ver, `users.create` pra criar, `users.update`
 * pra editar. Lista todos os usuários ativos + soft-deleted (filtro por
 * status pode vir depois). Busca por nome/email.
 */
export default function UsersListPage() {
  const tCommon = useTranslations('common');
  const tUsers = useTranslations('users');
  const tList = useTranslations('users.list');
  const tStatus = useTranslations('users.statusLabel');
  const canCreate = hasPermission('users.create');
  const canUpdate = hasPermission('users.update');

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const key = usersApi.listPath({ page, pageSize, search: search || undefined });
  const { data, isLoading, error } = useSWR<Paginated<UserResponse>>(key);

  if (isLoading && !data) return <PageLoader label={tCommon('loading')} />;
  if (error) {
    return (
      <p className="text-sm text-red-600">Falha ao carregar usuários.</p>
    );
  }

  const rows = data?.data ?? [];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{tUsers('title')}</h1>
          <p className="text-sm text-text-muted">{tUsers('subtitle')}</p>
        </div>
        {canCreate && (
          <Link href="/settings/users/new">
            <Button>
              <Plus className="h-3.5 w-3.5" />
              {tUsers('new')}
            </Button>
          </Link>
        )}
      </header>

      <div className="flex items-center gap-2">
        <Input
          placeholder={tCommon('search')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="max-w-sm"
        />
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <tr>
              <th className="px-3 py-2">{tList('cols.name')}</th>
              <th className="px-3 py-2">{tList('cols.email')}</th>
              <th className="px-3 py-2">{tList('cols.roles')}</th>
              <th className="px-3 py-2">{tList('cols.status')}</th>
              <th className="px-3 py-2">{tList('cols.lastLogin')}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-text-muted">
                  {tList('empty')}
                </td>
              </tr>
            ) : (
              rows.map((u) => (
                <tr key={u.id} className="hover:bg-surface-hover">
                  <td className="px-3 py-2 font-medium text-text">
                    {u.firstName} {u.lastName}
                  </td>
                  <td className="px-3 py-2 text-text-muted">{u.email}</td>
                  <td className="px-3 py-2 text-text-muted">
                    {u.roles.map((r) => r.name).join(', ') || '—'}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS_TONE[u.status]}>
                      {tStatus(u.status as 'ACTIVE')}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-text-subtle">
                    {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canUpdate ? (
                      <Link
                        href={`/settings/users/${u.id}`}
                        className="text-xs font-medium text-accent hover:underline"
                      >
                        {tCommon('edit')} →
                      </Link>
                    ) : (
                      <span className="text-xs text-text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Paginação simples */}
      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-text-muted">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            ←
          </Button>
          <span>
            {data.pagination.page} / {data.pagination.totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= data.pagination.totalPages}
          >
            →
          </Button>
        </div>
      )}
    </div>
  );
}

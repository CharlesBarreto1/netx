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
  const tNav = useTranslations('nav');
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
          <h1 className="text-2xl font-bold tracking-tight">{tNav('users')}</h1>
          <p className="text-sm text-text-muted">
            Convide ou edite a equipe da operação. Cada usuário tem um papel
            (Operador / Administrador) e uma lista de menus visíveis.
          </p>
        </div>
        {canCreate && (
          <Link href="/settings/users/new">
            <Button>
              <Plus className="h-3.5 w-3.5" />
              Novo usuário
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

      <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Papéis</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Último acesso</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-text-muted">
                  Nenhum usuário encontrado.
                </td>
              </tr>
            ) : (
              rows.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                  <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-100">
                    {u.firstName} {u.lastName}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{u.email}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                    {u.roles.map((r) => r.name).join(', ') || '—'}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS_TONE[u.status]}>{u.status}</Badge>
                  </td>
                  <td className="px-3 py-2 text-slate-500">
                    {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canUpdate ? (
                      <Link
                        href={`/settings/users/${u.id}`}
                        className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-300"
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

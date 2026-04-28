'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR, { useSWRConfig } from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { UserForm } from '@/components/users/UserForm';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import { usersApi, type UserResponse } from '@/lib/users-api';
import { formatDateTime } from '@/lib/format';

const STATUS_TONE: Record<UserResponse['status'], 'success' | 'warning' | 'info' | 'danger'> = {
  ACTIVE: 'success',
  INVITED: 'info',
  SUSPENDED: 'warning',
  DISABLED: 'danger',
};

export default function EditUserPage() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const params = useParams<{ id: string }>();
  const tCommon = useTranslations('common');
  const id = params?.id;
  const canDelete = hasPermission('users.delete');

  const key = id ? usersApi.getPath(id) : null;
  const { data: user, isLoading, error } = useSWR<UserResponse>(key);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (isLoading || !user) return <PageLoader label={tCommon('loading')} />;
  if (error) {
    const msg =
      error instanceof ApiError ? error.friendlyMessage : (error as Error).message;
    return <p className="text-sm text-red-600">{msg}</p>;
  }

  async function handleDelete() {
    if (!user) return;
    setDeleting(true);
    try {
      await usersApi.remove(user.id);
      toast.success(tCommon('success'));
      router.replace('/settings/users');
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.friendlyMessage : 'Falha ao excluir usuário';
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <nav className="text-xs text-slate-500 dark:text-slate-400">
          <Link href="/settings/users" className="hover:underline">
            Usuários
          </Link>{' '}
          › {user.firstName} {user.lastName}
        </nav>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">
                {user.firstName} {user.lastName}
              </h1>
              <Badge tone={STATUS_TONE[user.status]}>{user.status}</Badge>
              {user.menuAccess !== null && user.menuAccess !== undefined && (
                <Badge tone="warning">Menu restrito</Badge>
              )}
            </div>
            <p className="text-sm text-text-muted">{user.email}</p>
            <p className="text-xs text-text-muted">
              Último acesso:{' '}
              {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'nunca'}
            </p>
          </div>
          {canDelete && (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              {tCommon('delete')}
            </Button>
          )}
        </div>
      </header>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <UserForm
          mode="edit"
          initial={user}
          onSuccess={async (saved) => {
            toast.success(tCommon('success'));
            // Revalida a página + qualquer lista cacheada.
            if (key) await mutate(key, saved, false);
          }}
          onCancel={() => router.push('/settings/users')}
        />
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Excluir usuário"
        message={`Tem certeza que quer excluir "${user.firstName} ${user.lastName}"? O acesso é desabilitado imediatamente (soft-delete; histórico preservado).`}
        confirmLabel={tCommon('delete')}
        variant="danger"
        loading={deleting}
      />
    </div>
  );
}

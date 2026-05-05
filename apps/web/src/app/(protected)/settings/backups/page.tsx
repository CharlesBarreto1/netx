'use client';

import { Download, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { backupsApi, type Backup, type BackupStatus } from '@/lib/backups-api';
import { formatDateTime } from '@/lib/format';
import { hasPermission } from '@/lib/session';

const STATUS_TONE: Record<
  BackupStatus,
  'info' | 'warning' | 'success' | 'danger'
> = {
  PENDING: 'info',
  RUNNING: 'warning',
  COMPLETED: 'success',
  FAILED: 'danger',
};

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? '/api').replace(/\/$/, '');

/**
 * /settings/backups — disparo manual + lista + download.
 *
 * Sobre a poling: enquanto houver backup RUNNING/PENDING, recarregamos a
 * lista a cada 5s pra refletir o término. Quando todos completos, o SWR
 * volta ao default de revalidate em focus.
 */
export default function BackupsPage() {
  const t = useTranslations('backups');
  const tCommon = useTranslations('common');
  const canManage = hasPermission('backups.manage');

  const { data, isLoading, mutate } = useSWR<Backup[]>(backupsApi.listPath(), {
    refreshInterval: (latest) => {
      const arr = latest as Backup[] | undefined;
      const pending = arr?.some(
        (b) => b.status === 'RUNNING' || b.status === 'PENDING',
      );
      return pending ? 5000 : 0;
    },
  });

  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Backup | null>(null);

  if (isLoading || !data) return <PageLoader label={tCommon('loading')} />;

  async function handleCreate() {
    setCreating(true);
    try {
      await backupsApi.create();
      toast.success(t('createdToast'));
      await mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : 'Erro');
    } finally {
      setCreating(false);
    }
  }

  /**
   * Download autenticado: fetch com Authorization header → blob → trigger
   * <a download>. Não dá pra usar <a href> direto porque o token está em
   * localStorage e não vai como query param (segurança).
   */
  async function handleDownload(b: Backup) {
    const token = localStorage.getItem('netx.accessToken');
    if (!token) {
      toast.error('Sessão expirada — refaça login');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}${backupsApi.downloadPath(b.id)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = b.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(`Falha no download: ${(err as Error).message}`);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-text-muted">{t('subtitle')}</p>
        </div>
        {canManage && (
          <Button onClick={handleCreate} loading={creating}>
            {t('create')}
          </Button>
        )}
      </header>

      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <tr>
              <th className="px-3 py-2">{t('filename')}</th>
              <th className="px-3 py-2">{tCommon('status')}</th>
              <th className="px-3 py-2">{t('size')}</th>
              <th className="px-3 py-2">{tCommon('createdAt')}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-text-muted">
                  {tCommon('nothingHere')}
                </td>
              </tr>
            ) : (
              data.map((b) => (
                <tr key={b.id}>
                  <td className="px-3 py-2 font-mono text-xs text-text">
                    {b.filename}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS_TONE[b.status]}>{b.status}</Badge>
                    {b.errorMessage && (
                      <div className="mt-1 max-w-md truncate text-2xs text-red-600 dark:text-red-400">
                        {b.errorMessage}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-text-muted">
                    {b.sizeBytes ? formatBytes(b.sizeBytes) : '—'}
                  </td>
                  <td className="px-3 py-2 text-text-muted">
                    {formatDateTime(b.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      {b.status === 'COMPLETED' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDownload(b)}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {canManage && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleting(b)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await backupsApi.remove(deleting.id);
            toast.success(tCommon('success'));
            setDeleting(null);
            await mutate();
          } catch (err) {
            toast.error(err instanceof ApiError ? err.friendlyMessage : 'Erro');
          }
        }}
        title={t('deleteTitle')}
        message={t('deleteMessage')}
        confirmLabel={tCommon('delete')}
        variant="danger"
      />
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

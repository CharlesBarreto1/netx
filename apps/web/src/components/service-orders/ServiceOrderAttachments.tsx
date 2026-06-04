'use client';

/**
 * Anexos avulsos da O.S — upload direto pro MinIO (presign → PUT → registra).
 * Reusado na tela admin (/service-orders/[id]) e na do técnico (/os/[id]).
 * Distinto das fotos de fechamento (essas vão no fluxo de complete-field).
 */
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  serviceOrdersApi,
  type ServiceOrderAttachmentResponse,
} from '@/lib/service-orders-api';
import { formatDateTime } from '@/lib/format';

function humanSize(bytes: number | null): string {
  if (bytes == null) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i > 0 && n < 10 ? 1 : 0)} ${units[i]}`;
}

export function ServiceOrderAttachments({
  serviceOrderId,
  canWrite,
}: {
  serviceOrderId: string;
  canWrite: boolean;
}) {
  const t = useTranslations('serviceOrderThread');
  const { data, isLoading, mutate } = useSWR<ServiceOrderAttachmentResponse[]>(
    serviceOrdersApi.attachmentsPath(serviceOrderId),
    () => serviceOrdersApi.listAttachments(serviceOrderId),
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [toDelete, setToDelete] = useState<ServiceOrderAttachmentResponse | null>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const { uploadUrl, storageKey } = await serviceOrdersApi.presignAttachment(
        serviceOrderId,
        file.name,
        file.type || undefined,
      );
      const put = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: file.type ? { 'Content-Type': file.type } : {},
      });
      if (!put.ok) throw new Error(t('uploadStatus', { status: put.status }));
      await serviceOrdersApi.registerAttachment(serviceOrderId, {
        storageKey,
        fileName: file.name,
        contentType: file.type || null,
        sizeBytes: file.size,
      });
      await mutate();
      toast.success(t('attachUploaded'));
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.friendlyMessage
          : err instanceof Error
            ? err.message
            : t('attachFailed'),
      );
    } finally {
      setUploading(false);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setBusy(true);
    try {
      await serviceOrdersApi.removeAttachment(serviceOrderId, toDelete.id);
      setToDelete(null);
      await mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : t('attachFailed'));
    } finally {
      setBusy(false);
    }
  }

  const items = data ?? [];

  return (
    <div className="space-y-3">
      {canWrite && (
        <div>
          <input ref={fileRef} type="file" className="hidden" onChange={onPick} />
          <Button
            variant="outline"
            size="sm"
            loading={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {t('attachAdd')}
          </Button>
        </div>
      )}

      {isLoading && !data ? (
        <Spinner />
      ) : items.length === 0 ? (
        <p className="text-sm italic text-text-muted">{t('attachEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {items.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                {a.url ? (
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-sm text-brand-500 hover:underline"
                  >
                    {a.fileName}
                  </a>
                ) : (
                  <span className="block truncate text-sm text-text">{a.fileName}</span>
                )}
                <span className="text-2xs text-text-muted">
                  {[
                    humanSize(a.sizeBytes),
                    a.createdBy
                      ? `${a.createdBy.firstName} ${a.createdBy.lastName}`
                      : null,
                    formatDateTime(a.createdAt),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => setToDelete(a)}
                  className="shrink-0 text-xs text-red-500 hover:underline"
                >
                  {t('attachRemove')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
        title={t('attachRemoveTitle')}
        message={t('attachRemoveMsg')}
        confirmLabel={t('attachRemove')}
        variant="danger"
        loading={busy}
      />
    </div>
  );
}

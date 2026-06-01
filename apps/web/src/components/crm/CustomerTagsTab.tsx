'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/Spinner';
import { api } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import type { CustomerTag, CustomerTagLite } from '@/lib/crm-types';

export function CustomerTagsTab({
  customerId,
  assigned,
  onChanged,
}: {
  customerId: string;
  assigned: CustomerTagLite[];
  onChanged: () => void | Promise<unknown>;
}) {
  const { data: allTags, isLoading } = useSWR<CustomerTag[]>('/v1/crm/tags');
  const canWrite = hasPermission('customers.tags.manage');
  const [busy, setBusy] = useState<string | null>(null);
  const t = useTranslations('crmTabs');

  const assignedIds = new Set(assigned.map((a) => a.id));
  const available = (allTags ?? []).filter((tag) => !assignedIds.has(tag.id));

  async function assign(tagId: string) {
    setBusy(tagId);
    try {
      await api.post(`/v1/customers/${customerId}/tags`, { tagIds: [tagId] });
      await onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function remove(tagId: string) {
    setBusy(tagId);
    try {
      await api.delete(`/v1/customers/${customerId}/tags/${tagId}`);
      await onChanged();
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
          {t('tags.appliedTitle', { count: assigned.length })}
        </h3>
        {assigned.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('tags.noneApplied')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {assigned.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                {tag.color && (
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                )}
                <span>{tag.name}</span>
                {canWrite && (
                  <button
                    type="button"
                    className="text-slate-400 hover:text-red-600 disabled:opacity-50"
                    onClick={() => remove(tag.id)}
                    disabled={busy === tag.id}
                    aria-label={t('tags.removeAria', { name: tag.name })}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </section>

      {canWrite && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t('tags.availableTitle')}
          </h3>
          {available.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('tags.noneAvailable')}{' '}
              <a href="/crm/tags" className="text-brand-700 hover:underline dark:text-brand-300">
                {t('tags.tagsLink')}
              </a>
              .
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {available.map((tag) => (
                <Button
                  key={tag.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy === tag.id}
                  onClick={() => assign(tag.id)}
                >
                  {tag.color && (
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                  )}
                  + {tag.name}
                </Button>
              ))}
            </div>
          )}
        </section>
      )}

      {assigned.length > 0 && (
        <div className="pt-2">
          <Badge tone="info">{t('tags.tip')}</Badge>
          <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
            {t('tags.manageCatalog')}{' '}
            <a href="/crm/tags" className="underline">
              /crm/tags
            </a>
            .
          </span>
        </div>
      )}
    </div>
  );
}

'use client';

/**
 * Thread de mensagens da O.S — atendente ↔ técnico. Reusado na tela admin
 * (/service-orders/[id]) e na tela do técnico (/os/[id]).
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  serviceOrdersApi,
  type ServiceOrderMessageResponse,
} from '@/lib/service-orders-api';
import { formatDateTime } from '@/lib/format';

export function ServiceOrderMessages({
  serviceOrderId,
  canWrite,
}: {
  serviceOrderId: string;
  canWrite: boolean;
}) {
  const t = useTranslations('serviceOrderThread');
  const { data, isLoading, mutate } = useSWR<ServiceOrderMessageResponse[]>(
    serviceOrdersApi.messagesPath(serviceOrderId),
    () => serviceOrdersApi.listMessages(serviceOrderId),
  );
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  async function send() {
    const text = body.trim();
    if (!text) return;
    setSending(true);
    try {
      const msg = await serviceOrdersApi.addMessage(serviceOrderId, text);
      setBody('');
      await mutate((prev) => [...(prev ?? []), msg], { revalidate: false });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : t('sendFailed'));
    } finally {
      setSending(false);
    }
  }

  const messages = data ?? [];

  return (
    <div className="space-y-3">
      {isLoading && !data ? (
        <Spinner />
      ) : messages.length === 0 ? (
        <p className="text-sm italic text-text-muted">{t('empty')}</p>
      ) : (
        <ul className="max-h-80 space-y-2 overflow-y-auto">
          {messages.map((m) => (
            <li key={m.id} className="rounded-md border border-border bg-bg-soft p-2">
              <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
                <span className="font-medium text-text">
                  {m.author
                    ? `${m.author.firstName} ${m.author.lastName}`
                    : t('systemAuthor')}
                </span>
                <span>{formatDateTime(m.createdAt)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-text">{m.body}</p>
            </li>
          ))}
        </ul>
      )}

      {canWrite && (
        <div className="flex items-start gap-2">
          <Textarea
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('placeholder')}
            className="flex-1"
          />
          <Button onClick={send} loading={sending} disabled={!body.trim()}>
            {t('send')}
          </Button>
        </div>
      )}
    </div>
  );
}

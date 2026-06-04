'use client';

/**
 * Edição de uma O.S aberta errada (motivo, agendamento, descrição, cidade).
 * Reusa PATCH /service-orders/:id. Técnico designado é trocado pelo botão
 * "Trocar" da própria tela de detalhe (não aqui).
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FieldError, Input, Label, Select, Textarea } from '@/components/ui/Input';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  serviceOrdersApi,
  serviceOrderReasonsApi,
  type ServiceOrderReasonResponse,
  type ServiceOrderResponse,
} from '@/lib/service-orders-api';

/** ISO → valor de <input type="datetime-local"> no fuso local. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function EditServiceOrderDialog({
  os,
  onClose,
  onUpdated,
}: {
  os: ServiceOrderResponse;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const t = useTranslations('serviceOrders.form');
  const tc = useTranslations('common');
  const { data: reasons } = useSWR<ServiceOrderReasonResponse[]>(
    serviceOrderReasonsApi.path(false),
  );

  const [reasonId, setReasonId] = useState(os.reasonId);
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(os.scheduledAt));
  const [openDescription, setOpenDescription] = useState(os.openDescription);
  const [city, setCity] = useState(os.city ?? '');
  const [state, setState] = useState(os.state ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!reasonId || !openDescription.trim()) {
      setError(t('requiredFields'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await serviceOrdersApi.update(os.id, {
        reasonId,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        openDescription: openDescription.trim(),
        city: city.trim() || null,
        state: state.trim() || null,
      });
      toast.success(tc('success'));
      onUpdated();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={submitting ? () => {} : onClose}
      title={t('editTitle')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {tc('cancel')}
          </Button>
          <Button onClick={save} loading={submitting}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="edit-so-reason" required>
            {t('reason')}
          </Label>
          <Select
            id="edit-so-reason"
            value={reasonId}
            onChange={(e) => setReasonId(e.target.value)}
          >
            {(reasons ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="edit-so-scheduled">{t('scheduledAt')}</Label>
          <Input
            id="edit-so-scheduled"
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="edit-so-city">{t('city')}</Label>
            <Input
              id="edit-so-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="edit-so-state">{t('state')}</Label>
            <Input
              id="edit-so-state"
              value={state}
              onChange={(e) => setState(e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="edit-so-open" required>
            {t('openDescription')}
          </Label>
          <Textarea
            id="edit-so-open"
            rows={4}
            value={openDescription}
            onChange={(e) => setOpenDescription(e.target.value)}
          />
        </div>

        {error && <FieldError>{error}</FieldError>}
      </div>
    </Modal>
  );
}

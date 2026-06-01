'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldHelp, Input, Label, Textarea } from '@/components/ui/Input';
import { ApiError } from '@/lib/api';

/**
 * PostponeDialog — prorroga vencimento da fatura sem dar baixa.
 *
 * Casos de uso:
 *   - Cliente pediu prazo extra ("paga semana que vem")
 *   - Atendente errou data e precisa corrigir
 *   - Renegociação informal
 *
 * Se contrato estava SUSPENDED por OVERDUE_PAYMENT e essa era a única
 * fatura vencida, backend reativa o contrato automaticamente.
 */
export interface PostponeDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentDueDate: string;
  description?: string;
  onConfirm: (newDueDate: string, note?: string) => Promise<void>;
}

export function PostponeDialog({
  open,
  onOpenChange,
  currentDueDate,
  description,
  onConfirm,
}: PostponeDialogProps) {
  const t = useTranslations('financeDialogs');
  const tc = useTranslations('common');
  const [newDate, setNewDate] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      // Default: 7 dias após vencimento atual.
      const d = new Date(currentDueDate);
      d.setDate(d.getDate() + 7);
      setNewDate(d.toISOString().slice(0, 10));
      setNote('');
      setError(null);
    }
  }, [open, currentDueDate]);

  const isValid = newDate && newDate > currentDueDate.slice(0, 10);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) {
      setError(t('postpone.dateError'));
      return;
    }
    setSubmitting(true);
    try {
      await onConfirm(newDate, note.trim() || undefined);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('postpone.title')}</DialogTitle>
            {description && (
              <p className="mt-1 text-xs text-text-muted">{description}</p>
            )}
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="text-sm">
              <span className="text-text-muted">{t('postpone.currentDueDate')}</span>{' '}
              <span className="font-medium">{currentDueDate.slice(0, 10)}</span>
            </div>
            <div>
              <Label htmlFor="postpone-date" required>
                {t('postpone.newDueDateLabel')}
              </Label>
              <Input
                id="postpone-date"
                type="date"
                value={newDate}
                min={currentDueDate.slice(0, 10)}
                onChange={(e) => setNewDate(e.target.value)}
                autoFocus
              />
              <FieldHelp>{t('postpone.newDueDateHelp')}</FieldHelp>
            </div>
            <div>
              <Label htmlFor="postpone-note">{t('postpone.noteLabel')}</Label>
              <Textarea
                id="postpone-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('postpone.notePlaceholder')}
              />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={submitting} disabled={!isValid}>
              {t('postpone.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

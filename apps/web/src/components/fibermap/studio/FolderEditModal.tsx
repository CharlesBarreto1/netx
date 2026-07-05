'use client';

/**
 * FolderEditModal — criar / renomear pasta do FiberMap.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * `initial` com `id` = renomear; sem `id` = criar (raiz ou subpasta,
 * conforme parentId). Erros do backend (ex.: nome duplicado) aparecem
 * inline via ApiError.friendlyMessage.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/Button';
import { FieldError, Input, Label } from '@/components/ui/Input';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { fibermapApi, type FibermapFolder } from '@/lib/fibermap-api';

import { StudioModal } from './StudioModal';

interface FolderEditModalProps {
  initial: FibermapFolder | { parentId: string | null };
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export function FolderEditModal({ initial, onClose, onSaved }: FolderEditModalProps) {
  const t = useTranslations('fibermap');
  const tc = useTranslations('common');
  const existing = 'id' in initial ? initial : null;
  const [name, setName] = useState(existing?.name ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('studio.form.errorNameRequired'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (existing) {
        await fibermapApi.updateFolder(existing.id, { name: trimmed });
        toast.success(t('studio.folderForm.renamed'));
      } else {
        await fibermapApi.createFolder({
          name: trimmed,
          parentId: initial.parentId,
        });
        toast.success(t('studio.folderForm.created'));
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <StudioModal
      title={
        existing
          ? t('studio.folderForm.renameTitle', { name: existing.name })
          : t('studio.folderForm.createTitle')
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {tc('cancel')}
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            {existing ? tc('save') : tc('create')}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <Label required>{tc('name')}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('studio.folderForm.namePlaceholder')}
            autoFocus
          />
        </div>
        <FieldError>{error}</FieldError>
      </form>
    </StudioModal>
  );
}

'use client';

/**
 * StudioModal / StudioConfirm — modais do estúdio FiberMap.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Mesmo padrão do estúdio /mapa: z-[2000] pra ficar acima do mapa e do
 * drawer de detalhe (z-[1600]). O <Modal> de components/ui usa z-50, que
 * ficaria por baixo do drawer — por isso o primitivo local.
 */
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/Button';

export function StudioModal({
  title,
  onClose,
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  // Esc fecha — o handler global do estúdio ignora Esc enquanto um modal
  // está aberto (guard em FibermapStudio), então não há dupla ação.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-950/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-md border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border bg-surface-muted px-4 py-3">
          <h3 className="text-base font-semibold text-text">{title}</h3>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-4">{children}</div>
        <div className="flex justify-end gap-2 border-t border-border bg-surface-muted px-4 py-3">
          {footer}
        </div>
      </div>
    </div>
  );
}

/** Confirmação (destrutiva ou neutra) com o z-index do estúdio. */
export function StudioConfirm({
  title,
  message,
  confirmLabel,
  danger,
  loading,
  onClose,
  onConfirm,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const tc = useTranslations('common');
  return (
    <StudioModal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {tc('cancel')}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => void onConfirm()}
            loading={loading}
          >
            {confirmLabel ?? tc('confirm')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text">{message}</p>
    </StudioModal>
  );
}

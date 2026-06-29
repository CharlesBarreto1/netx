'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { Button } from './Button';

type Size = 'sm' | 'md' | 'lg' | 'xl';

const sizeClass: Record<Size, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

/**
 * Dialog modal simples (sem portal; confiamos em z-index alto).
 * Fecha com Esc e clique no backdrop. Trava scroll do body enquanto aberto.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  children,
  footer,
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  size?: Size;
  children: React.ReactNode;
  footer?: React.ReactNode;
  dismissable?: boolean;
}) {
  const tCommon = useTranslations('common');
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && dismissable) onClose();
    }
    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, dismissable, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
      // items-center centraliza quando cabe; quando o conteúdo é alto, o
      // overflow-y-auto do container + max-h do painel garantem scroll.
      // p-4 dá respiro nas bordas (importante em mobile).
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4"
    >
      <button
        type="button"
        aria-label={tCommon('close')}
        tabIndex={-1}
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={dismissable ? onClose : undefined}
      />
      <div
        ref={dialogRef}
        className={cn(
          // flex-col + max-h: header/footer fixos, corpo rola.
          // 100dvh-2rem desconta o p-4 do container (2rem total).
          'relative z-10 my-auto flex max-h-[calc(100dvh-2rem)] w-full flex-col ' +
            'rounded-xl bg-white shadow-xl dark:bg-slate-800',
          sizeClass[size],
        )}
      >
        {(title || description) && (
          <div className="shrink-0 border-b border-slate-200 px-6 py-4 dark:border-slate-700">
            {title && (
              <h2
                id="modal-title"
                className="text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
            )}
          </div>
        )}
        {/* Corpo: flex-1 + overflow-y-auto = a área que rola. */}
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-2 rounded-b-xl border-t border-slate-200 bg-slate-50 px-6 py-3 dark:border-slate-700 dark:bg-slate-900/40">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** Caixa de confirmação pronta (destrutiva ou neutra). */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'primary',
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title?: React.ReactNode;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
  loading?: boolean;
}) {
  const tCommon = useTranslations('common');
  const resolvedTitle = title ?? tCommon('confirm');
  const resolvedConfirmLabel = confirmLabel ?? tCommon('confirm');
  const resolvedCancelLabel = cancelLabel ?? tCommon('cancel');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={resolvedTitle}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {resolvedCancelLabel}
          </Button>
          <Button variant={variant} onClick={() => void onConfirm()} loading={loading}>
            {resolvedConfirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-700 dark:text-slate-200">{message}</p>
    </Modal>
  );
}

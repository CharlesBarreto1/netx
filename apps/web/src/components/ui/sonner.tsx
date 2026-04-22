'use client';

import { Toaster as Sonner, toast } from 'sonner';

/**
 * Toaster — wrapper do sonner com tokens NetX (light/dark automáticos).
 * Monte uma única vez no AppShell; depois use `toast.success(...)`,
 * `toast.error(...)`, `toast.promise(...)`.
 */
export function Toaster({
  theme,
  ...props
}: React.ComponentProps<typeof Sonner>) {
  return (
    <Sonner
      theme={theme ?? 'system'}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast border border-border bg-surface text-text shadow-pop ' +
            '!rounded-md !text-sm',
          description: 'group-[.toast]:text-text-muted',
          actionButton:
            'group-[.toast]:bg-accent group-[.toast]:text-accent-foreground ' +
            '!rounded !px-2 !h-7 !text-xs font-semibold',
          cancelButton:
            'group-[.toast]:bg-surface-muted group-[.toast]:text-text-muted ' +
            '!rounded !px-2 !h-7 !text-xs',
          success: 'group-[.toaster]:!text-success',
          error: 'group-[.toaster]:!text-danger',
          warning: 'group-[.toaster]:!text-warning',
        },
      }}
      {...props}
    />
  );
}

export { toast };

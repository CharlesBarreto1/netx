/**
 * notify — wrapper unificado sobre sonner com presets NetX + ícones Lucide.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Por que existir:
 *   - Centraliza textos de erro recorrentes (`notify.apiError(e)` cobre ApiError + Error).
 *   - Garante ícones/cores consistentes em toda a app (`success` verde + Check, etc).
 *   - Facilita futura troca de lib (radix-toast, etc) — só este arquivo precisa mudar.
 *
 * Uso:
 *   notify.success('Cliente criado');
 *   notify.error('Falha ao salvar');
 *   notify.apiError(e);                              // pega ApiError.friendlyMessage
 *   notify.promise(promise, { loading, success, error });
 */
import { toast } from 'sonner';
import { Check, CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import { createElement } from 'react';

import { ApiError } from './api';

const icons = {
  success: () => createElement(Check, { className: 'h-4 w-4 text-success' }),
  error:   () => createElement(X, { className: 'h-4 w-4 text-danger' }),
  warning: () => createElement(TriangleAlert, { className: 'h-4 w-4 text-warning' }),
  info:    () => createElement(Info, { className: 'h-4 w-4 text-info' }),
  alert:   () => createElement(CircleAlert, { className: 'h-4 w-4 text-text-muted' }),
};

export const notify = {
  success(message: string, opts?: { description?: string }) {
    return toast.success(message, { ...opts, icon: icons.success() });
  },
  error(message: string, opts?: { description?: string }) {
    return toast.error(message, { ...opts, icon: icons.error() });
  },
  warning(message: string, opts?: { description?: string }) {
    return toast.warning(message, { ...opts, icon: icons.warning() });
  },
  info(message: string, opts?: { description?: string }) {
    return toast.info(message, { ...opts, icon: icons.info() });
  },
  message(message: string, opts?: { description?: string }) {
    return toast(message, { ...opts, icon: icons.alert() });
  },
  /**
   * Apresenta erro de chamada de API de forma uniforme. Lê
   * `ApiError.friendlyMessage` se disponível, com fallback gracioso.
   */
  apiError(err: unknown, fallback = 'Falha na operação') {
    const message =
      err instanceof ApiError
        ? err.friendlyMessage
        : err instanceof Error
          ? err.message
          : fallback;
    return toast.error(message, { icon: icons.error() });
  },
  /**
   * Promise toast — mostra "loading" enquanto roda, troca pra success/error
   * ao terminar. Aceita as mesmas strings que o sonner.promise.
   */
  promise<T>(
    promise: Promise<T>,
    msgs: {
      loading: string;
      success: string | ((data: T) => string);
      error: string | ((err: unknown) => string);
    },
  ) {
    return toast.promise(promise, msgs);
  },
};

export { toast };

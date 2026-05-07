'use client';

import { useEffect, useRef } from 'react';

export type WaStreamEvent =
  | 'message.created'
  | 'message.updated'
  | 'conversation.created'
  | 'conversation.updated'
  | 'conversation.assigned'
  | 'conversation.resolved'
  | 'instance.updated';

export interface WaStreamPayload {
  type: WaStreamEvent;
  payload: Record<string, unknown>;
}

const ACCESS_TOKEN_KEY = 'netx.accessToken';

/**
 * Conecta-se ao endpoint SSE `/api/v1/whatsapp/stream` e despacha eventos
 * pro callback. Reconecta automaticamente em caso de queda (EventSource
 * já faz isso, mas garantimos cleanup correto no useEffect).
 *
 * EventSource não suporta header customizado nativo — então autenticamos
 * via query string `?token=` (mesmo padrão usado em outros endpoints SSE
 * do NetX). O backend valida o JWT igual ao header.
 *
 * Se o token mudar (refresh), o effect re-roda e reabre conexão.
 */
export function useWhatsappStream(
  enabled: boolean,
  onEvent: (e: WaStreamPayload) => void,
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    const token = localStorage.getItem(ACCESS_TOKEN_KEY);
    if (!token) return;

    const base = (process.env.NEXT_PUBLIC_API_URL ?? '/api').replace(/\/$/, '');
    const url = `${base}/v1/whatsapp/stream?access_token=${encodeURIComponent(token)}`;

    let es: EventSource | null = null;
    try {
      es = new EventSource(url);
    } catch (e) {
      console.warn('[whatsapp] SSE init falhou', e);
      return;
    }

    const handler = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as WaStreamPayload;
        onEventRef.current(data);
      } catch (e) {
        console.warn('[whatsapp] SSE bad payload', e);
      }
    };

    // Servidor manda os eventos como named events, ouvimos os 6 conhecidos
    const eventNames: WaStreamEvent[] = [
      'message.created',
      'message.updated',
      'conversation.created',
      'conversation.updated',
      'conversation.assigned',
      'conversation.resolved',
      'instance.updated',
    ];
    eventNames.forEach((name) => es!.addEventListener(name, handler));

    es.onerror = (e) => {
      console.debug('[whatsapp] SSE error (vai reconectar)', e);
    };

    return () => {
      eventNames.forEach((name) => es!.removeEventListener(name, handler));
      es!.close();
    };
  }, [enabled]);
}

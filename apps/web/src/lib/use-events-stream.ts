'use client';

/**
 * useEventsStream — assina o feed SSE de eventos do tenant (GET /v1/events/stream).
 * Serve o NEXUS (rail de IA) e qualquer tela que queira reagir ao vivo a
 * contratos/faturas/ONT. EventSource não seta header → auth por ?access_token=.
 * Espelha o padrão de lib/use-whatsapp-stream.ts.
 *
 * Uso:
 *   useEventsStream(true, ['netx-erp.contract.created', 'netx-cpe.ont.down'], (name, e) => {...});
 */
import { useEffect, useRef } from 'react';

const ACCESS_TOKEN_KEY = 'netx.accessToken';

export interface FeedEvent {
  type: string;
  source?: string;
  at?: string;
  payload?: unknown;
}

export function useEventsStream(
  enabled: boolean,
  eventNames: string[],
  onEvent: (name: string, e: FeedEvent) => void,
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const token = localStorage.getItem(ACCESS_TOKEN_KEY);
    if (!token) return;

    const base = (process.env.NEXT_PUBLIC_API_URL ?? '/api').replace(/\/$/, '');
    const url = `${base}/v1/events/stream?access_token=${encodeURIComponent(token)}`;

    let es: EventSource | null = null;
    try {
      es = new EventSource(url);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[events] SSE init falhou', e);
      return;
    }

    const make = (name: string) => (ev: MessageEvent) => {
      try {
        onEventRef.current(name, JSON.parse(ev.data) as FeedEvent);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[events] payload SSE inválido', e);
      }
    };
    const handlers = eventNames.map((n) => [n, make(n)] as const);
    handlers.forEach(([n, h]) => es!.addEventListener(n, h));
    es.onerror = (e) => {
      // EventSource reconecta sozinho; só loga.
      // eslint-disable-next-line no-console
      console.debug('[events] SSE erro (vai reconectar)', e);
    };

    return () => {
      handlers.forEach(([n, h]) => es!.removeEventListener(n, h));
      es!.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, eventNames.join(',')]);
}

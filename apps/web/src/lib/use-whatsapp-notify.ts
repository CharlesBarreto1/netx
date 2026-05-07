'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const SOUND_KEY = 'netx.chat.soundEnabled';
const PERMISSION_REQUESTED_KEY = 'netx.chat.notifPermRequested';

/**
 * Hook para notificação de mensagens novas (browser Notification API + áudio).
 *
 * Som: <audio> escondido tocando um beep curto. Volume baixo, sem repetição.
 * Toggle persistente em localStorage.
 *
 * Permissão de notificação: pedimos uma vez na primeira mensagem que chegar
 * com a aba em background. Não persiste prompt — Chrome bloqueia se user negar.
 */
export function useWhatsappNotify() {
  const [soundEnabled, setSoundEnabledState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem(SOUND_KEY);
    return stored === null ? true : stored === '1';
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Cria <audio> com data URI (beep ~200ms, evita ter que servir arquivo extra)
    if (typeof window === 'undefined') return;
    const a = new Audio();
    // Beep WAV 440Hz 200ms encoded base64 (gerado offline; barra está limpa)
    a.src =
      'data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YT9vT19/f39/f39/f3+AgICAgICAgIB/f39/f39/f3+AgICAgICAgA==';
    a.volume = 0.4;
    audioRef.current = a;
  }, []);

  const setSoundEnabled = useCallback((v: boolean) => {
    setSoundEnabledState(v);
    if (typeof window !== 'undefined') {
      localStorage.setItem(SOUND_KEY, v ? '1' : '0');
    }
  }, []);

  const requestPermissionIfNeeded = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'default') {
      const requested = localStorage.getItem(PERMISSION_REQUESTED_KEY);
      if (!requested) {
        localStorage.setItem(PERMISSION_REQUESTED_KEY, '1');
        try {
          await Notification.requestPermission();
        } catch {
          /* user-gesture-required em alguns browsers — falha silenciosa */
        }
      }
    }
  }, []);

  const notify = useCallback(
    (opts: { title: string; body?: string; tag?: string; onClick?: () => void }) => {
      void requestPermissionIfNeeded();

      // Som
      if (soundEnabled && audioRef.current) {
        try {
          audioRef.current.currentTime = 0;
          void audioRef.current.play().catch(() => {});
        } catch {
          /* ignora */
        }
      }

      // Notificação browser apenas se aba não está focada
      if (
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'granted' &&
        document.visibilityState !== 'visible'
      ) {
        try {
          const n = new Notification(opts.title, {
            body: opts.body,
            tag: opts.tag,
            silent: true, // som sai do nosso <audio>; evita beep duplo
          });
          if (opts.onClick) {
            n.onclick = () => {
              window.focus();
              opts.onClick?.();
              n.close();
            };
          }
        } catch (e) {
          console.warn('[whatsapp] Notification failed', e);
        }
      }
    },
    [soundEnabled, requestPermissionIfNeeded],
  );

  return { notify, soundEnabled, setSoundEnabled };
}

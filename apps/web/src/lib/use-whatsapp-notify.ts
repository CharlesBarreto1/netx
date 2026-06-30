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

  // Som via Web Audio API (oscilador) — não depende de arquivo/asset e evita
  // o problema do <audio> com src inválido. O AudioContext nasce "suspended"
  // por política de autoplay; é resumido no primeiro gesto do usuário (abaixo).
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    ctxRef.current = ctx;
    // Desbloqueia o áudio no primeiro gesto (clique/tecla) — exigência dos browsers.
    const unlock = () => {
      if (ctx.state === 'suspended') void ctx.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      void ctx.close();
    };
  }, []);

  const playBeep = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    // Dois tons curtos (ding-ding) tipo notificação.
    for (const [start, freq] of [
      [0, 880],
      [0.18, 1175],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = now + start;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.16);
    }
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
      if (soundEnabled) playBeep();

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
    [soundEnabled, requestPermissionIfNeeded, playBeep],
  );

  return { notify, soundEnabled, setSoundEnabled };
}

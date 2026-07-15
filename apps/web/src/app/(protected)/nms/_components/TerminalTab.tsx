'use client';

/**
 * Aba "Terminal" — SSH interativo (xterm.js) via WebSocket. O handshake WS não
 * leva headers, então o token do NetX vai na query; o NMS valida via SSO. A
 * rota `/api/v1/nms/ws/terminal` é proxied (nginx → NMS :3300) com upgrade.
 * Porta o `Terminal.tsx` do SPA; xterm é carregado dinâmico (evita SSR/`window`).
 */
import { useEffect, useRef, useState } from 'react';

import '@xterm/xterm/css/xterm.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { nmsTerminalWsUrl } from '@/lib/nms-api';

export function TerminalTab({ deviceId }: { deviceId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'connecting' | 'open' | 'closed'>('connecting');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let disposed = false;
    let cleanup = () => {};

    void (async () => {
      const [{ Terminal: XTerm }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (disposed || !ref.current) return;

      const term = new XTerm({
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 13,
        cursorBlink: true,
        theme: { background: '#0a0d11', foreground: '#c9d4df' },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(ref.current);
      fit.fit();

      const ws = new WebSocket(nmsTerminalWsUrl(deviceId));
      const sendResize = () => {
        if (ws.readyState === WebSocket.OPEN) ws.send(`\x1b[resize:${term.cols},${term.rows}`);
      };
      ws.onopen = () => {
        setState('open');
        term.focus();
        sendResize();
      };
      ws.onmessage = (e) => term.write(typeof e.data === 'string' ? e.data : '');
      ws.onclose = () => {
        setState('closed');
        term.write('\r\n*** sessão encerrada ***\r\n');
      };
      ws.onerror = () => setState('closed');

      const dataSub = term.onData((d) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(d);
      });
      const onWinResize = () => {
        fit.fit();
        sendResize();
      };
      window.addEventListener('resize', onWinResize);

      cleanup = () => {
        window.removeEventListener('resize', onWinResize);
        dataSub.dispose();
        ws.close();
        term.dispose();
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [deviceId]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>Terminal SSH — uso manual (N3)</CardTitle>
        <span
          className={`text-xs ${
            state === 'open'
              ? 'text-emerald-600 dark:text-emerald-400'
              : state === 'connecting'
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-slate-400'
          }`}
        >
          {state === 'open' ? 'conectado' : state === 'connecting' ? 'conectando…' : 'desconectado'}
        </span>
      </CardHeader>
      <CardContent>
        <div ref={ref} className="h-[420px] w-full overflow-hidden rounded-md bg-[#0a0d11] p-2" />
      </CardContent>
    </Card>
  );
}

import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getToken } from './api.js';

/** Terminal SSH interativo (xterm.js) ligado ao proxy /ws/terminal da API. */
export function Terminal({ deviceId, onClose }: { deviceId: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const term = new XTerm({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: { background: '#0a0d11', foreground: '#c9d4df' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // O actor vem do JWT no backend; o token vai pela query porque o handshake WS não leva headers.
    const token = encodeURIComponent(getToken() ?? '');
    const ws = new WebSocket(
      `${proto}://${location.host}/ws/terminal?deviceId=${deviceId}&token=${token}`,
    );

    const sendResize = () => {
      if (ws.readyState === WebSocket.OPEN) ws.send(`\x1b[resize:${term.cols},${term.rows}`);
    };
    ws.onopen = () => {
      term.focus();
      sendResize();
    };
    ws.onmessage = (e) => term.write(typeof e.data === 'string' ? e.data : '');
    ws.onclose = () => term.write('\r\n*** sessão encerrada ***\r\n');

    const dataSub = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(d);
    });
    const onWinResize = () => {
      fit.fit();
      sendResize();
    };
    window.addEventListener('resize', onWinResize);

    return () => {
      window.removeEventListener('resize', onWinResize);
      dataSub.dispose();
      ws.close();
      term.dispose();
    };
  }, [deviceId]);

  return (
    <div className="term-modal">
      <div className="term-head">
        <span>Terminal SSH — uso manual (N3)</span>
        <button onClick={onClose}>fechar ✕</button>
      </div>
      <div ref={ref} className="term-body" />
    </div>
  );
}

import type { IncomingMessage } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebSocket, WebSocketServer } from 'ws';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../auth/auth.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import type { Env } from '../config/env.js';

/**
 * Proxy WebSocket de terminal. A API NÃO abre SSH (§3): apenas faz ponte de bytes entre o
 * browser e o servidor de terminal do device-gateway (que é quem abre o SSH). Lê as
 * credenciais cifradas do banco e as repassa ao gateway, que decifra.
 */
export function setupTerminalProxy(app: INestApplication): void {
  const logger = new Logger('TerminalProxy');
  const prisma = app.get(PrismaService);
  const audit = app.get(AuditService);
  const auth = app.get(AuthService);
  const config = app.get(ConfigService<Env, true>);
  const gatewayUrl = config.get('GATEWAY_TERMINAL_URL', { infer: true });

  const wss = new WebSocketServer({ noServer: true });
  const server = app.getHttpServer();

  server.on(
    'upgrade',
    (req: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
      if (!req.url || !req.url.startsWith('/ws/terminal')) return;
      wss.handleUpgrade(req, socket, head, (browser) => void handle(browser, req.url ?? ''));
    },
  );

  async function handle(browser: WebSocket, url: string): Promise<void> {
    const q = new URL(url, 'http://x');
    const deviceId = q.searchParams.get('deviceId') ?? '';

    // Auth (ADR 0007): o WS exige um JWT válido na query (?token=) com papel operator/admin.
    // Browsers não enviam Authorization no handshake WS, por isso o token vai pela URL.
    let user: AuthUser;
    try {
      user = await auth.verifyToken(q.searchParams.get('token') ?? '');
    } catch {
      browser.send('\r\n*** não autenticado: faça login novamente\r\n');
      browser.close();
      return;
    }
    if (user.role !== 'admin' && user.role !== 'operator') {
      browser.send('\r\n*** permissão insuficiente para abrir terminal\r\n');
      browser.close();
      return;
    }
    const actor = user.username;

    const device = await prisma.device.findUnique({ where: { id: deviceId } }).catch(() => null);
    const cred = device ? await prisma.deviceCredential.findUnique({ where: { deviceId } }) : null;
    if (!device || !cred?.passwordEnc) {
      browser.send('\r\n*** device inexistente ou sem credenciais\r\n');
      browser.close();
      return;
    }

    const gw = new WebSocket(gatewayUrl);
    const closeBoth = () => {
      for (const s of [browser, gw]) {
        try {
          s.close();
        } catch {
          /* noop */
        }
      }
    };

    gw.on('open', () => {
      gw.send(
        JSON.stringify({
          mgmtIp: device.mgmtIp,
          username: cred.username,
          passwordEnc: cred.passwordEnc,
          sshPort: 22,
          cols: 120,
          rows: 30,
        }),
      );
      void audit.record({ actor, deviceId, action: 'device.terminal.open', result: 'ok' });
    });
    gw.on('message', (d) => browser.readyState === WebSocket.OPEN && browser.send(d.toString()));
    browser.on('message', (d) => gw.readyState === WebSocket.OPEN && gw.send(d.toString()));
    for (const s of [gw, browser]) {
      s.on('close', closeBoth);
      s.on('error', closeBoth);
    }
  }

  logger.log('proxy de terminal em /ws/terminal');
}

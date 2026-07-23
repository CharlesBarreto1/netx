/**
 * Cliente Telnet mínimo para a OLT Fiberhome AN5516 (a família AN5516/AN5116
 * não expõe SSH utilizável — a porta 22 aceita conexão mas reseta o handshake;
 * a via de gerência real é telnet/23). Implementado sobre `net.Socket` puro
 * (stdlib) — sem dependência externa.
 *
 * Trata as três peculiaridades do CLI da AN5516:
 *   1. Login em 2 etapas (Login:/Password:) + `enable` (modo privilegiado) que
 *      pede uma 2ª senha. Aqui a senha de enable = enableSecret (pode ser igual
 *      à de login).
 *   2. Paginação por "--Press any key to continue Ctrl+c to stop--": respondemos
 *      com ESPAÇO para avançar (não há `terminal length 0` — dá "Unknown").
 *   3. Comandos hierárquicos por contexto (ex.: `cd onu` → prompt `Admin\onu#`).
 *
 * Segurança operacional (é uma OLT de PRODUÇÃO):
 *   - login/enable enviados UMA vez cada; falha de auth REJEITA na hora (nunca
 *     reenvia — a OLT bloqueia login após 5 falhas);
 *   - só executa os comandos que o driver mandar (o driver manda só leitura).
 */
import { Logger } from '@nestjs/common';
import { Socket } from 'node:net';

const IAC = 255, DO = 253, WILL = 251, SB = 250, SE = 240, DONT = 254, WONT = 252;

export interface FiberhomeTelnetOptions {
  host: string;
  port?: number;
  username: string;
  password: string;
  /** Senha do modo enable; se ausente, reusa `password`. */
  enableSecret?: string | null;
  connectTimeoutMs?: number;
  /** Timeout de silêncio para considerar um comando terminado. */
  idleMs?: number;
}

export class FiberhomeTelnetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FiberhomeTelnetError';
  }
}

export class FiberhomeTelnetClient {
  private readonly logger = new Logger(FiberhomeTelnetClient.name);
  private sock: Socket | null = null;
  private buf = '';
  private readonly host: string;
  private readonly port: number;
  private readonly username: string;
  private readonly password: string;
  private readonly enableSecret: string;
  private readonly connectTimeoutMs: number;
  private readonly idleMs: number;

  constructor(opts: FiberhomeTelnetOptions) {
    this.host = opts.host;
    this.port = opts.port ?? 23;
    this.username = opts.username;
    this.password = opts.password;
    this.enableSecret = opts.enableSecret ?? opts.password;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 20_000;
    this.idleMs = opts.idleMs ?? 1_200;
  }

  /** Remove sequências IAC (negociação telnet), respondendo WONT/DONT a tudo. */
  private consumeIAC(data: Buffer): string {
    const out: number[] = [];
    for (let i = 0; i < data.length; i++) {
      if (data[i] === IAC) {
        const cmd = data[i + 1];
        if (cmd === DO) { this.sock?.write(Buffer.from([IAC, WONT, data[i + 2]])); i += 2; }
        else if (cmd === WILL) { this.sock?.write(Buffer.from([IAC, DONT, data[i + 2]])); i += 2; }
        else if (cmd === SB) { while (data[i] !== SE && i < data.length) i++; }
        else i += 1;
      } else out.push(data[i]);
    }
    return Buffer.from(out).toString('latin1');
  }

  /** Conecta, faz login e entra em modo enable (Admin#). Lança em falha. */
  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const sock = new Socket();
      this.sock = sock;
      const timer = setTimeout(() => { sock.destroy(); reject(new FiberhomeTelnetError('timeout de conexão')); }, this.connectTimeoutMs);
      sock.once('error', (e) => { clearTimeout(timer); reject(new FiberhomeTelnetError('erro de socket: ' + e.message)); });
      sock.on('data', (d) => { this.buf += this.consumeIAC(d); });
      sock.connect(this.port, this.host, () => { clearTimeout(timer); resolve(); });
    });

    // Etapa de login: espera "Login:", manda usuário; espera "Password:", manda senha.
    await this.expect(/login\s*[:>]/i, 'prompt de login');
    this.send(this.username);
    await this.expect(/password\s*[:>]/i, 'prompt de senha');
    this.buf = '';
    this.send(this.password);
    // Após a senha: ou chega ao User> (ok), ou vem texto de falha.
    const afterLogin = await this.expect(/(bad password|login failed|please retry|master|[\w-]+>)/i, 'resultado do login');
    if (/bad password|login failed|please retry/i.test(afterLogin)) {
      throw new FiberhomeTelnetError('login rejeitado pela OLT (usuário/senha)');
    }

    // enable → 2ª senha → Admin#
    this.buf = '';
    this.send('enable');
    await this.expect(/password\s*[:>]/i, 'prompt de senha do enable');
    this.buf = '';
    this.send(this.enableSecret);
    const afterEnable = await this.expect(/(bad password|login failed|please retry|[\w-]+#)/i, 'resultado do enable');
    if (/bad password|login failed|please retry/i.test(afterEnable)) {
      throw new FiberhomeTelnetError('enable rejeitado pela OLT (senha de enable)');
    }
  }

  /**
   * Executa um comando e devolve a saída até o próximo prompt, avançando a
   * paginação automaticamente. NÃO interpreta — devolve texto cru limpo de ANSI.
   */
  async exec(cmd: string, maxMs = 30_000): Promise<string> {
    if (!this.sock) throw new FiberhomeTelnetError('não conectado');
    this.buf = '';
    this.send(cmd);
    const started = Date.now();
    let acc = '';
    let lastLen = 0;
    let idleSince = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await this.sleep(150);
      // Paginação: responde espaço e continua.
      if (/--\s*press any key to continue/i.test(this.buf)) {
        this.send(' ', false);
        acc += this.buf.replace(/--\s*press any key[^\n]*/gi, '');
        this.buf = '';
        idleSince = Date.now();
        continue;
      }
      acc += this.buf;
      this.buf = '';
      // Terminou quando: viu um prompt no fim E ficou idle, ou "Command execute".
      const tail = acc.replace(/\s+$/, ' ');
      const atPrompt = /([\w-]+[#>]|admin\\[\w-]+#)\s*$/i.test(tail) || /command execute (success|failed)/i.test(acc);
      if (acc.length === lastLen) {
        if (atPrompt || Date.now() - idleSince > this.idleMs) break;
      } else {
        lastLen = acc.length;
        idleSince = Date.now();
      }
      if (Date.now() - started > maxMs) break;
    }
    return this.stripAnsi(acc);
  }

  async close(): Promise<void> {
    if (!this.sock) return;
    try { this.send('exit'); await this.sleep(300); } catch { /* noop */ }
    try { this.sock.destroy(); } catch { /* noop */ }
    this.sock = null;
  }

  // ---- helpers ----
  private send(s: string, newline = true): void {
    this.sock?.write(newline ? s + '\r\n' : s);
  }

  private stripAnsi(s: string): string {
    // eslint-disable-next-line no-control-regex
    return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
  }

  private async expect(re: RegExp, what: string, maxMs = 20_000): Promise<string> {
    const started = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (re.test(this.buf)) return this.buf;
      if (Date.now() - started > maxMs) {
        throw new FiberhomeTelnetError(`timeout esperando ${what}`);
      }
      await this.sleep(120);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

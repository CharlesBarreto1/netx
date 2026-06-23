/**
 * ZynosSshClient — cliente SSH interativo pra OLTs Zyxel rodando ZyNOS
 * (ex: OLT2406, firmware V4.02(AAVA.x)). Encapsula os três "pulos do gato"
 * que o ZyNOS exige e que `execCommand` (canal exec puro) NÃO resolve:
 *
 *   1. Algoritmos LEGADOS — o SSH do ZyNOS 2019 só negocia kex
 *      diffie-hellman-group1/14-sha1, host key ssh-rsa e cifras *-cbc/3des.
 *      Por isso usamos `requestShell` com `algorithms` explícito (lista que
 *      inclui modernos + legados, pra também funcionar em firmwares novos).
 *
 *   2. Negociação de terminal via DSR — depois do banner, o ZyNOS manda
 *      `ESC[6n` (Device Status Report — "onde está o cursor?"), em seguida
 *      `ESC[999C` (vai pra direita) e `ESC[6n` de novo, pra medir a largura.
 *      É OBRIGATÓRIO responder cada DSR com `ESC[<lin>;<col>R`, senão o prompt
 *      nunca aparece e a sessão fica pendurada. Respondemos em qualquer ponto
 *      do stream (no listener de dados).
 *
 *   3. Paginação — saídas longas param com
 *      `-- more --, next page: Space, continue: c, quit: ESC`. Mandamos `c`
 *      pra despejar a página inteira de uma vez.
 *
 * Lib: `node-ssh` (já dependência do core-service). Lazy-loaded — se ausente,
 * connect() lança e o driver reporta erro operacional (não derruba o módulo).
 *
 * Uso típico (1 sessão por operação; NÃO é pool):
 *   const c = new ZynosSshClient();
 *   await c.connect({ host, port, username, password });
 *   const out = await c.exec('show system-information');
 *   await c.close();
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { Logger } from '@nestjs/common';

/** Resposta ao DSR (ESC[6n): cursor em linha 24, coluna 80 (terminal 80x24). */
const DSR_REPLY = '\x1b[24;80R';
// eslint-disable-next-line no-control-regex -- ESC[6n é um escape ANSI literal
const DSR_REQUEST = /\x1b\[6n/g;
const PAGER_RE = /--\s*more\s*--/i;

/**
 * Algoritmos oferecidos no handshake. Inclui modernos (firmwares novos) +
 * legados (ZyNOS 2019). ssh2 usa estas listas no lugar dos defaults, então
 * mantemos os modernos explicitamente pra não regredir em equipamentos atuais.
 */
const SSH_ALGORITHMS = {
  kex: [
    'curve25519-sha256',
    'curve25519-sha256@libssh.org',
    'ecdh-sha2-nistp256',
    'ecdh-sha2-nistp384',
    'ecdh-sha2-nistp521',
    'diffie-hellman-group-exchange-sha256',
    'diffie-hellman-group14-sha256',
    'diffie-hellman-group16-sha512',
    // legados ZyNOS:
    'diffie-hellman-group14-sha1',
    'diffie-hellman-group1-sha1',
    'diffie-hellman-group-exchange-sha1',
  ],
  serverHostKey: [
    'ssh-ed25519',
    'ecdsa-sha2-nistp256',
    'rsa-sha2-512',
    'rsa-sha2-256',
    'ssh-rsa', // legado ZyNOS
  ],
  cipher: [
    'aes128-gcm@openssh.com',
    'aes256-gcm@openssh.com',
    'aes128-ctr',
    'aes192-ctr',
    'aes256-ctr',
    // legados ZyNOS:
    'aes128-cbc',
    'aes192-cbc',
    'aes256-cbc',
    '3des-cbc',
  ],
} as const;

interface NodeSshLib {
  connect(opts: Record<string, unknown>): Promise<NodeSshLib>;
  requestShell(): Promise<ShellChannel>;
  dispose(): void;
}
interface NodeSshCtor {
  new (): NodeSshLib;
}

/** Subconjunto do ssh2 ClientChannel que usamos. */
interface ShellChannel {
  on(event: 'data', cb: (chunk: Buffer) => void): void;
  on(event: 'close', cb: () => void): void;
  write(data: string): void;
  end(): void;
}

export interface ZynosConnectOpts {
  host: string;
  port: number;
  username: string;
  password: string;
  /** Timeout do handshake SSH (ms). */
  readyTimeoutMs?: number;
}

export interface ZynosExecOpts {
  /** Timeout total do comando (ms). Default 20s. */
  timeoutMs?: number;
  /**
   * Alguns `show` do ZyNOS imprimem ASSINCRONAMENTE: o prompt volta na hora e
   * o bloco de saída sai logo depois (ex: `ddmi current`). Quando setado,
   * exec() só retorna quando o buffer casar com esta regex (ou timeout),
   * mesmo que o prompt já tenha reaparecido.
   */
  waitFor?: RegExp;
  /** Espera extra (ms) após detectar prompt/waitFor, pra drenar o resto. */
  settleMs?: number;
}

let cachedCtor: NodeSshCtor | null = null;
let loadAttempted = false;

function loadNodeSsh(): NodeSshCtor | null {
  if (loadAttempted) return cachedCtor;
  loadAttempted = true;
  try {
    const mod = require('node-ssh');
    cachedCtor = (mod.NodeSSH as NodeSshCtor) ?? (mod.default as NodeSshCtor);
  } catch {
    cachedCtor = null;
  }
  return cachedCtor;
}

/** Remove escapes ANSI, backspaces, CR e linhas de paginação da saída crua. */
export function stripZynosNoise(raw: string): string {
  /* eslint-disable no-control-regex -- escapes ANSI (ESC/BEL/BS) são literais aqui */
  return raw
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '') // sequências CSI (cores, cursor)
    .replace(/\x1b\][^\x07]*\x07/g, '') // OSC
    .replace(/[\x08]/g, '') // backspaces que o pager cospe ao limpar a linha
    .replace(/--\s*more\s*--[^\n]*/gi, '') // marcador de paginação
    .replace(/\r/g, '');
  /* eslint-enable no-control-regex */
}

export class ZynosSshClient {
  private readonly logger = new Logger(ZynosSshClient.name);
  private ssh: NodeSshLib | null = null;
  private channel: ShellChannel | null = null;
  private buffer = '';
  private closed = false;
  /** Token do hostname capturado no login (ex "OLT-IRT1"), pra detectar prompt. */
  private promptRe: RegExp | null = null;

  /**
   * Abre a sessão, faz login, negocia o terminal (DSR) e espera o primeiro
   * prompt `#`/`>`. Lança em qualquer falha (auth, timeout, lib ausente).
   */
  async connect(opts: ZynosConnectOpts): Promise<void> {
    const Ctor = loadNodeSsh();
    if (!Ctor) throw new Error('`node-ssh` não instalado — driver Zyxel indisponível');

    const ssh = new Ctor();
    await ssh.connect({
      host: opts.host,
      port: opts.port,
      username: opts.username,
      password: opts.password,
      readyTimeout: opts.readyTimeoutMs ?? 12_000,
      algorithms: SSH_ALGORITHMS,
      // Rede de gerência travada (premissa do operador). Hardening (TOFU +
      // fingerprint persistido como em NetworkEquipment) fica pra Fase 2.
      hostVerifier: () => true,
    });
    this.ssh = ssh;

    const channel = await ssh.requestShell();
    this.channel = channel;
    channel.on('data', (chunk) => this.onData(chunk));
    channel.on('close', () => {
      this.closed = true;
    });

    // Espera o prompt inicial, respondendo aos DSR pelo caminho.
    await this.waitForInitialPrompt(opts.readyTimeoutMs ?? 12_000);
  }

  /** Roda um comando e devolve a saída limpa (sem eco do comando nem prompt). */
  async exec(cmd: string, opts: ZynosExecOpts = {}): Promise<string> {
    if (!this.channel) throw new Error('ZynosSshClient: sessão não conectada');
    const timeoutMs = opts.timeoutMs ?? 20_000;
    this.buffer = '';
    this.channel.write(`${cmd}\r`);

    await this.waitUntil(() => {
      // Comandos com saída ASSÍNCRONA (ex `ddmi current`) imprimem o bloco
      // DEPOIS do prompt reaparecer — não dá pra exigir prompt no fim. Nesses
      // casos basta casar o `waitFor`; o `settleMs` drena o resto.
      if (opts.waitFor) return opts.waitFor.test(stripZynosNoise(this.buffer));
      return this.promptSeen();
    }, timeoutMs);

    if (opts.settleMs) await delay(opts.settleMs);

    return this.cleanOutput(this.buffer, cmd);
  }

  /**
   * Roda uma sequência de comandos (ex: bloco `configure … write memory`),
   * cada um esperando o prompt. Concatena a saída e detecta erros típicos do
   * ZyNOS (`% Error`, `invalid`, `incomplete`, etc) — se algum aparecer, LANÇA
   * com a linha que falhou, pra o driver reportar falha operacional.
   */
  async execSequence(cmds: string[], opts: ZynosExecOpts = {}): Promise<string> {
    let combined = '';
    for (const cmd of cmds) {
      const out = await this.exec(cmd, opts);
      combined += `${cmd}\n${out}\n`;
      const errLine = out
        .split('\n')
        .find((l) => /%\s*error|invalid input|incomplete command|unknown command|command not found|\berror:/i.test(l));
      if (errLine) {
        throw new Error(`ZyNOS rejeitou "${cmd}": ${errLine.trim()}`);
      }
    }
    return combined;
  }

  async close(): Promise<void> {
    try {
      this.channel?.write('logout\r');
    } catch {
      /* ignore */
    }
    try {
      this.channel?.end();
    } catch {
      /* ignore */
    }
    try {
      this.ssh?.dispose();
    } catch {
      /* ignore */
    }
    this.channel = null;
    this.ssh = null;
  }

  // ───────────────────────────────────────────────────────────────────────

  private onData(chunk: Buffer): void {
    const text = chunk.toString('utf8');
    this.buffer += text;
    // Responde a TODOS os DSR pendentes no buffer e remove os marcadores
    // (pra não re-disparar). O ZyNOS manda 1+ DSR antes do prompt e às vezes
    // de novo dentro de telas. Usamos match() (não test()) pra evitar o
    // lastIndex stateful do regex /g.
    const dsr = this.buffer.match(DSR_REQUEST);
    if (dsr) {
      for (let i = 0; i < dsr.length; i++) this.channel?.write(DSR_REPLY);
      this.buffer = this.buffer.replace(DSR_REQUEST, '');
    }
    // Paginação: manda 'c' (continue) e limpa o marcador do buffer.
    if (PAGER_RE.test(this.buffer)) {
      this.channel?.write('c');
      this.buffer = this.buffer.replace(/--\s*more\s*--[^\n]*/gi, '');
    }
  }

  private promptSeen(): boolean {
    // Testa contra o buffer LIMPO: o ZyNOS deixa ANSI residual (ex \x1b[999C)
    // entre o newline e o prompt, que quebraria o anchor da regex.
    if (this.promptRe) return this.promptRe.test(stripZynosNoise(this.buffer));
    return false;
  }

  private async waitForInitialPrompt(timeoutMs: number): Promise<void> {
    // Prompt genérico do ZyNOS: <hostname>[(modo)]#  ou  >
    const genericPrompt = /(^|[\r\n])\s*([A-Za-z0-9._-]+)(\([^)]*\))?[#>]\s*$/;
    await this.waitUntil(() => genericPrompt.test(stripZynosNoise(this.buffer)), timeoutMs);

    const m = stripZynosNoise(this.buffer).match(genericPrompt);
    if (m) {
      // Trava o prompt no hostname capturado (sufixo de modo (config) varia).
      const host = m[2];
      this.promptRe = new RegExp(`${escapeRe(host)}[^\\r\\n]*[#>]\\s*$`);
    } else {
      // Fallback: qualquer linha terminando em #/> no fim do buffer.
      this.promptRe = /[^\r\n]*[#>]\s*$/;
    }
  }

  /** Poll do buffer até `pred()` ou timeout. Lança se a sessão fechar antes. */
  private async waitUntil(pred: () => boolean, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (pred()) return;
      if (this.closed) throw new Error('Sessão SSH fechada pelo equipamento');
      if (Date.now() > deadline) {
        throw new Error(`Timeout (${timeoutMs}ms) esperando resposta do ZyNOS`);
      }
      await delay(40);
    }
  }

  /** Tira o eco do comando, o prompt final e o ruído ANSI/paginação. */
  private cleanOutput(raw: string, cmd: string): string {
    let out = stripZynosNoise(raw);
    const lines = out.split('\n');
    // Remove a 1ª linha se for o eco do comando.
    if (lines.length && lines[0].trim() === cmd.trim()) lines.shift();
    out = lines.join('\n');
    // Remove o prompt final (última linha tipo "OLT-IRT1# ").
    if (this.promptRe) out = out.replace(this.promptRe, '');
    return out.trim();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

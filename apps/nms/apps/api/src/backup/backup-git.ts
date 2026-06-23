import { execFile } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** Identidade fixa dos commits de backup (não depende do git config global). */
const IDENT = ['-c', 'user.name=NetX NMS', '-c', 'user.email=netx-nms@local'];

/**
 * Repositório git de backups de config. Um arquivo por device (`<deviceId>.conf`),
 * histórico/diff/blame de graça. A API é a única que escreve aqui.
 */
export class BackupGit {
  constructor(private readonly dir: string) {}

  private git(args: string[]) {
    return exec('git', ['-C', this.dir, ...args], { maxBuffer: 32 * 1024 * 1024 });
  }

  /**
   * Garante que o diretório existe e tem o SEU PRÓPRIO repositório git. Checa o `.git` local
   * (não `rev-parse`, que acharia o repo pai já que esta pasta fica dentro do monorepo).
   */
  async ensureRepo(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    try {
      await access(join(this.dir, '.git'));
    } catch {
      await this.git(['init', '-q']);
      await this.git([...IDENT, 'commit', '--allow-empty', '-q', '-m', 'init backup repo']);
    }
  }

  private fileName(deviceId: string) {
    return `${deviceId}.conf`;
  }

  /**
   * Escreve a config do device e commita se houve mudança. Devolve o hash e se mudou.
   */
  async commitConfig(
    deviceId: string,
    hostname: string,
    config: string,
    actor: string,
  ): Promise<{ changed: boolean; hash: string; firstCommit: boolean }> {
    await this.ensureRepo();
    const file = this.fileName(deviceId);
    await writeFile(resolve(this.dir, file), config, 'utf-8');
    await this.git(['add', file]);

    const status = await this.git(['status', '--porcelain', '--', file]);
    const changed = status.stdout.trim().length > 0;

    // É o primeiro commit deste device? (sem histórico para o arquivo)
    let firstCommit = false;
    try {
      await this.git(['log', '-1', '--format=%H', '--', file]);
    } catch {
      firstCommit = true;
    }
    const priorLog = await this.git(['log', '--format=%H', '--', file]).catch(() => ({
      stdout: '',
    }));
    firstCommit = priorLog.stdout.trim().length === 0;

    if (!changed) {
      const head = await this.git(['rev-parse', 'HEAD']);
      return { changed: false, hash: head.stdout.trim(), firstCommit };
    }

    const msg = `${hostname} (${deviceId}) backup por ${actor}`;
    await this.git([...IDENT, 'commit', '-q', '-m', msg, '--', file]);
    const head = await this.git(['rev-parse', 'HEAD']);
    return { changed: true, hash: head.stdout.trim(), firstCommit };
  }

  /** Conteúdo do arquivo do device em um commit específico. */
  async showAt(deviceId: string, hash: string): Promise<string> {
    const { stdout } = await this.git(['show', `${hash}:${this.fileName(deviceId)}`]);
    return stdout;
  }

  /** Diff unificado do arquivo do device entre dois commits (ou desde o vazio). */
  async diff(deviceId: string, oldHash: string | null, newHash: string): Promise<string> {
    const file = this.fileName(deviceId);
    if (!oldHash) {
      // diff desde a árvore vazia (mostra tudo como adicionado)
      const empty = await this.git(['hash-object', '-t', 'tree', '/dev/null']).catch(() => ({
        stdout: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      }));
      const { stdout } = await this.git(['diff', empty.stdout.trim(), newHash, '--', file]).catch(
        () => ({ stdout: '' }),
      );
      return stdout;
    }
    const { stdout } = await this.git(['diff', oldHash, newHash, '--', file]);
    return stdout;
  }

  /** Estatística de mudança (linhas +/-) entre dois commits. */
  async diffStat(deviceId: string, oldHash: string, newHash: string): Promise<string> {
    const { stdout } = await this.git([
      'diff',
      '--shortstat',
      oldHash,
      newHash,
      '--',
      this.fileName(deviceId),
    ]).catch(() => ({ stdout: '' }));
    return stdout.trim();
  }

  get path() {
    return join(this.dir);
  }
}

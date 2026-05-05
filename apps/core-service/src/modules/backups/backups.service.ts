import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BackupStatus as PrismaBackupStatus, Prisma } from '@prisma/client';
import { spawn } from 'child_process';
import { createReadStream, promises as fs, existsSync } from 'fs';
import { join, basename } from 'path';
import { URL } from 'url';

import type { BackupResponse, BackupStatus } from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Backups manuais via `pg_dump`.
 *
 * Decisões:
 *
 * 1. Onde fica.
 *    `BACKUP_DIR` (env, default `/var/backups/netx`). Precisa ter ownership
 *    do user que roda o core-service e ser excluído do `git`/repo.
 *
 * 2. Formato.
 *    `pg_dump -Fc` (custom format, gzipado por dentro). Extensão `.dump`.
 *    Não criptografamos por enquanto (requisito explícito).
 *
 * 3. Multi-tenancy.
 *    Backup é do BANCO INTEIRO, não por tenant. O `tenantId` em `Backup`
 *    apenas registra qual tenant disparou (auditoria). Quando virar
 *    multi-tenant pesado, a estratégia muda pra dump filtrado por tenant
 *    ou snapshot lógico via Postgres `COPY`.
 *
 * 4. Execução.
 *    Síncrona — o handler espera o dump terminar antes de devolver. Pra
 *    bases > 1GB pode demorar; nesse caso vale plugar BullMQ. Por enquanto,
 *    OK pra base pequena.
 *
 * 5. Limpeza.
 *    Não automatizada. O admin baixa e exclui via UI. Cron de limpeza fica
 *    pra próxima iteração.
 */
@Injectable()
export class BackupsService {
  private readonly logger = new Logger(BackupsService.name);
  private readonly backupDir = process.env.BACKUP_DIR ?? '/var/backups/netx';

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string): Promise<BackupResponse[]> {
    const rows = await this.prisma.backup.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map(toResponse);
  }

  async findById(tenantId: string, id: string) {
    const row = await this.prisma.backup.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Backup não encontrado');
    return row;
  }

  async create(tenantId: string, actorUserId: string): Promise<BackupResponse> {
    await fs.mkdir(this.backupDir, { recursive: true });

    const filename = `netx-${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19)}.dump`;

    const row = await this.prisma.backup.create({
      data: {
        tenantId,
        filename,
        status: PrismaBackupStatus.RUNNING,
        createdById: actorUserId,
      },
    });

    const filePath = join(this.backupDir, filename);
    const start = Date.now();
    try {
      await this.runPgDump(filePath);
      const stat = await fs.stat(filePath);
      const updated = await this.prisma.backup.update({
        where: { id: row.id },
        data: {
          status: PrismaBackupStatus.COMPLETED,
          sizeBytes: BigInt(stat.size),
          durationMs: Date.now() - start,
          completedAt: new Date(),
        },
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'backup.created',
        resource: 'backups',
        resourceId: row.id,
        afterState: { filename, sizeBytes: stat.size },
      });
      return toResponse(updated);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      this.logger.error(`pg_dump failed: ${msg}`);
      const updated = await this.prisma.backup.update({
        where: { id: row.id },
        data: {
          status: PrismaBackupStatus.FAILED,
          errorMessage: msg,
          durationMs: Date.now() - start,
          completedAt: new Date(),
        },
      });
      // Limpa arquivo parcial.
      try {
        if (existsSync(filePath)) await fs.unlink(filePath);
      } catch {
        // ignore
      }
      throw new BadRequestException(`Falha ao gerar backup: ${msg}`);
      // ^ NestJS converte em ProblemDetails com a mensagem real.
    }
  }

  /**
   * Stream do arquivo pra download. Retorna readable stream + metadata.
   */
  async download(tenantId: string, id: string) {
    const row = await this.findById(tenantId, id);
    if (row.status !== PrismaBackupStatus.COMPLETED) {
      throw new BadRequestException('Backup não está pronto para download');
    }
    const filePath = join(this.backupDir, basename(row.filename));
    if (!existsSync(filePath)) {
      throw new NotFoundException('Arquivo não encontrado no disco');
    }
    return {
      filename: row.filename,
      sizeBytes: row.sizeBytes ? Number(row.sizeBytes) : 0,
      stream: createReadStream(filePath),
    };
  }

  async remove(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const row = await this.findById(tenantId, id);
    const filePath = join(this.backupDir, basename(row.filename));
    try {
      if (existsSync(filePath)) await fs.unlink(filePath);
    } catch (err) {
      this.logger.warn(`Falha ao apagar arquivo ${filePath}: ${err}`);
    }
    await this.prisma.backup.delete({ where: { id } });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'backup.deleted',
      resource: 'backups',
      resourceId: id,
    });
  }

  // ---------------------------------------------------------------------------
  // PRIVATE
  // ---------------------------------------------------------------------------
  /**
   * Executa pg_dump em formato custom (-Fc, comprimido). Lê DATABASE_URL e
   * passa via env. Resolve quando o processo termina com exit code 0.
   */
  private runPgDump(filePath: string): Promise<void> {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL não definido');

    // Parse: postgresql://user:pass@host:port/db?...
    const u = new URL(url);
    const env = {
      ...process.env,
      PGHOST: u.hostname,
      PGPORT: u.port || '5432',
      PGUSER: decodeURIComponent(u.username),
      PGPASSWORD: decodeURIComponent(u.password),
      PGDATABASE: u.pathname.replace(/^\//, ''),
    };

    // Permite sobrescrever o caminho do binário (ex.:
    // /usr/lib/postgresql/16/bin/pg_dump) quando o pg_dump default do sistema
    // for de versão menor que a do servidor — caso contrário ele aborta com
    // "server version mismatch".
    const pgDumpBin = process.env.PG_DUMP_BIN || 'pg_dump';

    return new Promise((resolve, reject) => {
      const proc = spawn(
        pgDumpBin,
        ['-Fc', '--no-owner', '--no-acl', '-f', filePath],
        { env, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stderr = '';
      proc.stderr?.on('data', (d) => {
        stderr += d.toString();
      });
      proc.on('error', (err) =>
        reject(new Error(`pg_dump não pôde iniciar: ${err.message}`)),
      );
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else {
          const detail = stderr.trim();
          // Erro clássico: pg_dump < server. Devolve dica acionável em vez
          // de só repetir o stderr cru.
          if (/server version mismatch/i.test(detail)) {
            reject(
              new Error(
                'pg_dump em versão menor que o servidor. Instale ' +
                  'postgresql-client-16 e configure PG_DUMP_BIN=' +
                  '/usr/lib/postgresql/16/bin/pg_dump no .env do core-service. ' +
                  `Detalhe original: ${detail}`,
              ),
            );
            return;
          }
          reject(new Error(`pg_dump exit ${code}: ${detail}`));
        }
      });
    });
  }
}

function toResponse(b: any): BackupResponse {
  return {
    id: b.id,
    tenantId: b.tenantId,
    filename: b.filename,
    status: b.status as BackupStatus,
    sizeBytes: b.sizeBytes != null ? Number(b.sizeBytes) : null,
    durationMs: b.durationMs,
    errorMessage: b.errorMessage,
    createdById: b.createdById,
    createdAt: b.createdAt.toISOString(),
    completedAt: b.completedAt?.toISOString() ?? null,
  };
}

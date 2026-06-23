import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DeviceJobsService } from '../queue/device-jobs.service.js';
import { DevicesService } from '../devices/devices.service.js';
import { LlmService } from '../ai/llm.service.js';
import { BackupGit } from './backup-git.js';
import type { Env } from '../config/env.js';

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly git: BackupGit;

  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
    private readonly audit: AuditService,
    private readonly jobs: DeviceJobsService,
    private readonly llm: LlmService,
    config: ConfigService<Env, true>,
  ) {
    this.git = new BackupGit(resolve(config.get('BACKUP_REPO_DIR', { infer: true })));
  }

  /** Puxa a config via gateway, versiona no git e registra ConfigSnapshot. Alerta em mudança. */
  async backup(deviceId: string, actor: string) {
    const device = await this.devices.findOne(deviceId);
    const cred = await this.prisma.deviceCredential.findUnique({ where: { deviceId } });
    if (!cred?.passwordEnc) {
      throw new BadRequestException('Cadastre credenciais (senha) antes do backup');
    }

    const result = await this.jobs.enqueueAndWait(
      {
        jobId: randomUUID(),
        deviceId,
        requestedBy: actor,
        requestedAt: new Date().toISOString(),
        kind: 'backup-config',
        params: { mgmtIp: device.mgmtIp, username: cred.username, passwordEnc: cred.passwordEnc },
      },
      { waitMs: 60_000 },
    );
    if (!result.ok || result.data?.kind !== 'backup-config') {
      throw new BadRequestException(`Backup falhou: ${result.error ?? 'resposta inesperada'}`);
    }

    const prev = await this.prisma.configSnapshot.findFirst({
      where: { deviceId },
      orderBy: { capturedAt: 'desc' },
    });

    const { changed, hash, firstCommit } = await this.git.commitConfig(
      deviceId,
      device.hostname,
      result.data.config,
      actor,
    );

    if (!changed) {
      await this.audit.record({
        actor,
        deviceId,
        action: 'device.backup',
        result: 'sem mudança',
      });
      return { deviceId, changed: false, gitHash: hash };
    }

    const diffSummary = firstCommit
      ? 'baseline'
      : (await this.git.diffStat(deviceId, prev?.gitHash ?? hash, hash)) || 'alterado';

    const snapshot = await this.prisma.configSnapshot.create({
      data: { deviceId, gitHash: hash, diffSummary },
    });

    // Mudança detectada (a ferramenta nunca altera config → toda mudança é externa/CLI): alerta.
    // A IA (4.2) explica o diff em PT-BR quando disponível; senão, cai no shortstat.
    if (!firstCommit) {
      const diffText = await this.git.diff(deviceId, prev?.gitHash ?? null, hash);
      const aiSummary = await this.llm.summarizeConfigDiff(diffText);
      await this.prisma.event.create({
        data: {
          deviceId,
          severity: 'warning',
          type: 'config-change',
          message: aiSummary ?? `Config alterada (${diffSummary})`,
          ts: new Date(),
        },
      });
    }

    await this.audit.record({
      actor,
      deviceId,
      action: 'device.backup',
      diff: diffSummary,
      result: firstCommit ? 'baseline' : 'config alterada',
    });
    this.logger.log(`backup ${device.hostname}: ${firstCommit ? 'baseline' : diffSummary}`);
    return { deviceId, changed: true, gitHash: hash, snapshotId: snapshot.id, diffSummary };
  }

  /** Histórico de snapshots do device. */
  async listSnapshots(deviceId: string) {
    await this.devices.findOne(deviceId);
    return this.prisma.configSnapshot.findMany({
      where: { deviceId },
      orderBy: { capturedAt: 'desc' },
      take: 100,
    });
  }

  /** Conteúdo de um snapshot + diff em relação ao snapshot anterior. */
  async getSnapshot(deviceId: string, snapshotId: string) {
    const snap = await this.prisma.configSnapshot.findUnique({ where: { id: snapshotId } });
    if (!snap || snap.deviceId !== deviceId) throw new NotFoundException('Snapshot não encontrado');

    const prev = await this.prisma.configSnapshot.findFirst({
      where: { deviceId, capturedAt: { lt: snap.capturedAt } },
      orderBy: { capturedAt: 'desc' },
    });

    const config = await this.git.showAt(deviceId, snap.gitHash);
    const diff = await this.git.diff(deviceId, prev?.gitHash ?? null, snap.gitHash);
    return { ...snap, config, diff };
  }
}

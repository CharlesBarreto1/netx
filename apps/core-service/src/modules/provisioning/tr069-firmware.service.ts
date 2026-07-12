/**
 * Tr069FirmwareService — catálogo de firmware + rollout via RPC Download.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Nasceu da dor real do upgrade manual da F670L do piloto PY (jul/2026):
 * scp + nginx na mão + INSERT na fila. Fluxo aqui:
 *   1. Upload (multipart) → valida, SHA-256, grava em TR069_FIRMWARE_DIR
 *      como <id>.bin e registra o catálogo (vendor/modelo/versão).
 *   2. Deploy → cria Tr069Tasks DOWNLOAD (parque do modelo ou seriais
 *      escolhidos) apontando pra TR069_FIRMWARE_BASE_URL/fw/<id> — servido
 *      pelo PRÓPRIO cwmp-server (:7547), a origem HTTP que o CPE já alcança.
 *   3. Status → lê as tasks de volta por payload.firmwareId; o resultado real
 *      vem no TransferComplete (fault 9018 = imagem rejeitada pelo CPE, ex.:
 *      lock de customização de operadora — visto ao vivo na F670L TLCO.GRP2).
 *
 * ⚠️ Trava anti-brick: deploy SÓ pra devices com productClass IGUAL ao do
 * firmware — mandar imagem de F670L pra EG8145 é tijolo em potencial.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  DeployTr069FirmwareRequest,
  Tr069FirmwareDeployResult,
  Tr069FirmwareDeployStatus,
  Tr069FirmwareDto,
  UploadTr069FirmwareFields,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/** Diretório dos .bin — o cwmp-server serve DESTE mesmo path em GET /fw/{id}. */
const FIRMWARE_DIR = process.env.TR069_FIRMWARE_DIR ?? '/var/lib/netx/firmware';
/**
 * Origem HTTP que o CPE alcança (a MESMA do ACS, ex.: http://tr.zux.net.py:7547).
 * Sem default: cada instalação tem a sua — deploy falha com mensagem clara.
 */
const FIRMWARE_BASE_URL = process.env.TR069_FIRMWARE_BASE_URL ?? '';

/** Menor imagem plausível — pega stub/HTML de erro renomeado (visto: 23KB). */
const MIN_FIRMWARE_BYTES = 1024 * 1024;
const MAX_FIRMWARE_BYTES = 256 * 1024 * 1024;

export interface FirmwareDeployCandidate {
  id: string;
  deviceId: string;
  status: string;
  softwareVersion: string | null;
}

export interface FirmwareDeployPlan {
  enqueueIds: string[];
  skippedSameVersion: number;
  skippedInflight: number;
  skippedOffline: number;
}

/**
 * Decide quem recebe a task (função PURA — coberta por spec). Ordem dos
 * filtros: offline → versão → em-curso; cada device conta em UM só motivo.
 */
export function planFirmwareDeploy(
  candidates: FirmwareDeployCandidate[],
  targetVersion: string,
  opts: { onlyOnline: boolean; skipSameVersion: boolean },
  inflightDeviceIds: Set<string>,
): FirmwareDeployPlan {
  const plan: FirmwareDeployPlan = {
    enqueueIds: [],
    skippedSameVersion: 0,
    skippedInflight: 0,
    skippedOffline: 0,
  };
  for (const d of candidates) {
    if (opts.onlyOnline && d.status !== 'ONLINE') {
      plan.skippedOffline++;
      continue;
    }
    if (opts.skipSameVersion && d.softwareVersion === targetVersion) {
      plan.skippedSameVersion++;
      continue;
    }
    if (inflightDeviceIds.has(d.id)) {
      plan.skippedInflight++;
      continue;
    }
    plan.enqueueIds.push(d.id);
  }
  return plan;
}

@Injectable()
export class Tr069FirmwareService {
  private readonly logger = new Logger(Tr069FirmwareService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Catálogo
  // ---------------------------------------------------------------------------

  async upload(
    tenantId: string,
    userId: string,
    file: { originalname: string; size: number; buffer: Buffer },
    fields: UploadTr069FirmwareFields,
  ): Promise<Tr069FirmwareDto> {
    if (!file?.buffer?.length) throw new BadRequestException('Envie o arquivo no campo "file"');
    if (file.size < MIN_FIRMWARE_BYTES) {
      throw new BadRequestException(
        `Arquivo de ${file.size} bytes não parece um firmware (mínimo ${MIN_FIRMWARE_BYTES / 1024}KB) — confira se não é um stub/página de erro renomeada`,
      );
    }
    if (file.size > MAX_FIRMWARE_BYTES) {
      throw new BadRequestException('Arquivo acima de 256MB');
    }
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const id = randomUUID();
    await mkdir(FIRMWARE_DIR, { recursive: true });
    const path = join(FIRMWARE_DIR, `${id}.bin`);
    await writeFile(path, file.buffer);
    try {
      const row = await this.prisma.tr069Firmware.create({
        data: {
          id,
          tenantId,
          vendor: fields.vendor,
          productClass: fields.productClass.trim(),
          version: fields.version.trim(),
          fileName: file.originalname.slice(0, 255),
          fileSize: file.size,
          checksum,
          notes: fields.notes?.trim() || null,
          createdBy: userId,
        },
      });
      await this.audit.log({
        tenantId,
        userId,
        action: 'tr069.firmware.upload',
        resource: 'tr069_firmware',
        resourceId: row.id,
        metadata: { vendor: row.vendor, productClass: row.productClass, version: row.version, fileSize: row.fileSize, checksum },
      });
      this.logger.log(
        `[tr069] firmware ${row.vendor}/${row.productClass} ${row.version} (${file.size} bytes, sha256=${checksum.slice(0, 12)}…) salvo em ${path}`,
      );
      return (await this.list(tenantId)).find((f) => f.id === row.id)!;
    } catch (err) {
      await unlink(path).catch(() => undefined);
      throw err;
    }
  }

  async list(tenantId: string): Promise<Tr069FirmwareDto[]> {
    const rows = await this.prisma.tr069Firmware.findMany({
      where: { tenantId },
      orderBy: [{ vendor: 'asc' }, { productClass: 'asc' }, { createdAt: 'desc' }],
    });
    if (rows.length === 0) return [];
    // Parque por modelo (uma passada) — total/online/na-versão pra UI.
    const classes = [...new Set(rows.map((r) => r.productClass))];
    const byClassStatus = await this.prisma.tr069Device.groupBy({
      by: ['productClass', 'status'],
      where: { tenantId, productClass: { in: classes } },
      _count: { _all: true },
    });
    const byClassVersion = await this.prisma.tr069Device.groupBy({
      by: ['productClass', 'softwareVersion'],
      where: { tenantId, productClass: { in: classes } },
      _count: { _all: true },
    });
    return rows.map((r) => {
      const statuses = byClassStatus.filter((g) => g.productClass === r.productClass);
      const total = statuses.reduce((a, g) => a + g._count._all, 0);
      const online = statuses
        .filter((g) => g.status === 'ONLINE')
        .reduce((a, g) => a + g._count._all, 0);
      const onVersion =
        byClassVersion.find(
          (g) => g.productClass === r.productClass && g.softwareVersion === r.version,
        )?._count._all ?? 0;
      return {
        id: r.id,
        vendor: r.vendor as Tr069FirmwareDto['vendor'],
        productClass: r.productClass,
        version: r.version,
        fileName: r.fileName,
        fileSize: r.fileSize,
        checksum: r.checksum,
        notes: r.notes,
        createdAt: r.createdAt.toISOString(),
        deviceTotal: total,
        deviceOnline: online,
        deviceOnVersion: onVersion,
      };
    });
  }

  async remove(tenantId: string, userId: string, id: string): Promise<void> {
    const fw = await this.prisma.tr069Firmware.findFirst({ where: { id, tenantId } });
    if (!fw) throw new NotFoundException('Firmware não encontrado');
    await this.prisma.tr069Firmware.delete({ where: { id: fw.id } });
    await unlink(join(FIRMWARE_DIR, `${fw.id}.bin`)).catch(() => undefined);
    await this.audit.log({
      tenantId,
      userId,
      action: 'tr069.firmware.delete',
      resource: 'tr069_firmware',
      resourceId: fw.id,
      metadata: { vendor: fw.vendor, productClass: fw.productClass, version: fw.version },
    });
  }

  // ---------------------------------------------------------------------------
  // Rollout
  // ---------------------------------------------------------------------------

  async deploy(
    tenantId: string,
    userId: string,
    firmwareId: string,
    input: DeployTr069FirmwareRequest,
  ): Promise<Tr069FirmwareDeployResult> {
    if (!FIRMWARE_BASE_URL) {
      throw new BadRequestException(
        'Defina TR069_FIRMWARE_BASE_URL (origem HTTP que o CPE alcança, ex.: http://acs.exemplo:7547) antes de disparar firmware',
      );
    }
    const fw = await this.prisma.tr069Firmware.findFirst({ where: { id: firmwareId, tenantId } });
    if (!fw) throw new NotFoundException('Firmware não encontrado');

    const select = { id: true, deviceId: true, status: true, softwareVersion: true, productClass: true } as const;
    let candidates: Array<{
      id: string;
      deviceId: string;
      status: string;
      softwareVersion: string | null;
      productClass: string | null;
    }>;
    if (input.target === 'DEVICES') {
      candidates = await this.prisma.tr069Device.findMany({
        where: { tenantId, id: { in: input.deviceIds ?? [] } },
        select,
      });
      const missing = (input.deviceIds ?? []).filter((id) => !candidates.some((d) => d.id === id));
      if (missing.length > 0) {
        throw new BadRequestException(`Devices não encontrados no tenant: ${missing.join(', ')}`);
      }
      // Trava anti-brick: firmware é POR MODELO. Recusa a seleção inteira em
      // vez de pular silenciosamente — quem dispara precisa saber que errou.
      const wrong = candidates.filter((d) => d.productClass !== fw.productClass);
      if (wrong.length > 0) {
        throw new BadRequestException(
          `Firmware é do modelo ${fw.productClass}, mas a seleção tem outro modelo: ${wrong
            .map((d) => `${d.deviceId} (${d.productClass ?? '?'})`)
            .join(', ')}`,
        );
      }
    } else {
      candidates = await this.prisma.tr069Device.findMany({
        where: { tenantId, productClass: fw.productClass },
        select,
      });
    }

    const inflight = await this.prisma.tr069Task.findMany({
      where: {
        tenantId,
        deviceId: { in: candidates.map((d) => d.id) },
        action: 'DOWNLOAD',
        status: { in: ['PENDING', 'RUNNING'] },
      },
      select: { deviceId: true },
    });
    const plan = planFirmwareDeploy(
      candidates,
      fw.version,
      { onlyOnline: input.onlyOnline, skipSameVersion: input.skipSameVersion },
      new Set(inflight.map((t) => t.deviceId)),
    );

    const url = `${FIRMWARE_BASE_URL.replace(/\/+$/, '')}/fw/${fw.id}`;
    if (plan.enqueueIds.length > 0) {
      await this.prisma.tr069Task.createMany({
        data: plan.enqueueIds.map((deviceId) => ({
          tenantId,
          deviceId,
          action: 'DOWNLOAD' as const,
          payload: {
            url,
            fileType: '1 Firmware Upgrade Image',
            fileSize: fw.fileSize,
            purpose: `FW_${fw.version}`,
            firmwareId: fw.id,
          },
          status: 'PENDING' as const,
        })),
      });
    }
    await this.audit.log({
      tenantId,
      userId,
      action: 'tr069.firmware.deploy',
      resource: 'tr069_firmware',
      resourceId: fw.id,
      metadata: {
        target: input.target,
        version: fw.version,
        productClass: fw.productClass,
        enqueued: plan.enqueueIds.length,
        skippedSameVersion: plan.skippedSameVersion,
        skippedInflight: plan.skippedInflight,
        skippedOffline: plan.skippedOffline,
      },
    });
    this.logger.log(
      `[tr069] firmware ${fw.version} → ${plan.enqueueIds.length}/${candidates.length} device(s) ${fw.productClass} (url=${url})`,
    );
    return {
      enqueued: plan.enqueueIds.length,
      skippedSameVersion: plan.skippedSameVersion,
      skippedInflight: plan.skippedInflight,
      skippedOffline: plan.skippedOffline,
      total: candidates.length,
    };
  }

  async deployStatus(tenantId: string, firmwareId: string): Promise<Tr069FirmwareDeployStatus> {
    const fw = await this.prisma.tr069Firmware.findFirst({ where: { id: firmwareId, tenantId } });
    if (!fw) throw new NotFoundException('Firmware não encontrado');
    const tasks = await this.prisma.tr069Task.findMany({
      where: {
        tenantId,
        action: 'DOWNLOAD',
        payload: { path: ['firmwareId'], equals: firmwareId },
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
      include: { device: { select: { deviceId: true, softwareVersion: true } } },
    });
    const counts = { pending: 0, running: 0, done: 0, failed: 0 };
    for (const t of tasks) {
      if (t.status === 'PENDING') counts.pending++;
      else if (t.status === 'RUNNING') counts.running++;
      else if (t.status === 'DONE') counts.done++;
      else counts.failed++;
    }
    const deviceOnVersion = await this.prisma.tr069Device.count({
      where: { tenantId, productClass: fw.productClass, softwareVersion: fw.version },
    });
    return {
      firmwareId: fw.id,
      version: fw.version,
      counts,
      deviceOnVersion,
      devices: tasks.map((t) => ({
        taskId: t.id,
        deviceDbId: t.deviceId,
        deviceId: t.device.deviceId,
        softwareVersion: t.device.softwareVersion,
        status: t.status,
        error: t.error,
        updatedAt: t.updatedAt.toISOString(),
      })),
    };
  }
}

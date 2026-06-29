import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DeviceJobsService } from '../queue/device-jobs.service.js';
import { DevicesService } from '../devices/devices.service.js';
import type { DeviceVendor } from '../devices/device.dto.js';
import { findPlaybook, playbooksForVendor, resolveCommand } from './playbooks.catalog.js';

@Injectable()
export class PlaybooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
    private readonly audit: AuditService,
    private readonly jobs: DeviceJobsService,
  ) {}

  /** Catálogo de playbooks para um vendor (default juniper, compat MVP). */
  list(vendor: DeviceVendor = 'juniper') {
    return playbooksForVendor(vendor);
  }

  /** Roda um playbook read-only no device via gateway e devolve a saída em texto. */
  async run(deviceId: string, playbookId: string, actor: string) {
    const device = await this.devices.findOne(deviceId);
    const playbook = findPlaybook(playbookId);
    if (!playbook) throw new NotFoundException(`Playbook ${playbookId} não existe`);

    const command = resolveCommand(playbook, device.vendor as DeviceVendor);
    if (!command) {
      throw new BadRequestException(
        `Playbook ${playbookId} não tem comando para o vendor ${device.vendor}`,
      );
    }

    const cred = await this.prisma.deviceCredential.findUnique({ where: { deviceId } });
    if (!cred?.passwordEnc) {
      throw new BadRequestException('Cadastre credenciais (senha) antes de rodar playbooks');
    }

    const result = await this.jobs.enqueueAndWait(
      {
        jobId: randomUUID(),
        deviceId,
        requestedBy: actor,
        requestedAt: new Date().toISOString(),
        kind: 'run-playbook',
        params: {
          mgmtIp: device.mgmtIp,
          username: cred.username,
          passwordEnc: cred.passwordEnc,
          vendor: device.vendor,
          playbookId,
          command,
        },
      },
      { waitMs: 45_000 },
    );

    const output = result.data?.kind === 'run-playbook' ? result.data.output : undefined;
    await this.audit.record({
      actor,
      deviceId,
      action: 'device.playbook.run',
      command,
      result: result.ok ? 'ok' : (result.error ?? 'falha'),
    });

    if (!result.ok) {
      throw new BadRequestException(`Playbook falhou: ${result.error ?? 'erro desconhecido'}`);
    }
    return { playbookId, command, output };
  }
}

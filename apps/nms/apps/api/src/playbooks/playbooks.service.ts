import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DeviceJobsService } from '../queue/device-jobs.service.js';
import { DevicesService } from '../devices/devices.service.js';
import { PLAYBOOKS, findPlaybook } from './playbooks.catalog.js';

@Injectable()
export class PlaybooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
    private readonly audit: AuditService,
    private readonly jobs: DeviceJobsService,
  ) {}

  list() {
    return PLAYBOOKS.map((p) => ({ id: p.id, name: p.name, command: p.command }));
  }

  /** Roda um playbook read-only no device via gateway (PyEZ) e devolve a saída em texto. */
  async run(deviceId: string, playbookId: string, actor: string) {
    const device = await this.devices.findOne(deviceId);
    const playbook = findPlaybook(playbookId);
    if (!playbook) throw new NotFoundException(`Playbook ${playbookId} não existe`);

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
          playbookId,
          command: playbook.command,
        },
      },
      { waitMs: 45_000 },
    );

    const output = result.data?.kind === 'run-playbook' ? result.data.output : undefined;
    await this.audit.record({
      actor,
      deviceId,
      action: 'device.playbook.run',
      command: playbook.command,
      result: result.ok ? 'ok' : (result.error ?? 'falha'),
    });

    if (!result.ok) {
      throw new BadRequestException(`Playbook falhou: ${result.error ?? 'erro desconhecido'}`);
    }
    return { playbookId, command: playbook.command, output };
  }
}

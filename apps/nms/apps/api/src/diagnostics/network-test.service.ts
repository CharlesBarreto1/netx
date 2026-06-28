import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DeviceJobsService, type JobStatus } from '../queue/device-jobs.service.js';

/** Job sem device real (probe do host): deviceId sentinela. */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export interface NetworkTestInput {
  testType?: 'ping' | 'traceroute';
  target: string;
  source?: 'host' | 'device';
  /** Nome/hostname/site do equipamento quando source='device'. */
  device?: string;
}

@Injectable()
export class NetworkTestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: DeviceJobsService,
  ) {}

  /** Enfileira o teste (async) e devolve o jobId para polling. */
  async enqueue(input: NetworkTestInput, actor: string): Promise<{ jobId: string }> {
    const testType = input.testType ?? 'ping';
    const source = input.source ?? 'host';
    const target = input.target?.trim();
    if (!target) throw new BadRequestException('target obrigatório');

    let deviceId = NIL_UUID;
    const params: {
      testType: 'ping' | 'traceroute';
      target: string;
      source: 'host' | 'device';
      mgmtIp?: string;
      username?: string;
      passwordEnc?: string;
    } = { testType, target, source };

    if (source === 'device') {
      const q = input.device?.trim();
      if (!q) throw new BadRequestException('source=device requer o nome do equipamento');
      const device = await this.prisma.device.findFirst({
        where: {
          OR: [
            { hostname: { contains: q, mode: 'insensitive' } },
            { site: { contains: q, mode: 'insensitive' } },
          ],
        },
      });
      if (!device) throw new BadRequestException(`equipamento não encontrado: "${q}"`);
      const cred = await this.prisma.deviceCredential.findUnique({
        where: { deviceId: device.id },
      });
      if (!cred) {
        throw new BadRequestException(`equipamento "${device.hostname}" sem credencial cadastrada`);
      }
      deviceId = device.id;
      params.mgmtIp = device.mgmtIp;
      params.username = cred.username;
      params.passwordEnc = cred.passwordEnc ?? undefined;
    }

    const jobId = await this.jobs.enqueueAsync({
      jobId: randomUUID(),
      deviceId,
      requestedBy: actor,
      requestedAt: new Date().toISOString(),
      kind: 'network-test',
      params,
    });

    await this.audit.record({
      actor,
      deviceId: deviceId === NIL_UUID ? undefined : deviceId,
      action: 'device.network-test',
      diff: JSON.stringify({ testType, target, source }),
      result: 'enfileirado',
    });

    return { jobId };
  }

  getStatus(jobId: string): Promise<JobStatus> {
    return this.jobs.getStatus(jobId);
  }
}

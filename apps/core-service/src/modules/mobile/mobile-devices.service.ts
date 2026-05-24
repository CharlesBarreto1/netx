import { Injectable } from '@nestjs/common';
import type { MobileDevice } from '@prisma/client';

import type { PairDeviceRequest, PairDeviceResponse } from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MobileDevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async pair(
    tenantId: string,
    userId: string,
    input: PairDeviceRequest,
    ctx: { ip?: string; userAgent?: string } = {},
  ): Promise<PairDeviceResponse> {
    const now = new Date();
    const device = await this.prisma.mobileDevice.upsert({
      where: {
        tenantId_userId_deviceId: {
          tenantId,
          userId,
          deviceId: input.deviceId,
        },
      },
      create: {
        tenantId,
        userId,
        deviceId: input.deviceId,
        platform: input.platform,
        model: input.model ?? null,
        osVersion: input.osVersion ?? null,
        appVersion: input.appVersion,
        pushToken: input.pushToken ?? null,
        lastSeenAt: now,
      },
      update: {
        platform: input.platform,
        model: input.model ?? null,
        osVersion: input.osVersion ?? null,
        appVersion: input.appVersion,
        pushToken: input.pushToken ?? null,
        lastSeenAt: now,
        // Re-pair de um device revogado limpa a revogação. Admin que quer
        // bloquear devolutiva precisa também desativar o user.
        revokedAt: null,
        revokedReason: null,
      },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: 'mobile.device.pair',
      resource: 'mobile_device',
      resourceId: device.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {
        deviceId: input.deviceId,
        platform: input.platform,
        appVersion: input.appVersion,
      },
    });

    return this.toResponse(device);
  }

  private toResponse(device: MobileDevice): PairDeviceResponse {
    return {
      id: device.id,
      deviceId: device.deviceId,
      platform: device.platform,
      appVersion: device.appVersion,
      lastSeenAt: device.lastSeenAt.toISOString(),
      createdAt: device.createdAt.toISOString(),
      revoked: device.revokedAt !== null,
    };
  }
}

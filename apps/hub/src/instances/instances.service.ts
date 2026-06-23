import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';

import { BillingService } from '../billing/billing.service';
import { sha256Hex } from '../common/hash';
import { PrismaService } from '../prisma/prisma.service';
import { SigningService } from '../signing/signing.service';
import type { HeartbeatRequest } from './heartbeat.dto';

/**
 * Lógica do heartbeat: autentica a instância pela license key, grava
 * telemetria e emite o token assinado refletindo o status atual da instância.
 *
 * Status do token = status da Instance no Hub:
 *   ACTIVE    → token ACTIVE (cliente libera)
 *   BLOCKED   → token BLOCKED (cliente bloqueia na hora)
 *   SUSPENDED → token SUSPENDED (idem)
 * O plano/maxContracts/blockMode vêm do licenciado/instância.
 */
@Injectable()
export class InstancesService {
  private readonly logger = new Logger(InstancesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly signing: SigningService,
    private readonly billing: BillingService,
  ) {}

  async heartbeat(
    licenseKey: string,
    body: HeartbeatRequest,
    ip: string,
  ): Promise<{ token: string }> {
    const keyHash = sha256Hex(licenseKey);
    const instance = await this.prisma.instance.findUnique({
      where: { keyHash },
      include: { licensee: true },
    });

    // Sem vazar qual das duas falhou (key inválida vs id divergente).
    if (!instance || instance.id !== body.instanceId) {
      this.logger.warn(`Heartbeat rejeitado (instanceId=${body.instanceId})`);
      throw new UnauthorizedException('credenciais de licença inválidas');
    }

    // Telemetria: atualiza o último estado + grava log (base do faturamento).
    await this.prisma.$transaction([
      this.prisma.instance.update({
        where: { id: instance.id },
        data: {
          lastVersion: body.version,
          lastActiveContracts: body.activeContracts,
          lastHeartbeatAt: new Date(),
          lastIp: ip ?? null,
        },
      }),
      this.prisma.heartbeatLog.create({
        data: {
          instanceId: instance.id,
          version: body.version,
          activeContracts: body.activeContracts,
          ip: ip ?? null,
        },
      }),
    ]);

    // Status efetivo = bloqueio do admin (instance.status) tem prioridade;
    // senão, inadimplência (fatura vencida sem desbloqueio em confiança) bloqueia.
    let effectiveStatus = instance.status;
    if (effectiveStatus === 'ACTIVE' && (await this.billing.isDelinquent(instance.licenseeId))) {
      effectiveStatus = 'BLOCKED';
    }

    const { token } = this.signing.issue({
      instanceId: instance.id,
      status: effectiveStatus,
      blockMode: instance.blockMode,
      plan: instance.licensee.plan,
      maxContracts: instance.licensee.maxContracts,
      modules: instance.licensee.modules,
    });
    return { token };
  }
}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomBytes } from 'node:crypto';
import {
  LicenseHeartbeatRequestSchema,
  type LicenseHeartbeatResponse,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { LicensingService } from './licensing.service';

// Versão reportada ao Hub. Fonte simples (package.json não está disponível em
// runtime no bundle); mantemos sincronizado com o boot banner.
const NETX_VERSION = process.env.NETX_VERSION ?? '0.1.0';

/**
 * HeartbeatService — fala com o Hub uma vez por dia (com jitter) pra renovar o
 * token de licença e reportar telemetria de cobrança (contratos ativos).
 *
 * Resiliente: falha de rede/Hub NÃO derruba nada — só registra o erro; o token
 * vigente continua valendo até expirar (TTL de 7 dias). Roda só quando o
 * licenciamento está ligado.
 */
@Injectable()
export class HeartbeatService implements OnModuleInit {
  private readonly logger = new Logger(HeartbeatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly licensing: LicensingService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.licensing.isEnabled()) return;
    // Heartbeat no boot, com pequeno atraso aleatório (5–35s) pra não bater no
    // Hub no mesmo instante que outras instâncias subindo juntas.
    const delayMs = 5_000 + Math.floor((randomBytes(2).readUInt16BE(0) / 65535) * 30_000);
    setTimeout(() => {
      void this.beat('boot');
    }, delayMs);
  }

  // Diário às 07:00 do host. O jitter abaixo espalha o disparo real ao longo
  // de ~30min pra não criar um pico de requests no Hub às 07:00 cravadas.
  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async daily(): Promise<void> {
    if (!this.licensing.isEnabled()) return;
    const jitterMs = Math.floor((randomBytes(2).readUInt16BE(0) / 65535) * 30 * 60_000);
    setTimeout(() => {
      void this.beat('cron');
    }, jitterMs);
  }

  /** Executa um heartbeat: POST ao Hub → aplica o token retornado. */
  async beat(trigger: 'boot' | 'cron' | 'manual'): Promise<void> {
    const { hubUrl, licenseKey, instanceId } = this.licensing;
    if (!hubUrl || !licenseKey || !instanceId) return;

    let activeContracts = 0;
    try {
      activeContracts = await this.prisma.contract.count({
        where: { status: 'ACTIVE', deletedAt: null },
      });
    } catch {
      // Se nem o banco responde, deixa 0 — a telemetria é best-effort.
    }

    const payload = LicenseHeartbeatRequestSchema.parse({
      instanceId,
      version: NETX_VERSION,
      activeContracts,
      nonce: randomBytes(16).toString('hex'),
    });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(`${hubUrl.replace(/\/$/, '')}/v1/instances/heartbeat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${licenseKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (!res.ok) {
        await this.licensing.recordHeartbeatError(`Hub respondeu ${res.status}`);
        this.logger.warn(`Heartbeat (${trigger}): Hub respondeu ${res.status}`);
        return;
      }
      const body = (await res.json()) as LicenseHeartbeatResponse;
      if (!body?.token) {
        await this.licensing.recordHeartbeatError('Hub não retornou token');
        return;
      }
      const decision = await this.licensing.applyToken(body.token);
      this.logger.log(`Heartbeat (${trigger}) ok — efeito: ${decision.effect}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'erro de rede';
      await this.licensing.recordHeartbeatError(reason);
      this.logger.warn(`Heartbeat (${trigger}) falhou: ${reason} (token vigente mantido)`);
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';

import type { EventEnvelope } from '@netx/core-sdk';

import { WifiOptService } from '../provisioning/wifi-opt.service';
import type { EventHandler } from './event-handler';
import { ERP_CONTRACT_PLAN_CHANGED, type ContractPlanChangedPayload } from './event-types';

/**
 * Handler do WiFi-Opt para `netx-erp.contract.plan-changed` — o FAST-PATH da
 * mudança de plano (bus ligado): re-avalia o profile do pacote de otimização
 * Wi-Fi (BASE/GIGA) e ajusta SÓ a largura de canal (WIDTH_ONLY) quando mudou.
 *
 * O bus é acelerador best-effort (ack-sem-retry, off por default) — a GARANTIA
 * é o sweepDue() horário do WifiOptService (item c: drift de profile). Por
 * isso o handler é IDEMPOTENTE por construção: ignora o payload além dos IDs
 * e RELÊ `contract.bandwidthMbps` + capability do DB — re-entrega
 * at-least-once encontra alvo==atual e não faz nada.
 */
@Injectable()
export class WifiOptEventsHandler implements EventHandler {
  readonly pattern = ERP_CONTRACT_PLAN_CHANGED;
  private readonly logger = new Logger(WifiOptEventsHandler.name);

  constructor(private readonly wifiOpt: WifiOptService) {}

  async handle(env: EventEnvelope): Promise<void> {
    const p = (env.payload ?? {}) as Partial<ContractPlanChangedPayload>;
    if (!p.contractId) return;
    this.logger.log(
      `[wifi-opt] plan-changed tenant=${env.tenantId} contract=${p.contractId} — re-avaliando profile`,
    );
    await this.wifiOpt.reevaluateForContract(env.tenantId, p.contractId);
  }
}

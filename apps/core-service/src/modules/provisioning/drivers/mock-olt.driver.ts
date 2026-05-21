/**
 * MockOltDriver — simula uma OLT pra Fase 1 / dev / testes E2E.
 *
 * Sempre retorna sucesso (com pequeno delay aleatório pra UI testar timeline).
 * Cuidados:
 *   - NUNCA usar em produção. Validação no ProvisioningService:
 *     se NODE_ENV=production && providerMode=DIRECT && vendor=GENERIC →
 *     loga warning. Não bloqueia (admin pode estar simulando intencionalmente).
 *   - Retorna SN exatamente como recebido (não inventa).
 *   - PonOnuIndex é determinístico baseado em hash do SN pra estabilidade.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';

import {
  type AuthorizeOntInput,
  type AuthorizedOntResult,
  type OltConnectionContext,
  type OltDriver,
  type OltDriverResult,
  type OntStatusResult,
  runDriverCall,
} from './olt-driver.interface';

const MIN_DELAY_MS = 200;
const MAX_DELAY_MS = 1500;

function randomDelay(): Promise<void> {
  const ms = MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
  return new Promise((r) => setTimeout(r, ms));
}

function hashIndex(sn: string, mod: number): number {
  const h = createHash('sha256').update(sn).digest();
  return h.readUInt32BE(0) % mod;
}

@Injectable()
export class MockOltDriver implements OltDriver {
  readonly name = 'mock';
  private readonly logger = new Logger(MockOltDriver.name);

  async testConnection(_ctx: OltConnectionContext): Promise<OltDriverResult<{ message: string }>> {
    return runDriverCall(async () => {
      await randomDelay();
      return { message: 'mock OLT — sempre online' };
    });
  }

  async authorizeOnt(
    ctx: OltConnectionContext,
    input: AuthorizeOntInput,
  ): Promise<OltDriverResult<AuthorizedOntResult>> {
    return runDriverCall(async () => {
      await randomDelay();
      this.logger.log(
        `[MOCK] authorize SN=${input.snGpon} contract=${input.contractRef} ` +
          `band=${input.bandwidthMbps}Mbps vlan=${input.vlanId ?? ctx.defaults.serviceVlanId ?? '?'}`,
      );
      const frame = input.ponFrame ?? 0;
      const slot = input.ponSlot ?? 1;
      const onuIndex = hashIndex(input.snGpon, 128) + 1; // 1..128
      return {
        snGpon: input.snGpon,
        macAddress: input.macAddress,
        ponFrame: frame,
        ponSlot: slot,
        ponOnuIndex: onuIndex,
        providerOntRef: `mock:${ctx.oltId}:${input.snGpon}`,
      };
    });
  }

  async deauthorizeOnt(
    _ctx: OltConnectionContext,
    snGpon: string,
  ): Promise<OltDriverResult<{ message: string }>> {
    return runDriverCall(async () => {
      await randomDelay();
      return { message: `mock OLT — SN ${snGpon} desautorizado` };
    });
  }

  async getOntStatus(
    _ctx: OltConnectionContext,
    snGpon: string,
  ): Promise<OltDriverResult<OntStatusResult>> {
    return runDriverCall(async () => {
      await randomDelay();
      // Probabilidade fixa de "online" pro mock. SN com hash par = online.
      const isOnline = hashIndex(snGpon, 2) === 0;
      return {
        status: isOnline ? 'ONLINE' : 'AUTHORIZED',
        lastRxPower: isOnline ? -18.5 : null,
        lastTxPower: isOnline ? 2.3 : null,
      };
    });
  }
}

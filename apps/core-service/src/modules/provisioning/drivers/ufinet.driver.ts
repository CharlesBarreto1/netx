/**
 * UfinetOrchestratorDriver — rede neutra PY (API TM Forum).
 *
 * IMPORTANTE: a integração real da Ufinet NÃO mora aqui. A API é assíncrona e
 * multi-etapa (alta na criação do contrato → confirmar ONT em campo →
 * confirmação final), o que não cabe no contrato síncrono do OltDriver. Toda a
 * lógica vive em `modules/ufinet/` (UfinetOrdersService + poller) e é disparada
 * por hooks explícitos no ciclo de vida do contrato:
 *   - contracts.create()            → UfinetOrdersService.enqueueProvide()
 *   - provisioning.installCustomer()→ UfinetOrdersService.requestConfirmOnt()
 *   - contracts.suspend/reactivate  → requestSuspend/requestReactivate()
 *   - contracts.cancel()            → requestTeardown() (baja/cancelación)
 *
 * Este driver, como o NoOpOltDriver, apenas reconhece a operação no fluxo de
 * provisioning local (registra a ONT como AUTHORIZED no NetX para o RADIUS/
 * PPPoE local autorizar — Caso A) e retorna sucesso. Não fabrica dados.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { Injectable, Logger } from '@nestjs/common';

import {
  type AuthorizeOntInput,
  type AuthorizedOntResult,
  type OltConnectionContext,
  type OltDriver,
  type OltDriverResult,
  type OntStatusResult,
  runDriverCall,
} from './olt-driver.interface';

@Injectable()
export class UfinetOrchestratorDriver implements OltDriver {
  readonly name = 'ufinet';
  private readonly logger = new Logger(UfinetOrchestratorDriver.name);

  async testConnection(): Promise<OltDriverResult<{ message: string }>> {
    // O test-connection real (OAuth + GET) é feito pelo módulo ufinet via a
    // OLT configurada. Aqui só confirmamos que o modo é suportado.
    return runDriverCall(async () => ({
      message:
        'OLT Ufinet (ORCHESTRATOR) — provisão via API TMF assíncrona no módulo ufinet. ' +
        'Use a configuração da OLT (operator/region/polygonAlias + credenciais).',
    }));
  }

  async authorizeOnt(
    _ctx: OltConnectionContext,
    input: AuthorizeOntInput,
  ): Promise<OltDriverResult<AuthorizedOntResult>> {
    return runDriverCall(async () => {
      this.logger.log(
        `[UFINET] ONT ${input.snGpon} (contract=${input.contractRef}) registrada no NetX; ` +
          'confirmação óptica é enfileirada na Ufinet via hook do installCustomer.',
      );
      return {
        snGpon: input.snGpon,
        macAddress: input.macAddress,
        ponFrame: input.ponFrame ?? null,
        ponSlot: input.ponSlot ?? null,
        ponOnuIndex: null,
        providerOntRef: null,
      };
    });
  }

  async deauthorizeOnt(
    _ctx: OltConnectionContext,
    snGpon: string,
  ): Promise<OltDriverResult<{ message: string }>> {
    return runDriverCall(async () => {
      this.logger.log(
        `[UFINET] desautorização da ONT ${snGpon} — baja/cancelación é disparada ` +
          'via hook do contracts.cancel (módulo ufinet).',
      );
      return { message: 'Baja/cancelación Ufinet é tratada no ciclo de vida do contrato.' };
    });
  }

  async getOntStatus(
    _ctx: OltConnectionContext,
    _snGpon: string,
  ): Promise<OltDriverResult<OntStatusResult>> {
    return runDriverCall(async () => ({
      status: 'AUTHORIZED',
      lastRxPower: null,
      lastTxPower: null,
    }));
  }
}

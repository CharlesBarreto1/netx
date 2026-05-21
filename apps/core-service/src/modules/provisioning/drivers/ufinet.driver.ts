/**
 * UfinetOrchestratorDriver — STUB / Fase 2.
 *
 * Quando a doc da API Ufinet chegar (vide task #29), aqui vai a implementação
 * REST cliente: OAuth2/API-key auth, endpoints de authorize/deauthorize/status,
 * webhook receiver opcional.
 *
 * Decisão tomada com o admin (NetX 2026-05-21):
 *   - RADIUS local NetX continua autorizando o tráfego (Caso A).
 *   - Ufinet só provisiona a camada óptica (autoriza SN na OLT deles).
 *   - MAC da ONT vem da Ufinet via response do authorize ou webhook.
 *
 * Por hora o stub lança "não implementado" pra forçar admin a usar Mock até
 * a doc chegar. Quando implementar, segue padrão MockOltDriver pra retornar
 * `OltDriverResult<T>` sem lançar pra falhas operacionais.
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

  async testConnection(ctx: OltConnectionContext): Promise<OltDriverResult<{ message: string }>> {
    return runDriverCall(async () => {
      this.logger.warn(
        `Ufinet driver ainda não implementado — aguardando doc API ` +
          `(endpoint=${ctx.apiEndpoint ?? '?'})`,
      );
      throw new Error(
        'UfinetOrchestratorDriver: stub não-implementado. Use providerMode=DIRECT + ' +
          'vendor=GENERIC com MockOltDriver enquanto aguarda doc da Ufinet.',
      );
    });
  }

  async authorizeOnt(
    _ctx: OltConnectionContext,
    input: AuthorizeOntInput,
  ): Promise<OltDriverResult<AuthorizedOntResult>> {
    return runDriverCall(async () => {
      this.logger.warn(`Ufinet authorize stub — SN=${input.snGpon}`);
      throw new Error('UfinetOrchestratorDriver: stub não-implementado.');
    });
  }

  async deauthorizeOnt(
    _ctx: OltConnectionContext,
    snGpon: string,
  ): Promise<OltDriverResult<{ message: string }>> {
    return runDriverCall(async () => {
      this.logger.warn(`Ufinet deauthorize stub — SN=${snGpon}`);
      throw new Error('UfinetOrchestratorDriver: stub não-implementado.');
    });
  }

  async getOntStatus(
    _ctx: OltConnectionContext,
    snGpon: string,
  ): Promise<OltDriverResult<OntStatusResult>> {
    return runDriverCall(async () => {
      this.logger.warn(`Ufinet status stub — SN=${snGpon}`);
      throw new Error('UfinetOrchestratorDriver: stub não-implementado.');
    });
  }
}

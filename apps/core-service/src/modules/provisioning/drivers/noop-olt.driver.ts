/**
 * NoOpOltDriver — usado quando `Olt.providerMode = EXTERNAL`.
 *
 * Não faz nenhuma chamada externa (sem SSH, sem API). Sempre retorna sucesso.
 * Admin é responsável por garantir que a OLT real já está provisionada (via
 * web do vendor, NMS de terceiros, ou Ufinet manual).
 *
 * Diferença vs MockOltDriver:
 *   - Mock simula delay + alguns dados aleatórios pra UI testar timeline.
 *     Útil em dev/testes mas confunde em produção (admin vê "PonOnuIndex=42"
 *     que é fake).
 *   - NoOp é honesto: retorna SN exatamente como recebido, posição PON null,
 *     sem fabricar dados. Em produção real, é o caminho correto.
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
export class NoOpOltDriver implements OltDriver {
  readonly name = 'noop-external';
  private readonly logger = new Logger(NoOpOltDriver.name);

  async testConnection(): Promise<OltDriverResult<{ message: string }>> {
    return runDriverCall(async () => {
      return {
        message:
          'OLT em modo EXTERNAL — provisionamento óptico é manual. ' +
          'NetX não testa conectividade (sem credenciais).',
      };
    });
  }

  async authorizeOnt(
    _ctx: OltConnectionContext,
    input: AuthorizeOntInput,
  ): Promise<OltDriverResult<AuthorizedOntResult>> {
    return runDriverCall(async () => {
      this.logger.log(
        `[EXTERNAL] registrando ONT no NetX (provisão real fora do sistema): ` +
          `SN=${input.snGpon} contract=${input.contractRef} band=${input.bandwidthMbps}Mbps`,
      );
      // Honesto: não preenchemos posição PON nem providerOntRef — não
      // sabemos. Admin/técnico já provisionou manualmente.
      return {
        snGpon: input.snGpon,
        macAddress: input.macAddress, // se admin já sabe, registra
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
      this.logger.warn(
        `[EXTERNAL] cancelamento de ONT ${snGpon} — desautorize MANUALMENTE ` +
          'na OLT real (NetX não toca lá).',
      );
      return {
        message:
          'ONT marcada como desautorizada no NetX. ' +
          'Lembre de desativar fisicamente na OLT real.',
      };
    });
  }

  async getOntStatus(
    _ctx: OltConnectionContext,
    _snGpon: string,
  ): Promise<OltDriverResult<OntStatusResult>> {
    return runDriverCall(async () => {
      // Sem visibilidade na OLT real — confiamos no estado registrado no NetX
      // (atualizado via TR-069 Inform ou RADIUS Accounting).
      return {
        status: 'AUTHORIZED',
        lastRxPower: null,
        lastTxPower: null,
      };
    });
  }
}

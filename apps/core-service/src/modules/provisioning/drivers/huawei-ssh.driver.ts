/**
 * HuaweiSshDriver — STUB / Fase BR (futura).
 *
 * Quando expandir pro Brasil com OLTs Huawei MA5800-X2/X7/X17, EA5800,
 * implementação SSH CLI:
 *   - lib `ssh2` (já transitively presente via outras deps)
 *   - `enable` + `config` mode
 *   - `display ont info` pra status
 *   - `ont add` / `service-port add` pra provisionar
 *   - `ont delete` pra desautorizar
 *
 * Por hora stub lança "não implementado". Documentação dos comandos
 * Huawei: V800R022 CLI Reference.
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
export class HuaweiSshDriver implements OltDriver {
  readonly name = 'huawei-ssh';
  private readonly logger = new Logger(HuaweiSshDriver.name);

  async testConnection(_ctx: OltConnectionContext): Promise<OltDriverResult<{ message: string }>> {
    return runDriverCall(async () => {
      this.logger.warn('HuaweiSshDriver stub — Fase BR não implementada');
      throw new Error('HuaweiSshDriver: implementação Fase BR pendente.');
    });
  }

  async authorizeOnt(
    _ctx: OltConnectionContext,
    _input: AuthorizeOntInput,
  ): Promise<OltDriverResult<AuthorizedOntResult>> {
    return runDriverCall(async () => {
      throw new Error('HuaweiSshDriver: implementação Fase BR pendente.');
    });
  }

  async deauthorizeOnt(
    _ctx: OltConnectionContext,
    _snGpon: string,
  ): Promise<OltDriverResult<{ message: string }>> {
    return runDriverCall(async () => {
      throw new Error('HuaweiSshDriver: implementação Fase BR pendente.');
    });
  }

  async getOntStatus(
    _ctx: OltConnectionContext,
    _snGpon: string,
  ): Promise<OltDriverResult<OntStatusResult>> {
    return runDriverCall(async () => {
      throw new Error('HuaweiSshDriver: implementação Fase BR pendente.');
    });
  }
}

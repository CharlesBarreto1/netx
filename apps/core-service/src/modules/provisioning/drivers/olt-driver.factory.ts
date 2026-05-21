/**
 * Factory que escolhe o OltDriver correto baseado em (vendor, providerMode).
 *
 * Decisão tree:
 *   providerMode=ORCHESTRATOR + vendor=UFINET    → UfinetOrchestratorDriver
 *   providerMode=ORCHESTRATOR + vendor=GENERIC   → MockOltDriver (dev/test)
 *   providerMode=DIRECT       + vendor=HUAWEI    → HuaweiSshDriver (futuro)
 *   providerMode=DIRECT       + vendor=GENERIC   → MockOltDriver
 *   demais combinações                            → throw (pra forçar
 *                                                   implementação explícita)
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { Injectable } from '@nestjs/common';
import type { OltProviderMode, OltVendor } from '@netx/shared';

import { HuaweiSshDriver } from './huawei-ssh.driver';
import { MockOltDriver } from './mock-olt.driver';
import type { OltDriver } from './olt-driver.interface';
import { UfinetOrchestratorDriver } from './ufinet.driver';

@Injectable()
export class OltDriverFactory {
  constructor(
    private readonly mock: MockOltDriver,
    private readonly ufinet: UfinetOrchestratorDriver,
    private readonly huawei: HuaweiSshDriver,
  ) {}

  resolve(vendor: OltVendor, providerMode: OltProviderMode): OltDriver {
    if (providerMode === 'ORCHESTRATOR') {
      if (vendor === 'UFINET') return this.ufinet;
      if (vendor === 'GENERIC') return this.mock;
      throw new Error(
        `Driver não implementado: providerMode=ORCHESTRATOR vendor=${vendor}. ` +
          'Implemente em modules/provisioning/drivers/ e registre no factory.',
      );
    }
    // DIRECT
    if (vendor === 'HUAWEI') return this.huawei;
    if (vendor === 'GENERIC') return this.mock;
    throw new Error(
      `Driver não implementado: providerMode=DIRECT vendor=${vendor}. ` +
        'Implemente em modules/provisioning/drivers/ e registre no factory.',
    );
  }
}

/**
 * Factory que escolhe o OltDriver correto baseado em (vendor, providerMode).
 *
 * Decisão tree:
 *   providerMode=EXTERNAL     + *                → NoOpOltDriver
 *                                                  (admin provisiona OLT fora
 *                                                  do NetX — manual via web,
 *                                                  NMS de terceiros, etc)
 *   providerMode=ORCHESTRATOR + vendor=UFINET    → UfinetOrchestratorDriver
 *   providerMode=ORCHESTRATOR + vendor=GENERIC   → MockOltDriver (dev/test)
 *   providerMode=DIRECT       + vendor=ZYXEL     → ZyxelZynosDriver (ZyNOS SSH)
 *   providerMode=DIRECT       + vendor=HUAWEI    → HuaweiSshDriver (futuro)
 *   providerMode=DIRECT       + vendor=FIBERHOME → FiberhomeTelnetDriver (AN5516,
 *                                                  telnet; descoberta de ONU)
 *   providerMode=DIRECT       + vendor=GENERIC   → MockOltDriver
 *   demais combinações                            → throw (pra forçar
 *                                                   implementação explícita)
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { Injectable } from '@nestjs/common';
import type { OltProviderMode, OltVendor } from '@netx/shared';

import { FiberhomeTelnetDriver } from './fiberhome-telnet.driver';
import { HuaweiSshDriver } from './huawei-ssh.driver';
import { MockOltDriver } from './mock-olt.driver';
import { NoOpOltDriver } from './noop-olt.driver';
import type { OltDriver } from './olt-driver.interface';
import { UfinetOrchestratorDriver } from './ufinet.driver';
import { ZyxelZynosDriver } from './zyxel-zynos.driver';

@Injectable()
export class OltDriverFactory {
  constructor(
    private readonly mock: MockOltDriver,
    private readonly noop: NoOpOltDriver,
    private readonly ufinet: UfinetOrchestratorDriver,
    private readonly huawei: HuaweiSshDriver,
    private readonly zyxel: ZyxelZynosDriver,
    private readonly fiberhome: FiberhomeTelnetDriver,
  ) {}

  resolve(vendor: OltVendor, providerMode: OltProviderMode): OltDriver {
    // EXTERNAL: ignora vendor. OLT é provisionada fora do NetX.
    if (providerMode === 'EXTERNAL') return this.noop;

    if (providerMode === 'ORCHESTRATOR') {
      if (vendor === 'UFINET') return this.ufinet;
      if (vendor === 'GENERIC') return this.mock;
      throw new Error(
        `Driver não implementado: providerMode=ORCHESTRATOR vendor=${vendor}. ` +
          'Use providerMode=EXTERNAL se a OLT é provisionada manualmente, ou ' +
          'implemente o driver em modules/provisioning/drivers/.',
      );
    }
    // DIRECT
    if (vendor === 'ZYXEL') return this.zyxel;
    if (vendor === 'HUAWEI') return this.huawei;
    if (vendor === 'FIBERHOME') return this.fiberhome;
    if (vendor === 'GENERIC') return this.mock;
    throw new Error(
      `Driver não implementado: providerMode=DIRECT vendor=${vendor}. ` +
        'Use providerMode=EXTERNAL se a OLT é provisionada manualmente, ou ' +
        'implemente o driver em modules/provisioning/drivers/.',
    );
  }
}

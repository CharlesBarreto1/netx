import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { NmsDashboardService } from './nms-dashboard.service';
import type { NmsDashboard } from './nms-dashboard.types';

/**
 * Painel do NOC — uma leitura com todos os blocos (sessões, tráfego, frota,
 * óptica, OLTs, incidentes) e os alarmes de tendência derivados.
 *
 * Permissão: `network.read`. É a mesma que abre a Planta de rede — quem pode
 * ver os equipamentos pode ver a saúde deles. Os blocos internos não gateiam
 * por permissão individual porque o payload é agregado (contagens), não dado
 * de cliente: o único identificador que sai daqui é o SN da ONT no bloco de
 * piores casos ópticos, que já é visível pra quem tem network.read.
 *
 * CUSTO: a contagem de sessões cruza `contracts × radius.radacct` e é cara —
 * o frontend deve usar refresh espaçado (ver REFRESH_MS na página).
 */
@ApiTags('nms-dashboard')
@ApiBearerAuth()
@Controller('nms-dashboard')
export class NmsDashboardController {
  constructor(private readonly dashboard: NmsDashboardService) {}

  @Get()
  @RequirePermissions('network.read')
  build(@CurrentUser() user: AuthenticatedPrincipal): Promise<NmsDashboard> {
    return this.dashboard.build(user.tenantId);
  }
}

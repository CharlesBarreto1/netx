import { All, Controller, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { EntitlementService } from './entitlement.service';
import { ProxyService } from './proxy.service';

/**
 * Canal 4 do ecossistema: repassa /api/v1/nms/* pro módulo NMS (apps/nms).
 * Registrado ANTES do ProxyController catch-all pra ter prioridade de match.
 *
 * Mapeamento de path: o NMS não usa versionamento nem prefixo global, então
 * tiramos /api/v1/nms do início → o NMS recebe /devices, /auth/login, etc.
 *
 * Antes de repassar, checa o entitlement `netx-nms` (canal 2, fail-open).
 */
@ApiTags('proxy')
@Controller('nms')
export class NmsProxyController {
  constructor(
    private readonly proxy: ProxyService,
    private readonly entitlement: EntitlementService,
  ) {}

  @All('*')
  async forward(@Req() req: Request, @Res() res: Response) {
    const allowed = await this.entitlement.isEntitled('netx-nms', req.headers.authorization);
    if (!allowed) {
      res.status(403).json({
        type: 'urn:netx:error:module-not-entitled',
        title: 'Módulo não licenciado',
        detail: 'A licença desta instância não habilita o módulo NMS (netx-nms).',
      });
      return;
    }

    // /api/v1/nms/<resto> → /<resto> (NMS sem prefixo/versão). Bare /nms → /.
    const path = req.originalUrl.replace(/^\/api(?:\/v\d+)?\/nms/, '') || '/';
    const result = await this.proxy.forwardToNms(req, path);

    res.status(result.status);
    for (const [k, v] of Object.entries(result.headers)) {
      if (v !== undefined && !['transfer-encoding', 'content-encoding'].includes(k.toLowerCase())) {
        res.setHeader(k, v as string);
      }
    }
    res.send(result.body);
  }
}

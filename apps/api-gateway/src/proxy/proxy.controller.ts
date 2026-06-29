import { All, Controller, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { ProxyService } from './proxy.service';

/**
 * Catch-all controller that proxies every /api/v1/* request to the core-service.
 * As new services are added (billing-service, radius-service, etc.), either:
 *   (a) add a new @All('service-prefix/*') route, or
 *   (b) replace this with a service registry + routing layer.
 */
@ApiTags('proxy')
@Controller()
export class ProxyController {
  constructor(private readonly proxy: ProxyService) {}

  @All('*')
  async forward(@Req() req: Request, @Res() res: Response) {
    // Map /api/v1/... → core-service /v1/...
    const path = req.originalUrl.replace(/^\/api/, '');

    // SSE (EventSource manda `Accept: text/event-stream`): repassa como STREAM,
    // sem bufferizar nem timeout — senão o realtime do chat nunca chega.
    const accept = (req.headers.accept ?? '').toString();
    if (accept.includes('text/event-stream')) {
      await this.proxy.streamFromCore(req, res, path);
      return;
    }

    const result = await this.proxy.forwardToCore(req, path);

    res.status(result.status);
    for (const [k, v] of Object.entries(result.headers)) {
      if (v !== undefined && !['transfer-encoding', 'content-encoding'].includes(k.toLowerCase())) {
        res.setHeader(k, v as string);
      }
    }
    res.send(result.body);
  }
}

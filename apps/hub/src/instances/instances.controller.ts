import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Ip,
  Post,
  UnauthorizedException,
} from '@nestjs/common';

import { HeartbeatRequestSchema } from './heartbeat.dto';
import { InstancesService } from './instances.service';

/**
 * Endpoint chamado pelo NetX de cada cliente (HeartbeatService no core).
 * Público (sem admin token) — autentica pela license key no header Authorization.
 */
@Controller('instances')
export class InstancesController {
  constructor(private readonly instances: InstancesService) {}

  @Post('heartbeat')
  async heartbeat(
    @Headers('authorization') auth: string | undefined,
    @Body() rawBody: unknown,
    @Ip() ip: string,
  ): Promise<{ token: string }> {
    const key = parseBearer(auth);
    if (!key) throw new UnauthorizedException('license key ausente');

    const parsed = HeartbeatRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }
    return this.instances.heartbeat(key, parsed.data, ip);
  }
}

function parseBearer(auth: string | undefined): string | null {
  if (!auth) return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return m ? m[1].trim() : null;
}

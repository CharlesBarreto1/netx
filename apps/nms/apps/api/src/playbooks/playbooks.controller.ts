import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { PlaybooksService } from './playbooks.service.js';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { DeviceVendorSchema } from '../devices/device.dto.js';

@Controller()
export class PlaybooksController {
  constructor(private readonly playbooks: PlaybooksService) {}

  /** Catálogo de playbooks disponíveis (opcionalmente filtrado por vendor). */
  @Get('playbooks')
  list(@Query('vendor') vendor?: string) {
    const parsed = DeviceVendorSchema.safeParse(vendor);
    return this.playbooks.list(parsed.success ? parsed.data : 'juniper');
  }

  /** Executa um playbook no device. */
  @Roles('admin', 'operator')
  @Post('devices/:id/playbooks/:playbookId/run')
  run(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('playbookId') playbookId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.playbooks.run(id, playbookId, user.username);
  }
}

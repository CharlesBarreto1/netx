import { Module } from '@nestjs/common';

import { WikiModule } from '../wiki/wiki.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

@Module({
  imports: [WikiModule], // central de ajuda (artigos CLIENT, read-only)
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}

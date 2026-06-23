import { Module } from '@nestjs/common';

import { WikiController } from './wiki.controller';
import { WikiService } from './wiki.service';

@Module({
  controllers: [WikiController],
  providers: [WikiService],
  exports: [WikiService], // PortalModule usa pra central de ajuda (read-only)
})
export class WikiModule {}

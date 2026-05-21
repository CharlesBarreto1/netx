/**
 * PrismaService minimal pra cwmp-server.
 *
 * Reaproveita @prisma/client gerado pelo core-service (mesmo schema.prisma,
 * mesmo DATABASE_URL). Stateless por session — não usa CLS porque CWMP é
 * conexão-por-CPE sem tenant context HTTP (tenant é derivado do device_id
 * via mapping Tr069Device.tenantId).
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
      log: [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected (cwmp-server)');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

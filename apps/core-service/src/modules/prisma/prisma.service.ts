import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { loadConfig } from '@netx/config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const cfg = loadConfig();
    super({
      datasources: { db: { url: cfg.database.url } },
      log: [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Soft-delete helper: adds a deletedAt timestamp instead of removing the row.
   * Use only on tables that have deletedAt column.
   */
  async softDelete<T extends { deletedAt: Date | null }>(
    model: { update: (args: any) => Promise<T> },
    id: string,
  ): Promise<T> {
    return model.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}

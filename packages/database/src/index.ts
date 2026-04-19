import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

let prismaInstance: PrismaClient | null = null;

export interface PrismaFactoryOptions {
  databaseUrl: string;
  logQueries?: boolean;
}

/**
 * Returns a singleton PrismaClient per process. Use in services that need
 * direct DB access (core-service). The API Gateway should NOT access the DB.
 */
export function getPrisma(opts: PrismaFactoryOptions): PrismaClient {
  if (prismaInstance) return prismaInstance;

  prismaInstance = new PrismaClient({
    datasources: { db: { url: opts.databaseUrl } },
    log: opts.logQueries
      ? [{ emit: 'event', level: 'query' }, 'info', 'warn', 'error']
      : ['warn', 'error'],
  });

  return prismaInstance;
}

/**
 * Closes the singleton — for graceful shutdown.
 */
export async function disconnectPrisma(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
  }
}

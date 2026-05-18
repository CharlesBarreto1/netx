import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';

import { loadConfig } from '@netx/config';

import { TenantClsStore } from '../../common/tenant-context';

/**
 * PrismaService — wrapper de PrismaClient compatível com RLS.
 *
 * RLS infrastructure (em `migrations/20260517000000_enable_rls_tenant_isolation`):
 *   - Postgres tem ROW LEVEL SECURITY ativo em todas tabelas multi-tenant.
 *   - Policies usam `app_current_tenant_id()` (lê `current_setting('app.tenant_id', true)`).
 *   - Quando a session var NÃO está setada, a policy permite (NULL bypass).
 *
 * Status atual: o enforcement automático **não está ativo no client level**.
 * Prisma 6 removeu `$use` (middleware-style API que estava deprecated desde
 * 4.16). A alternativa `$extends` retorna um tipo diferente de client (NÃO
 * compatível com `extends PrismaClient`), exigindo refactor de TODOS os
 * services pra usar o cliente estendido. Optamos por NÃO fazer esse refactor
 * agora — risco vs. benefício pra esta release. Defesa em runtime continua
 * sendo o pattern existente: services usam `where: { tenantId }` explícito.
 *
 * Pra ativar RLS enforcement no futuro, duas alternativas:
 *
 *   A) Refactor pra Prisma client extension:
 *      - Trocar `extends PrismaClient` por wrapper que expõe `.client` extended.
 *      - Migrar cada `this.prisma.user.findMany(...)` pra `this.prisma.client.user.findMany(...)`.
 *      - $extends({ query: { $allOperations: async ({ args, query }) => {
 *            await prisma.$transaction([
 *              prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
 *              query(args),
 *            ]);
 *        }}}).
 *
 *   B) NestJS Interceptor que abre uma transação por request e armazena no CLS:
 *      - Interceptor wrap todo handler em `$transaction(async tx => { SET LOCAL; ... })`.
 *      - Services consomem o `tx` do CLS em vez do `prisma` injected.
 *
 * Por ora, a infrastructure SQL está em place — a defesa app-level continua
 * a primária. `runAsSystem` segue disponível pra contextos onde queremos
 * explicitamente bypassar (que hoje é todos eles, mas é semanticamente
 * correto pra cron/admin scripts).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly cls: ClsService<TenantClsStore>) {
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
    this.logger.log('Prisma connected (RLS infra in DB; app-level enforcement via where:{tenantId})');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Executa um bloco como "system" (sem tenantId no CLS), semanticamente
   * indicando "esta operação é cross-tenant intencional". Útil pra scripts
   * admin, cron jobs, bootstrap.
   *
   * Hoje (sem $use middleware ativo) é equivalente a chamar o client direto,
   * mas marca intenção. Quando refactor pra client-extension acontecer, este
   * helper continuará correto.
   */
  async runAsSystem<T>(fn: (prisma: PrismaClient) => Promise<T>): Promise<T> {
    if (this.cls.isActive()) {
      return this.cls.runWith({} as TenantClsStore, () => fn(this));
    }
    return fn(this);
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

export { Prisma };

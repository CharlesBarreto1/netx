import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';

import { loadConfig } from '@netx/config';

import { TenantClsStore } from '../../common/tenant-context';

const RLS_GUARD_KEY = '_rlsTxActive';

/**
 * PrismaService com isolamento RLS automático.
 *
 * Trabalha em conjunto com a migration `20260517000000_enable_rls_tenant_isolation`,
 * que ativa Row-Level Security no Postgres. Esta classe SETA `app.tenant_id`
 * automaticamente antes de cada query usando o `tenantId` do CLS store da request.
 *
 * Implementação (Prisma 6):
 *   - `$use` middleware intercepta cada query antes de executar.
 *   - Se há `tenantId` no CLS, envolve a operação numa `$transaction(interactive)`
 *     que primeiro chama `SELECT set_config('app.tenant_id', $1, true)` (forma
 *     funcional do `SET LOCAL`) e depois despacha a operação pro client da
 *     transação. Mesma conexão garantida; `SET LOCAL` afeta a query.
 *   - Guard no CLS (`_rlsTxActive`) evita recursão infinita quando a operação
 *     interna re-dispara o middleware.
 *   - Sem tenantId no CLS (boot/migrations/scripts admin): query roda direto.
 *     RLS policy permite via `app_current_tenant_id() IS NULL`.
 *
 * Limitações conhecidas (documentar como follow-up):
 *   - `$transaction(callback)` chamado direto pelo service NÃO é envolvido —
 *     o caller fica responsável por incluir `SET LOCAL` no início. Adicionar
 *     helper `runWithTenantTx` futuramente.
 *   - `$queryRaw` / `$executeRaw` chamados direto também NÃO são envolvidos.
 *     Adicionar lint-rule pra forçar passar via wrapper.
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

    this.installRlsMiddleware();
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected (RLS enforcement active via $use middleware)');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  private installRlsMiddleware(): void {
    this.$use(async (params, next) => {
      // Guard: se estamos dentro de uma operação já envolvida em RLS-tx, não
      // re-envolver. Sem isso teríamos recursão infinita quando despachamos
      // a operação pro client da transação.
      if (this.cls.isActive() && this.cls.get(RLS_GUARD_KEY)) {
        return next(params);
      }

      const tenantId = this.cls.isActive() ? (this.cls.get('tenantId') as string | undefined) : undefined;
      if (!tenantId) {
        return next(params);
      }

      // Operações $raw / $transaction: caller controla. Não envolvemos pra
      // evitar interferência. Documentamos como follow-up.
      const action = params.action as string;
      if (action.startsWith('$') || action === 'executeRaw' || action === 'queryRaw' || action === 'runCommandRaw') {
        return next(params);
      }

      // Sem model não há como despachar (caso raro, ex.: extensões custom).
      const model = params.model;
      if (!model) {
        return next(params);
      }

      // Wrap: roda o SET LOCAL + a operação na mesma conexão (interactive tx).
      return this.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.tenant_id', $1, true)`,
          tenantId,
        );
        this.cls.set(RLS_GUARD_KEY, true);
        try {
          const delegate = (tx as unknown as Record<string, Record<string, (args: unknown) => Promise<unknown>>>)[
            lowerFirst(model)
          ];
          if (!delegate || typeof delegate[action] !== 'function') {
            // Fallback: ação desconhecida (futura version do Prisma?). Não
            // bloqueia — roda sem RLS-tx. Loga warn pra detectar.
            this.logger.warn(`RLS middleware: unknown action ${model}.${action}, falling back`);
            return next(params);
          }
          return delegate[action](params.args);
        } finally {
          this.cls.set(RLS_GUARD_KEY, false);
        }
      });
    });
  }

  /**
   * Executa um bloco como "system" (sem tenantId no CLS), bypassando RLS.
   * Use SÓ em scripts admin, cron jobs cross-tenant ou bootstrap.
   *
   * Implementação: roda dentro de um CLS context vazio. O middleware vê
   * `tenantId === undefined` e pula o wrap.
   */
  async runAsSystem<T>(fn: (prisma: PrismaClient) => Promise<T>): Promise<T> {
    return this.cls.runWith({} as TenantClsStore, () => fn(this));
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

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export { Prisma };

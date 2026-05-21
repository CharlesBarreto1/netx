/**
 * RadiusReconcilerService — verificação periódica de coerência entre
 * `contracts` (estado fonte) e `radius.radcheck` / `radius.radusergroup`
 * (estado aplicado). Auto-corrige divergências enfileirando radius_events.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Motivação:
 *   Se ALGUM caminho de mutação esquecer de chamar `radiusSync.enqueueSync`
 *   (ex.: bug no `contracts.update()` que só checava pppoeUsername, ou alguém
 *   editou o DB direto via psql), `radcheck`/`radusergroup` ficam stale.
 *   Sintomas: cliente paga mas continua bloqueado; cliente cancelado continua
 *   autenticando (vazamento de credencial).
 *
 *   Este service é a defesa em profundidade: mesmo com bugs no caminho normal,
 *   o sistema CONVERGE pro estado correto em até `RECONCILER_INTERVAL` minutos.
 *
 * Política (configurada via flag — hoje hard-coded auto-corrigir + logar):
 *   - Contrato com identificador válido e status ∈ {ACTIVE,SUSPENDED,CANCELLED}
 *     mas SEM entry correspondente em radcheck/radusergroup → enfileira
 *     `radius_event` corretivo (AUTHORIZE/BLOCK/CANCEL).
 *   - Username em radcheck que NÃO casa com nenhum contrato (órfão / vazado)
 *     → DELETE direto em radcheck/radreply/radusergroup.
 *
 * Idempotência:
 *   - Se já existe um `radius_event` PENDING pro mesmo contractId, NÃO
 *     enfileira outro (evita acúmulo). O applier vai processar o existente.
 *   - O applier em si já é idempotente (DELETE+INSERT em radcheck/radusergroup).
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  ContractAuthMethod,
  ContractStatus,
  RadiusAction,
  RadiusEventStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  POOL_ATIVOS,
  POOL_BLOQUEADOS,
  POOL_CANCELADOS,
} from '../contracts/radius-sync.service';

interface ReconcilerStats {
  contractsScanned: number;
  divergencesFound: number;
  eventsEnqueued: number;
  orphansDeleted: number;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
}

interface RadcheckRow {
  username: string;
  attribute: string;
  value: string;
}

interface RadusergroupRow {
  username: string;
  groupname: string;
}

@Injectable()
export class RadiusReconcilerService {
  private readonly logger = new Logger(RadiusReconcilerService.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cron de 5 minutos. Singleton-guarded — se a execução anterior ainda está
   * rolando (raro mas possível em VPS lenta com muitos contratos), pula.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick(): Promise<void> {
    if (this.running) {
      this.logger.debug('reconciler tick skipped — previous still running');
      return;
    }
    this.running = true;
    try {
      const stats = await this.runOnce();
      if (stats.divergencesFound > 0 || stats.orphansDeleted > 0) {
        this.logger.warn(
          `[RECONCILER] divergências=${stats.divergencesFound} ` +
            `eventos_enfileirados=${stats.eventsEnqueued} ` +
            `órfãos_apagados=${stats.orphansDeleted} ` +
            `duração=${stats.durationMs}ms`,
        );
      } else {
        this.logger.debug(
          `[RECONCILER] ok — ${stats.contractsScanned} contratos, sem divergência (${stats.durationMs}ms)`,
        );
      }
    } catch (err) {
      this.logger.error('reconciler tick failed', err as Error);
    } finally {
      this.running = false;
    }
  }

  /**
   * Executa uma reconciliação completa. Pública pra ser invocada por:
   *   - cron (tick)
   *   - endpoint admin POST /radius/_tasks/run-reconciler
   *   - CLI netx-radius-check
   */
  async runOnce(): Promise<ReconcilerStats> {
    const startedAt = new Date();
    const stats: Omit<ReconcilerStats, 'finishedAt' | 'durationMs'> = {
      contractsScanned: 0,
      divergencesFound: 0,
      eventsEnqueued: 0,
      orphansDeleted: 0,
      startedAt,
    };

    // ---- Pass 1: contracts -> radcheck/radusergroup (forward) -----------------
    const contracts = await this.prisma.contract.findMany({
      where: {
        deletedAt: null,
        // Só interessa contratos que DEVERIAM ter estado no RADIUS. Contratos
        // deletados não importam (já saíram via CANCEL no soft-delete).
      },
      select: {
        id: true,
        tenantId: true,
        authMethod: true,
        status: true,
        pppoeUsername: true,
        pppoePassword: true,
        circuitId: true,
        macAddress: true,
        framedIpAddress: true,
      },
    });
    stats.contractsScanned = contracts.length;

    // Snapshot de radcheck (Auth-Type/Cleartext-Password) e radusergroup
    // numa única query cada, evita N+1.
    const radcheckRows = await this.prisma.$queryRawUnsafe<RadcheckRow[]>(
      `SELECT username, attribute, value
         FROM radius.radcheck
        WHERE attribute IN ('Cleartext-Password', 'Auth-Type')`,
    );
    const radusergroupRows = await this.prisma.$queryRawUnsafe<RadusergroupRow[]>(
      `SELECT username, groupname FROM radius.radusergroup`,
    );

    // Indexa por username pra lookup O(1)
    const radcheckByUser = new Map<string, RadcheckRow[]>();
    for (const r of radcheckRows) {
      const list = radcheckByUser.get(r.username) ?? [];
      list.push(r);
      radcheckByUser.set(r.username, list);
    }
    const radgroupByUser = new Map<string, string>();
    for (const r of radusergroupRows) radgroupByUser.set(r.username, r.groupname);

    // Set de usernames que TÊM contrato — usado depois pra detectar órfãos
    const expectedUsernames = new Set<string>();

    for (const c of contracts) {
      const identifier = this.identifierFor(c);
      if (!identifier) continue; // contrato sem identificador (PPPoE sem user etc.) — pula
      expectedUsernames.add(identifier);

      const expected = this.expectedStateFor(c);
      if (!expected) continue;

      const actualRadcheck = radcheckByUser.get(identifier) ?? [];
      const actualGroup = radgroupByUser.get(identifier) ?? null;

      const diverges = this.divergesFromExpected(actualRadcheck, actualGroup, expected, c);
      if (!diverges) continue;

      stats.divergencesFound += 1;

      // Idempotência: não enfileira se já tem evento PENDING pro contrato.
      const alreadyPending = await this.prisma.radiusEvent.count({
        where: { contractId: c.id, status: RadiusEventStatus.PENDING },
      });
      if (alreadyPending > 0) {
        this.logger.debug(
          `[RECONCILER] divergência em ${identifier} mas já tem evento PENDING — pulando`,
        );
        continue;
      }

      await this.prisma.radiusEvent.create({
        data: {
          tenantId: c.tenantId,
          contractId: c.id,
          action: expected.action,
          status: RadiusEventStatus.PENDING,
          pppoeUsername: identifier,
          targetPool: expected.pool,
          note: `reconciler: ${diverges}`,
        },
      });
      stats.eventsEnqueued += 1;
      this.logger.warn(
        `[RECONCILER] enfileirado ${expected.action} pra ${identifier} (contract=${c.id}): ${diverges}`,
      );
    }

    // ---- Pass 2: radcheck/radusergroup -> órfãos (backward) -------------------
    // Qualquer username em radcheck que NÃO está no Set de identificadores
    // esperados → vazamento. Pode ser:
    //   (a) Contrato deletado mas radcheck não foi limpo
    //   (b) Identificador antigo após troca (bug que motivou esse service)
    //   (c) INSERT manual via psql (não recomendado)
    const allUsersInRadius = new Set<string>([
      ...radcheckByUser.keys(),
      ...radgroupByUser.keys(),
    ]);
    const orphans: string[] = [];
    for (const u of allUsersInRadius) {
      if (!expectedUsernames.has(u)) orphans.push(u);
    }

    if (orphans.length > 0) {
      this.logger.warn(
        `[RECONCILER] ${orphans.length} órfão(s) em radcheck/radusergroup: ${orphans.slice(0, 5).join(', ')}${orphans.length > 5 ? '...' : ''}`,
      );
      // DELETE direto — não há contract_id pra enfileirar evento. Em batch
      // pra não fazer N round-trips.
      // Usa parameterized query via $executeRawUnsafe com array de bindings
      // (Prisma 6 aceita ANY ($1::text[])).
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM radius.radcheck     WHERE username = ANY($1::text[])`,
        orphans,
      );
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM radius.radreply     WHERE username = ANY($1::text[])`,
        orphans,
      );
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM radius.radusergroup WHERE username = ANY($1::text[])`,
        orphans,
      );
      stats.orphansDeleted = orphans.length;
    }

    const finishedAt = new Date();
    return {
      ...stats,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Identificador efetivo de um contrato no RADIUS (PPPoE user / IPoE id). */
  private identifierFor(c: {
    authMethod: ContractAuthMethod;
    pppoeUsername: string | null;
    circuitId: string | null;
    macAddress: string | null;
  }): string | null {
    if (c.authMethod === ContractAuthMethod.IPOE) {
      return c.circuitId ?? c.macAddress ?? null;
    }
    return c.pppoeUsername ?? null;
  }

  /**
   * Estado esperado em radcheck+radusergroup pro contrato. Null se o contrato
   * não deveria ter NADA em RADIUS (ex.: DRAFT — não implementado ainda).
   */
  private expectedStateFor(c: {
    authMethod: ContractAuthMethod;
    status: ContractStatus;
    pppoePassword: string | null;
  }): { action: RadiusAction; pool: string; needsRadcheck: boolean; expectedAttr: string | null; expectedValue: string | null } | null {
    switch (c.status) {
      case ContractStatus.ACTIVE: {
        if (c.authMethod === ContractAuthMethod.IPOE) {
          return {
            action: RadiusAction.AUTHORIZE,
            pool: POOL_ATIVOS,
            needsRadcheck: true,
            expectedAttr: 'Auth-Type',
            expectedValue: 'Accept',
          };
        }
        return {
          action: RadiusAction.AUTHORIZE,
          pool: POOL_ATIVOS,
          needsRadcheck: true,
          expectedAttr: 'Cleartext-Password',
          expectedValue: c.pppoePassword,
        };
      }
      case ContractStatus.SUSPENDED:
        // Suspenso fica no grupo bloqueados, mas radcheck pode permanecer
        // (o grupo é o que rejeita). Só checamos o grupo.
        return {
          action: RadiusAction.BLOCK,
          pool: POOL_BLOQUEADOS,
          needsRadcheck: false,
          expectedAttr: null,
          expectedValue: null,
        };
      case ContractStatus.CANCELLED:
        // Cancelado: radcheck deve estar vazio, grupo = cancelados.
        return {
          action: RadiusAction.CANCEL,
          pool: POOL_CANCELADOS,
          needsRadcheck: false,
          expectedAttr: null,
          expectedValue: null,
        };
      default:
        return null;
    }
  }

  /**
   * Compara estado real (radcheck+radusergroup) com esperado. Retorna string
   * descrevendo a divergência (pra log/note), ou null se OK.
   */
  private divergesFromExpected(
    actualRadcheck: RadcheckRow[],
    actualGroup: string | null,
    expected: NonNullable<ReturnType<RadiusReconcilerService['expectedStateFor']>>,
    contract: { id: string; authMethod: ContractAuthMethod; status: ContractStatus },
  ): string | null {
    // (1) grupo
    if (actualGroup !== expected.pool) {
      return `grupo esperado=${expected.pool} atual=${actualGroup ?? '∅'} (status=${contract.status})`;
    }

    // (2) radcheck (só pra ACTIVE; SUSPENDED/CANCELLED dependem só do grupo)
    if (expected.needsRadcheck) {
      const match = actualRadcheck.find((r) => r.attribute === expected.expectedAttr);
      if (!match) {
        return `radcheck esperava ${expected.expectedAttr} mas não tem nada`;
      }
      // Pra PPPoE: confere que a senha bate (rotação de senha sem sync = bug)
      if (expected.expectedValue && match.value !== expected.expectedValue) {
        return `${expected.expectedAttr} divergente (esperado vs atual diferem)`;
      }
    }

    return null;
  }
}

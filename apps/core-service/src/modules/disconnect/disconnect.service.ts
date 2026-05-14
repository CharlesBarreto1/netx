/**
 * DisconnectService — orquestra qual strategy usar pra desconectar um cliente.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Decisão é feita com prioridade clara:
 *   1) Se equipment.disconnectStrategy != AUTO → usa essa explicitamente
 *   2) Se sshDisconnectCmd configurado → SSH (override de operador)
 *   3) Mikrotik + IPoE → MIKROTIK_API
 *   4) Caso contrário → COA com payload por vendor
 *
 * Retorna agregado por NAS — em cenário multi-NAS (cliente flutuando entre BNGs),
 * cada equipamento recebe a tentativa apropriada.
 */
import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { CoaStrategy } from './strategies/coa.strategy';
import { MikrotikApiStrategy } from './strategies/mikrotik-api.strategy';
import { SshDisconnectStrategy } from './strategies/ssh.strategy';
import type {
  DisconnectResult,
  DisconnectStrategyExecutor,
  DisconnectTarget,
} from './strategies/types';
import type {
  ContractAuthMethod,
  DisconnectStrategy as DisconnectStrategyEnum,
  NetworkEquipment,
} from '@prisma/client';

export interface DisconnectContractInput {
  tenantId: string;
  authType: ContractAuthMethod;
  pppoeUsername?: string | null;
  macAddress?: string | null;
  circuitId?: string | null;
}

@Injectable()
export class DisconnectService {
  private readonly logger = new Logger(DisconnectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly coa: CoaStrategy,
    private readonly mikrotikApi: MikrotikApiStrategy,
    private readonly ssh: SshDisconnectStrategy,
  ) {}

  /**
   * Disconnect baseado num contrato. Resolve sessões ativas em radacct pra
   * extrair Acct-Session-Id e descobrir em qual NAS o cliente está. Dispara
   * a strategy adequada por NAS.
   */
  async disconnectContract(
    input: DisconnectContractInput,
  ): Promise<DisconnectResult[]> {
    // 1) Identificadores pra busca em radacct (com normalização Mikrotik)
    const usernames: string[] = [];
    if (input.pppoeUsername) usernames.push(input.pppoeUsername);
    if (input.macAddress) {
      usernames.push(input.macAddress);
      usernames.push(input.macAddress.toLowerCase());
    }
    if (input.circuitId) usernames.push(input.circuitId);

    const normalizedMac = (input.macAddress ?? '')
      .replace(/^[0-9]+:/, '')
      .replace(/[:\-.]/g, '')
      .toLowerCase();

    // 2) Busca sessões ativas com dados pra montar payload
    const sessions = await this.prisma.$queryRawUnsafe<
      Array<{
        nasipaddress: string;
        acctsessionid: string | null;
        framedipaddress: string | null;
        username: string | null;
        callingstationid: string | null;
      }>
    >(
      `SELECT host(nasipaddress) AS nasipaddress,
              acctsessionid, framedipaddress, username, callingstationid
         FROM radius.radacct
        WHERE acctstoptime IS NULL
          AND (
                username = ANY($1::text[])
             OR ($2 <> '' AND LOWER(REGEXP_REPLACE(
                  REGEXP_REPLACE(callingstationid, '^[0-9]+:', ''),
                  '[:\\-.]', '', 'g')) = $2)
             OR ($2 <> '' AND LOWER(REGEXP_REPLACE(
                  REGEXP_REPLACE(username, '^[0-9]+:', ''),
                  '[:\\-.]', '', 'g')) = $2)
              )`,
      usernames,
      normalizedMac,
    );

    // 3) Resolve quais NetworkEquipment atender
    //    - Com sessão ativa: só os NASes detentores
    //    - Sem sessão: todos os BNGs do tenant (fallback broadcast)
    let equipments: NetworkEquipment[];
    if (sessions.length > 0) {
      const sessionIps = [...new Set(sessions.map((s) => s.nasipaddress))];
      equipments = await this.prisma.networkEquipment.findMany({
        where: {
          tenantId: input.tenantId,
          deletedAt: null,
          isActive: true,
          ipAddress: { in: sessionIps },
        },
      });
    } else {
      equipments = await this.prisma.networkEquipment.findMany({
        where: {
          tenantId: input.tenantId,
          deletedAt: null,
          isActive: true,
          type: 'BNG',
        },
      });
    }

    if (equipments.length === 0) {
      this.logger.warn(
        `[Disconnect] nenhum NetworkEquipment elegível pra disconnect (tenant=${input.tenantId})`,
      );
      return [];
    }

    // 4) Pra cada equipamento, decide strategy e dispara
    const results: DisconnectResult[] = [];
    for (const eq of equipments) {
      const session = sessions.find((s) => s.nasipaddress === eq.ipAddress);
      const target: DisconnectTarget = {
        authType: input.authType,
        pppoeUsername: input.pppoeUsername ?? null,
        macAddress: input.macAddress ?? null,
        framedIp: session?.framedipaddress ?? null,
        callingStationId: session?.callingstationid ?? null,
        acctSessionId: session?.acctsessionid ?? null,
      };

      const strategy = this.pickStrategy(eq, target);
      if (!strategy) {
        results.push({
          ok: false,
          strategy: 'COA',
          equipmentId: eq.id,
          equipmentName: eq.name,
          nasIp: eq.ipAddress,
          reason: 'not-supported',
          message:
            `Nenhuma strategy aplicável (vendor=${eq.vendor}, auth=${target.authType}). ` +
            `Configure credenciais API/SSH pra esse equipamento.`,
        });
        continue;
      }

      const result = await strategy.execute(eq, target);
      results.push(result);
    }

    return results;
  }

  /**
   * Escolhe a strategy aplicável seguindo a hierarquia:
   *   1) disconnectStrategy explícito (não-AUTO)
   *   2) SSH se configurado (override)
   *   3) Mikrotik IPoE → MIKROTIK_API
   *   4) Demais → COA
   */
  private pickStrategy(
    eq: NetworkEquipment,
    target: DisconnectTarget,
  ): DisconnectStrategyExecutor | null {
    const explicit = eq.disconnectStrategy as DisconnectStrategyEnum;
    if (explicit === 'COA') {
      return this.coa.canHandle(eq, target) ? this.coa : null;
    }
    if (explicit === 'MIKROTIK_API') {
      return this.mikrotikApi.canHandle(eq, target) ? this.mikrotikApi : null;
    }
    if (explicit === 'SSH') {
      return this.ssh.canHandle(eq, target) ? this.ssh : null;
    }

    // AUTO: hierarquia inteligente
    if (this.ssh.canHandle(eq, target)) return this.ssh; // override do operador
    if (eq.vendor === 'MIKROTIK' && target.authType === 'IPOE') {
      return this.mikrotikApi.canHandle(eq, target) ? this.mikrotikApi : null;
    }
    if (this.coa.canHandle(eq, target)) return this.coa;
    return null;
  }

  /**
   * Test connectivity pra UI — roda em qual strategy fizer sentido pro
   * equipamento, sem disconnect.
   */
  async testEquipmentConnectivity(equipmentId: string): Promise<
    Array<{
      strategy: 'COA' | 'MIKROTIK_API' | 'SSH';
      ok: boolean;
      message?: string;
    }>
  > {
    const eq = await this.prisma.networkEquipment.findUnique({
      where: { id: equipmentId },
    });
    if (!eq) return [];

    const targets: DisconnectStrategyExecutor[] = [];
    if (eq.radiusSecret) targets.push(this.coa);
    if (eq.vendor === 'MIKROTIK' && eq.apiUser) targets.push(this.mikrotikApi);
    if (eq.sshDisconnectCmd && eq.sshUser) targets.push(this.ssh);

    const out: Array<{
      strategy: 'COA' | 'MIKROTIK_API' | 'SSH';
      ok: boolean;
      message?: string;
    }> = [];
    for (const s of targets) {
      const r = await s.testConnectivity(eq);
      out.push({ strategy: s.kind, ok: r.ok, message: r.message });
    }

    // Persiste último resultado pra UI
    const overallOk = out.every((r) => r.ok);
    await this.prisma.networkEquipment.update({
      where: { id: equipmentId },
      data: {
        lastReachableAt: overallOk ? new Date() : eq.lastReachableAt,
        lastReachError: overallOk
          ? null
          : out
              .filter((r) => !r.ok)
              .map((r) => `[${r.strategy}] ${r.message}`)
              .join(' | '),
      },
    });

    return out;
  }
}

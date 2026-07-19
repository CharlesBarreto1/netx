import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { ImportIpamFindingsRequest, ReconcileScanRequest } from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { IpamAddressesService } from './addresses.service';
import { detectVersion, ipToBigInt, isValidIp, normalizeIp } from './ip.util';
import { MikrotikIpCollector, type CollectorWarning } from './mikrotik.collector';
import {
  diffObservations,
  type DocumentedAddress,
  type Finding,
  type Observation,
  type PrefixRange,
} from './reconcile.types';
import { toBig, verToNum } from './ipam.util';

/**
 * Reconciliação IPAM ↔ rede real.
 *
 * O IPAM documenta o que alguém anotou; a rede sabe o que está de fato em uso.
 * Este serviço junta evidências de várias fontes e aponta onde os dois divergem.
 *
 * Dois níveis de coleta, com a diferença deliberada:
 *
 *   LOCAL  — sessões RADIUS, IP fixo de contrato e IP de gerência. Sai tudo do
 *            banco, sem tocar em nenhum equipamento. É o padrão.
 *   AO VIVO — ARP e leases DHCP lidos do RouterOS. Precisa alcançar o
 *            equipamento na rede, então é OPT-IN explícito por equipamento.
 *
 * O scan NUNCA escreve no IPAM. Importar é ação separada e por item — varredura
 * automática que corrige sozinha é receita pra documentar lixo.
 */
@Injectable()
export class IpamReconcileService {
  private readonly logger = new Logger(IpamReconcileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly addresses: IpamAddressesService,
    private readonly audit: AuditService,
    private readonly mikrotik: MikrotikIpCollector,
  ) {}

  // ── Coletores locais ────────────────────────────────────────────────────
  private mk(
    raw: string | null | undefined,
    source: Observation['source'],
    extra: Partial<Observation> = {},
  ): Observation | null {
    if (!raw || !isValidIp(raw)) return null;
    const ip = normalizeIp(raw);
    return { ip, num: ipToBigInt(ip), version: detectVersion(ip), source, ...extra };
  }

  /**
   * Sessões RADIUS abertas (`acctstoptime IS NULL`) com Framed-IP. O join com
   * `contracts` repete o casamento pppoe/circuit-id do RadacctService — é o que
   * amarra o IP visto na rede a um contrato.
   *
   * `framedipaddress` é `inet` no schema Postgres do FreeRADIUS, mas varchar em
   * outras variantes. Por isso saímos com `::text` e sem nenhum predicado de
   * string sobre a coluna: comparar inet com '' lança 22P02 e derrubaria a
   * fonte mais importante da varredura inteira. Endereço vazio ou com máscara
   * é tratado depois, no JS.
   */
  private async fromRadius(tenantId: string): Promise<Observation[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ ip: string | null; username: string | null; contract_id: string | null; customer_id: string | null }>
    >(
      `SELECT DISTINCT ON (r.framedipaddress)
              r.framedipaddress::text AS ip, r.username,
              c.id AS contract_id, c.customer_id
         FROM radius.radacct r
         LEFT JOIN contracts c ON (
              (c.pppoe_username IS NOT NULL AND r.username = c.pppoe_username)
           OR (c.circuit_id IS NOT NULL AND (
                 r.username = c.circuit_id OR r.callingstationid = c.circuit_id))
         ) AND c.tenant_id = $1::uuid AND c.deleted_at IS NULL
        WHERE r.acctstoptime IS NULL
          AND r.framedipaddress IS NOT NULL
        ORDER BY r.framedipaddress, r.acctstarttime DESC`,
      tenantId,
    );

    return rows
      .map((r) =>
        // `inet` pode sair como "10.0.0.5/32"; guardamos só o host.
        this.mk(r.ip ? r.ip.split('/')[0] : null, 'RADIUS', {
          contractId: r.contract_id,
          customerId: r.customer_id,
          detail: r.username ? `sessão ativa · ${r.username}` : 'sessão ativa',
        }),
      )
      .filter((o): o is Observation => o !== null);
  }

  /** IPs fixos declarados nos contratos ativos. */
  private async fromContracts(tenantId: string): Promise<Observation[]> {
    const rows = await this.prisma.contract.findMany({
      where: { tenantId, deletedAt: null, framedIpAddress: { not: null }, status: { not: 'CANCELLED' } },
      select: { id: true, customerId: true, framedIpAddress: true, code: true, macAddress: true },
    });
    return rows
      .map((c) =>
        this.mk(c.framedIpAddress, 'CONTRACT', {
          contractId: c.id,
          customerId: c.customerId,
          macAddress: c.macAddress,
          detail: c.code ? `contrato ${c.code}` : 'contrato',
        }),
      )
      .filter((o): o is Observation => o !== null);
  }

  /** IPs de gerência dos equipamentos cadastrados. */
  private async fromEquipment(tenantId: string): Promise<Observation[]> {
    const rows = await this.prisma.networkEquipment.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, ipAddress: true },
    });
    return rows
      .map((e) => this.mk(e.ipAddress, 'EQUIPMENT', { equipmentId: e.id, detail: e.name }))
      .filter((o): o is Observation => o !== null);
  }

  // ── Varredura ───────────────────────────────────────────────────────────
  async scan(tenantId: string, input: ReconcileScanRequest) {
    const startedAt = Date.now();
    const warnings: CollectorWarning[] = [];

    const [radius, contracts, equipment] = await Promise.all([
      this.fromRadius(tenantId).catch((e) => {
        // Sem schema radius (deploy sem RADIUS) a varredura ainda vale pelas
        // outras fontes — degrada em vez de falhar.
        this.logger.warn(`[IpamReconcile] RADIUS indisponível: ${e?.message ?? e}`);
        warnings.push({ equipmentId: '', equipmentName: 'RADIUS', message: String(e?.message ?? e) });
        return [] as Observation[];
      }),
      this.fromContracts(tenantId),
      this.fromEquipment(tenantId),
    ]);

    const observations: Observation[] = [...radius, ...contracts, ...equipment];

    // Coleta ao vivo: só os equipamentos que o operador pediu explicitamente.
    const liveIds = input.equipmentIds ?? [];
    if (liveIds.length) {
      const equips = await this.prisma.networkEquipment.findMany({
        where: { id: { in: liveIds }, tenantId, deletedAt: null },
      });
      const missing = liveIds.filter((id) => !equips.some((e) => e.id === id));
      if (missing.length)
        throw new BadRequestException(`Equipamento(s) inexistente(s): ${missing.join(', ')}`);

      const live = await this.mikrotik.collect(equips);
      observations.push(...live.observations);
      warnings.push(...live.warnings);
    }

    const [docRows, prefixRows, deadRows] = await Promise.all([
      this.prisma.ipamAddress.findMany({
        where: { tenantId },
        select: {
          id: true,
          address: true,
          addrNum: true,
          version: true,
          status: true,
          contractId: true,
          customerId: true,
          equipmentId: true,
        },
      }),
      this.prisma.ipamPrefix.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, cidr: true, version: true, firstAddr: true, lastAddr: true },
      }),
      this.prisma.contract.findMany({
        where: { tenantId, OR: [{ deletedAt: { not: null } }, { status: 'CANCELLED' }] },
        select: { id: true },
      }),
    ]);

    const documented: DocumentedAddress[] = docRows.map((d) => ({
      id: d.id,
      num: toBig(d.addrNum),
      version: verToNum(d.version),
      address: d.address,
      status: d.status,
      contractId: d.contractId,
      customerId: d.customerId,
      equipmentId: d.equipmentId,
    }));
    const prefixes: PrefixRange[] = prefixRows.map((p) => ({
      id: p.id,
      cidr: p.cidr,
      version: verToNum(p.version),
      first: toBig(p.firstAddr),
      last: toBig(p.lastAddr),
    }));

    const findings = diffObservations({
      observations,
      documented,
      prefixes,
      deadContractIds: new Set(deadRows.map((c) => c.id)),
    });

    const bySource: Record<string, number> = {};
    for (const o of observations) bySource[o.source] = (bySource[o.source] ?? 0) + 1;
    const byKind: Record<string, number> = {};
    for (const f of findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;

    return {
      scannedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      liveEquipmentIds: liveIds,
      observedCount: observations.length,
      documentedCount: documented.length,
      bySource,
      byKind,
      warnings,
      findings,
    };
  }

  /** Equipamentos elegíveis pra coleta ao vivo (pra UI oferecer a escolha). */
  async liveTargets(tenantId: string) {
    const rows = await this.prisma.networkEquipment.findMany({
      where: { tenantId, deletedAt: null, vendor: 'MIKROTIK' },
      select: {
        id: true,
        name: true,
        ipAddress: true,
        apiUser: true,
        apiPasswordEnc: true,
        lastReachableAt: true,
      },
      orderBy: { name: 'asc' },
    });
    return rows.map((e) => ({
      id: e.id,
      name: e.name,
      ipAddress: e.ipAddress,
      ready: !!e.apiUser && !!e.apiPasswordEnc,
      lastReachableAt: e.lastReachableAt?.toISOString() ?? null,
    }));
  }

  /**
   * Importa achados `UNDOCUMENTED` pro IPAM. Só esse tipo é importável: sem
   * prefixo não há onde documentar, e divergência/órfão pede decisão humana
   * sobre qual lado está certo — não é coisa de aplicar em lote.
   */
  async importFindings(tenantId: string, actorId: string, input: ImportIpamFindingsRequest) {
    const imported: string[] = [];
    const skipped: { ip: string; reason: string }[] = [];

    // `IpamAddressesService.create` é upsert: IP já documentado com o mesmo dono
    // vira UPDATE e retorna sucesso. Sem checar antes, reimportar a mesma
    // varredura relataria "N importados" sem nada de novo ter sido documentado.
    const nums = input.items
      .filter((i) => isValidIp(i.ip))
      .map((i) => ipToBigInt(i.ip).toString());
    const already = new Set(
      (
        await this.prisma.ipamAddress.findMany({
          where: { tenantId, addrNum: { in: nums } },
          select: { addrNum: true },
        })
      ).map((a) => toBig(a.addrNum).toString()),
    );

    for (const item of input.items) {
      if (!isValidIp(item.ip)) {
        skipped.push({ ip: item.ip, reason: 'IP inválido' });
        continue;
      }
      const ip = normalizeIp(item.ip);
      if (already.has(ipToBigInt(ip).toString())) {
        skipped.push({ ip, reason: 'já documentado no IPAM' });
        continue;
      }
      try {
        await this.addresses.create(
          tenantId,
          actorId,
          {
            address: ip,
            prefixId: item.prefixId ?? null,
            status: 'USED',
            kind: item.contractId ? 'CONTRACT' : item.equipmentId ? 'EQUIPMENT' : 'OTHER',
            customerId: item.customerId ?? null,
            contractId: item.contractId ?? null,
            equipmentId: item.equipmentId ?? null,
            macAddress: item.macAddress ?? null,
            hostname: item.hostname ?? null,
            description: item.description ?? 'Importado pela reconciliação',
            isGateway: false,
          } as never,
          'RECONCILE',
        );
        imported.push(ip);
      } catch (e) {
        skipped.push({ ip, reason: e instanceof Error ? e.message : String(e) });
      }
    }

    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'ipam.reconcile.imported',
      resource: 'ipam_address',
      afterState: { imported: imported.length, skipped: skipped.length },
    });

    return { imported: imported.length, skipped, addresses: imported };
  }
}

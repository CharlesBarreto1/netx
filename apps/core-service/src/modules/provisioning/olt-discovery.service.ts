/**
 * OltDiscoveryService — descoberta de ONUs na OLT e casamento com o ERP.
 *
 * É o motor do NetX como "integrador técnico": varre a planta GPON de uma OLT
 * (via driver, ex.: FiberhomeTelnetDriver.listOnts) e grava cada ONU crua em
 * `discovered_onts` (staging), depois casa cada uma com um cliente do ERP
 * (Hubsoft) pelo MAC. Trabalha em CAMADAS desacopladas e retomáveis:
 *
 *   scan(oltId)    — camada 1: OLT → discovered_onts (idempotente por serial).
 *                    Gentil: o driver varre 1 PON por vez com pausas; cada PON
 *                    é persistida assim que chega (onProgress) — se cair no meio,
 *                    o que já entrou fica salvo.
 *   match(tenant)  — camada 2: discovered_onts (com MAC) → busca no Hubsoft por
 *                    MAC; marca MATCHED/UNMATCHED/AMBIGUOUS e guarda o vínculo.
 *
 * Materialização (camada 3: criar Contract+Ont) fica FORA daqui de propósito —
 * é um passo revisado à parte; nada de RADIUS automático.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DiscoveredOntMatchState, Prisma } from '@prisma/client';

import { CryptoService } from '../crypto/crypto.service';
import { HubsoftConfigService } from '../hubsoft/hubsoft-config.service';
import { HubsoftClientService } from '../hubsoft/hubsoft-client.service';
import { PrismaService } from '../prisma/prisma.service';

import { buildConnectionContext } from './olt-context.util';
import { OltDriverFactory } from './drivers/olt-driver.factory';
import type { DiscoveredOntRaw } from './drivers/olt-driver.interface';

export interface OltScanResult {
  oltId: string;
  discovered: number;
  withMac: number;
  durationMs: number;
  error?: string;
}

export interface OltMatchResult {
  scanned: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
  errors: number;
}

@Injectable()
export class OltDiscoveryService {
  private readonly logger = new Logger(OltDiscoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly drivers: OltDriverFactory,
    private readonly hubsoftConfig: HubsoftConfigService,
    private readonly hubsoftClient: HubsoftClientService,
  ) {}

  // ===========================================================================
  // Camada 1 — SCAN: OLT → discovered_onts
  // ===========================================================================
  async scan(
    tenantId: string,
    oltId: string,
    opts: { collectMac?: boolean } = {},
  ): Promise<OltScanResult> {
    const startedAt = Date.now();
    const olt = await this.prisma.olt.findFirst({ where: { id: oltId, tenantId, deletedAt: null } });
    if (!olt) throw new NotFoundException('OLT não encontrada');

    const driver = this.drivers.resolve(olt.vendor, olt.providerMode);
    if (!driver.listOnts) {
      throw new Error(`Driver ${driver.name} não suporta descoberta de ONU (listOnts).`);
    }

    const ctx = buildConnectionContext(olt, this.crypto);
    let discovered = 0;
    let withMac = 0;

    // onProgress grava cada PON assim que o driver a entrega — persistência
    // incremental, resiliente a queda no meio de uma varredura longa.
    const result = await driver.listOnts(ctx, {
      collectMac: opts.collectMac ?? true,
      onProgress: async (batch, meta) => {
        const saved = await this.persistBatch(tenantId, oltId, batch);
        discovered += saved.count;
        withMac += saved.withMac;
        this.logger.log(
          `[olt-scan] olt=${olt.name} slot=${meta.slot} pon=${meta.pon} +${saved.count} onus (${saved.withMac} c/ mac)`,
        );
      },
    });

    await this.prisma.olt.update({
      where: { id: oltId },
      data: { lastSeenAt: new Date(), lastError: result.success ? null : result.error },
    });

    const out: OltScanResult = {
      oltId,
      discovered,
      withMac,
      durationMs: Date.now() - startedAt,
    };
    if (!result.success) {
      out.error = result.error;
      this.logger.warn(`[olt-scan] olt=${olt.name} FALHOU: ${result.error}`);
    }
    return out;
  }

  /** Upsert idempotente de um lote de ONUs cruas (chave olt+serial). */
  private async persistBatch(
    tenantId: string,
    oltId: string,
    batch: DiscoveredOntRaw[],
  ): Promise<{ count: number; withMac: number }> {
    let count = 0;
    let withMac = 0;
    for (const raw of batch) {
      if (!raw.serial) continue;
      const now = new Date();
      const data = {
        slot: raw.slot,
        pon: raw.pon,
        onuIndex: raw.onuIndex,
        model: raw.model ?? null,
        onuState: raw.onuState ?? null,
        macAddress: raw.macAddress ?? null,
        vlan: raw.vlan ?? null,
        lastSeenAt: now,
      };
      await this.prisma.discoveredOnt.upsert({
        where: { oltId_serial: { oltId, serial: raw.serial } },
        // Na descoberta não mexemos em matchState/erp* de linhas já casadas —
        // só atualizamos os fatos físicos e o lastSeenAt.
        update: data,
        create: {
          tenantId,
          oltId,
          serial: raw.serial,
          ...data,
          firstSeenAt: now,
          matchState: DiscoveredOntMatchState.DISCOVERED,
        },
      });
      count += 1;
      if (raw.macAddress) withMac += 1;
    }
    return { count, withMac };
  }

  // ===========================================================================
  // Camada 2 — MATCH: discovered_onts (com MAC) → cliente no Hubsoft
  // ===========================================================================
  async matchAgainstHubsoft(
    tenantId: string,
    opts: { limit?: number } = {},
  ): Promise<OltMatchResult> {
    const cfg = await this.hubsoftConfig.resolve(tenantId); // lança se não habilitado
    const pend = await this.prisma.discoveredOnt.findMany({
      where: {
        tenantId,
        matchState: DiscoveredOntMatchState.DISCOVERED,
        macAddress: { not: null },
      },
      take: opts.limit ?? 500,
      orderBy: { firstSeenAt: 'asc' },
    });

    const res: OltMatchResult = { scanned: 0, matched: 0, unmatched: 0, ambiguous: 0, errors: 0 };
    for (const ont of pend) {
      res.scanned += 1;
      const mac = ont.macAddress!;
      try {
        // Busca reversa por MAC (validado: busca=mac funciona na wifire).
        const clientes = await this.hubsoftClient.getClientes(cfg, {
          busca: 'mac',
          termo_busca: mac,
        });
        const matches = clientes.filter((c) => this.str(c.codigo_cliente ?? c.id_cliente));

        if (matches.length === 0) {
          await this.setMatch(ont.id, DiscoveredOntMatchState.UNMATCHED, {
            matchNote: `MAC ${mac} não encontrado no Hubsoft`,
          });
          res.unmatched += 1;
        } else if (matches.length > 1) {
          await this.setMatch(ont.id, DiscoveredOntMatchState.AMBIGUOUS, {
            matchNote: `MAC ${mac} casou com ${matches.length} clientes`,
          });
          res.ambiguous += 1;
        } else {
          const cli = matches[0];
          const codigo = this.str(cli.codigo_cliente ?? cli.id_cliente);
          const svc = (cli.servicos ?? []).find((s) => this.macEq(s.mac_addr, mac))
            ?? (cli.servicos ?? [])[0];
          await this.setMatch(ont.id, DiscoveredOntMatchState.MATCHED, {
            erpSource: 'hubsoft',
            erpCustomerCode: codigo,
            erpServiceId: svc ? this.str(svc.id_cliente_servico) : null,
            matchNote: `Casado por MAC com cliente Hubsoft ${codigo}`,
          });
          res.matched += 1;
        }
      } catch (e) {
        res.errors += 1;
        this.logger.warn(`[olt-match] ONU ${ont.serial} mac=${mac} erro: ${(e as Error).message}`);
      }
    }
    this.logger.log(
      `[olt-match] tenant=${tenantId} scanned=${res.scanned} matched=${res.matched} unmatched=${res.unmatched} ambiguous=${res.ambiguous} errors=${res.errors}`,
    );
    return res;
  }

  private async setMatch(
    id: string,
    state: DiscoveredOntMatchState,
    data: Prisma.DiscoveredOntUpdateInput,
  ): Promise<void> {
    await this.prisma.discoveredOnt.update({ where: { id }, data: { matchState: state, ...data } });
  }

  // ===========================================================================
  // Leitura — staging para revisão
  // ===========================================================================
  async listDiscovered(tenantId: string): Promise<{
    total: number;
    byState: Record<string, number>;
    items: Array<{
      id: string;
      oltId: string;
      serial: string;
      slot: number;
      pon: number;
      onuIndex: number;
      model: string | null;
      onuState: string | null;
      macAddress: string | null;
      vlan: number | null;
      matchState: DiscoveredOntMatchState;
      erpCustomerCode: string | null;
      matchNote: string | null;
      lastSeenAt: string;
    }>;
  }> {
    const rows = await this.prisma.discoveredOnt.findMany({
      where: { tenantId },
      orderBy: [{ slot: 'asc' }, { pon: 'asc' }, { onuIndex: 'asc' }],
      take: 2000,
    });
    const byState: Record<string, number> = {};
    for (const r of rows) byState[r.matchState] = (byState[r.matchState] ?? 0) + 1;
    return {
      total: rows.length,
      byState,
      items: rows.map((r) => ({
        id: r.id,
        oltId: r.oltId,
        serial: r.serial,
        slot: r.slot,
        pon: r.pon,
        onuIndex: r.onuIndex,
        model: r.model,
        onuState: r.onuState,
        macAddress: r.macAddress,
        vlan: r.vlan,
        matchState: r.matchState,
        erpCustomerCode: r.erpCustomerCode,
        matchNote: r.matchNote,
        lastSeenAt: r.lastSeenAt.toISOString(),
      })),
    };
  }

  private str(v: unknown): string {
    return v == null ? '' : String(v).trim();
  }

  private macEq(a: unknown, b: string): boolean {
    const na = this.str(a).replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    const nb = b.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    return !!na && na === nb;
  }
}

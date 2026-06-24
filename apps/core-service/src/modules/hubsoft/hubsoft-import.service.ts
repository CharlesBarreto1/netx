/**
 * Importa dados do Hubsoft para os modelos do NetX (read-only no Hubsoft).
 *
 * Idempotência por CHAVE EXTERNA estável:
 *   - Customer.code        = "HS-{codigo_cliente}"
 *   - Contract.code        = "HS-SVC-{id_cliente_servico}"
 *   - Plan                 = casado por nome (tenantId, name)
 *   - ContractInvoice.reference = "HS-FAT-{id_fatura}"
 * Reexecutar o sync ATUALIZA o que já existe (não duplica).
 *
 * Mapeamento DEFENSIVO: o JSON do Hubsoft varia por versão do ERP. Use o
 * dry-run (não grava) para conferir o "preview" contra o retorno real antes de
 * comprometer dados. Cada registro é isolado em try/catch — uma linha ruim não
 * derruba o lote; o erro entra em `errors[]`.
 */
import { Injectable, Logger } from '@nestjs/common';
import type {
  HubsoftSyncEntity,
  HubsoftSyncEntityResult,
  HubsoftSyncStats,
  RunHubsoftSyncRequest,
} from '@netx/shared';
import {
  ContractAuthMethod,
  ContractStatus,
  CustomerStatus,
  CustomerType,
  InvoiceStatus,
  TaxIdType,
} from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import { HubsoftClientService } from './hubsoft-client.service';
import { HubsoftConfigService } from './hubsoft-config.service';
import type {
  HubsoftCliente,
  HubsoftEndereco,
  HubsoftFatura,
  HubsoftResolvedConfig,
  HubsoftServico,
} from './hubsoft.types';

const HS_CUSTOMER_PREFIX = 'HS-';
const HS_CONTRACT_PREFIX = 'HS-SVC-';
const HS_INVOICE_PREFIX = 'HS-FAT-';
const DEFAULT_DUE_DAY = 10;

@Injectable()
export class HubsoftImportService {
  private readonly logger = new Logger(HubsoftImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: HubsoftClientService,
    private readonly config: HubsoftConfigService,
    private readonly audit: AuditService,
  ) {}

  // ===========================================================================
  // Orquestração
  // ===========================================================================
  async run(
    tenantId: string,
    actorUserId: string,
    opts: RunHubsoftSyncRequest = {},
  ): Promise<HubsoftSyncStats> {
    const cfg = await this.config.resolve(tenantId);
    const dryRun = opts.dryRun ?? false;
    const limit = opts.limit;

    const cfgRow = await this.prisma.hubsoftConfig.findUnique({ where: { tenantId } });
    const entities: HubsoftSyncEntity[] =
      opts.entities ??
      ([
        cfgRow?.syncCustomers ? 'customers' : null,
        cfgRow?.syncFinanceiro ? 'financeiro' : null,
      ].filter(Boolean) as HubsoftSyncEntity[]);

    const startedAt = new Date();
    const results: HubsoftSyncEntityResult[] = [];

    for (const entity of entities) {
      try {
        if (entity === 'customers') {
          results.push(await this.importCustomers(tenantId, cfg, dryRun, limit));
        } else if (entity === 'financeiro') {
          results.push(await this.importFinanceiro(tenantId, cfg, dryRun, limit));
        }
      } catch (e) {
        results.push({
          entity,
          fetched: 0,
          created: 0,
          updated: 0,
          skipped: 0,
          failed: 1,
          errors: [{ ref: entity, message: e instanceof Error ? e.message : String(e) }],
        });
      }
    }

    const finishedAt = new Date();
    const stats: HubsoftSyncStats = {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      dryRun,
      entities: results,
    };

    if (!dryRun) {
      const anyFailed = results.some((r) => r.failed > 0);
      const status = anyFailed ? 'PARTIAL' : 'OK';
      await this.config.recordSync(tenantId, status, stats, null);
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'hubsoft.sync.run',
        resource: 'hubsoft_config',
        resourceId: tenantId,
        metadata: {
          entities: results.map((r) => ({
            entity: r.entity,
            fetched: r.fetched,
            created: r.created,
            updated: r.updated,
            failed: r.failed,
          })),
        },
      });
    }

    return stats;
  }

  // ===========================================================================
  // Clientes + Contratos (+ Planos)
  // ===========================================================================
  private async importCustomers(
    tenantId: string,
    cfg: HubsoftResolvedConfig,
    dryRun: boolean,
    limit?: number,
  ): Promise<HubsoftSyncEntityResult> {
    const res: HubsoftSyncEntityResult = {
      entity: 'customers',
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      preview: dryRun ? [] : undefined,
    };

    let clientes = limit
      ? await this.client.getClientes(cfg, { limit })
      : await this.client.getClientesAll(cfg);
    if (limit) clientes = clientes.slice(0, limit);
    res.fetched = clientes.length;

    for (const cli of clientes) {
      const codigo = this.str(cli.codigo_cliente ?? cli.id_cliente);
      if (!codigo) {
        res.skipped += 1;
        continue;
      }
      try {
        const customerData = this.mapCliente(cli, codigo);

        if (dryRun) {
          res.preview!.push({
            customer: customerData,
            contracts: (cli.servicos ?? []).map((s) => this.mapServicoPreview(s)),
          });
          continue;
        }

        const { id: customerId, created } = await this.upsertCustomer(tenantId, customerData);
        if (created) res.created += 1;
        else res.updated += 1;

        for (const svc of cli.servicos ?? []) {
          try {
            await this.upsertContract(tenantId, customerId, cli, svc);
          } catch (e) {
            res.failed += 1;
            res.errors.push({
              ref: `${codigo}/svc:${this.str(svc.id_cliente_servico)}`,
              message: e instanceof Error ? e.message : String(e),
            });
          }
        }
      } catch (e) {
        res.failed += 1;
        res.errors.push({ ref: codigo, message: e instanceof Error ? e.message : String(e) });
      }
    }

    this.logger.log(
      `[hubsoft-import] customers tenant=${tenantId} fetched=${res.fetched} created=${res.created} updated=${res.updated} failed=${res.failed}${dryRun ? ' (dry-run)' : ''}`,
    );
    return res;
  }

  private mapCliente(cli: HubsoftCliente, codigo: string) {
    const isCompany = /jur|pj|cnpj/i.test(this.str(cli.tipo_pessoa));
    const digits = this.str(cli.cpf_cnpj).replace(/\D/g, '');
    const taxIdType: TaxIdType | null = digits
      ? digits.length > 11
        ? TaxIdType.CNPJ
        : TaxIdType.CPF
      : null;
    const displayName =
      this.str(cli.nome_razaosocial) ||
      this.str(cli.nome) ||
      this.str(cli.nome_fantasia) ||
      `Cliente HS ${codigo}`;

    return {
      code: `${HS_CUSTOMER_PREFIX}${codigo}`,
      type: isCompany ? CustomerType.COMPANY : CustomerType.INDIVIDUAL,
      status: this.mapCustomerStatus(this.str(cli.status ?? cli.status_txt)),
      companyName: isCompany ? this.str(cli.nome_razaosocial) || null : null,
      tradeName: isCompany ? this.str(cli.nome_fantasia) || null : null,
      firstName: !isCompany ? this.firstName(displayName) : null,
      lastName: !isCompany ? this.lastName(displayName) : null,
      displayName: displayName.slice(0, 255),
      taxId: digits || null,
      taxIdType,
      taxIdCountry: 'BR',
      stateRegistration: this.str(cli.inscricao_estadual) || null,
      municipalRegistration: this.str(cli.inscricao_municipal) || null,
      primaryEmail: this.str(cli.email_principal).toLowerCase() || null,
      primaryPhone: this.str(cli.telefone_primario) || null,
      birthDate: this.dateOrNull(cli.data_nascimento ?? cli.data_nascmento),
      metadata: {
        hubsoftId: this.str(cli.id_cliente) || null,
        hubsoftCodigo: codigo,
        importedFrom: 'hubsoft',
      },
    };
  }

  private mapServicoPreview(svc: HubsoftServico) {
    return {
      code: `${HS_CONTRACT_PREFIX}${this.str(svc.id_cliente_servico)}`,
      planName: this.str(svc.numero_plano) || null,
      pppoeUsername: this.str(svc.login) || null,
      monthlyValue: this.decimal(svc.valor),
      bandwidthMbps: this.bandwidth(svc.numero_plano),
      status: this.mapContractStatus(this.str(svc.status ?? svc.status_txt)),
    };
  }

  private async upsertCustomer(
    tenantId: string,
    data: ReturnType<HubsoftImportService['mapCliente']>,
  ): Promise<{ id: string; created: boolean }> {
    const existing = await this.prisma.customer.findUnique({
      where: { tenantId_code: { tenantId, code: data.code } },
      select: { id: true },
    });
    const saved = await this.prisma.customer.upsert({
      where: { tenantId_code: { tenantId, code: data.code } },
      create: { tenantId, ...data },
      update: data,
      select: { id: true },
    });
    return { id: saved.id, created: !existing };
  }

  private async upsertContract(
    tenantId: string,
    customerId: string,
    cli: HubsoftCliente,
    svc: HubsoftServico,
  ): Promise<void> {
    const svcId = this.str(svc.id_cliente_servico);
    if (!svcId) return; // sem chave estável → não dá pra ser idempotente
    const code = `${HS_CONTRACT_PREFIX}${svcId}`;

    const planId = await this.upsertPlan(tenantId, svc);
    const login = this.str(svc.login) || null;
    const installationAddress =
      this.enderecoStr(svc.endereco_instalacao) ||
      this.enderecoStr(cli.endereco_instalacao) ||
      this.enderecoStr(cli.endereco_cadastral) ||
      'Endereço não informado (Hubsoft)';

    const data = {
      code,
      authMethod: login ? ContractAuthMethod.PPPOE : ContractAuthMethod.IPOE,
      pppoeUsername: login,
      pppoePassword: this.str(svc.senha) || null,
      installationAddress: installationAddress.slice(0, 500),
      planId,
      monthlyValue: this.decimal(svc.valor),
      bandwidthMbps: this.bandwidth(svc.numero_plano),
      uploadMbps: this.bandwidth(svc.numero_plano),
      dueDay: DEFAULT_DUE_DAY,
      status: this.mapContractStatus(this.str(svc.status ?? svc.status_txt)),
      notes: `Importado do Hubsoft (serviço ${svcId}).`,
    };

    await this.prisma.contract.upsert({
      where: { tenantId_code: { tenantId, code } },
      create: { tenantId, customerId, ...data },
      update: data,
    });
  }

  /** Casa/insere o plano pelo nome. Retorna planId ou null se sem nome. */
  private async upsertPlan(tenantId: string, svc: HubsoftServico): Promise<string | null> {
    const name = this.str(svc.numero_plano);
    if (!name) return null;
    const mbps = this.bandwidth(svc.numero_plano);
    const plan = await this.prisma.plan.upsert({
      where: { tenantId_name: { tenantId, name: name.slice(0, 120) } },
      create: {
        tenantId,
        name: name.slice(0, 120),
        downloadMbps: mbps,
        uploadMbps: mbps,
        monthlyPrice: this.decimal(svc.valor),
        description: 'Plano importado do Hubsoft',
      },
      update: {}, // não sobrescreve plano existente (pode ter sido ajustado no NetX)
      select: { id: true },
    });
    return plan.id;
  }

  // ===========================================================================
  // Financeiro (faturas)
  // ===========================================================================
  private async importFinanceiro(
    tenantId: string,
    cfg: HubsoftResolvedConfig,
    dryRun: boolean,
    limit?: number,
  ): Promise<HubsoftSyncEntityResult> {
    const res: HubsoftSyncEntityResult = {
      entity: 'financeiro',
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      preview: dryRun ? [] : undefined,
    };

    // O financeiro do Hubsoft é POR cliente. Pegamos a lista de códigos a partir
    // dos clientes já importados no NetX (code HS-...) — assim só puxamos fatura
    // de quem realmente migrou.
    const customers = await this.prisma.customer.findMany({
      where: { tenantId, code: { startsWith: HS_CUSTOMER_PREFIX } },
      select: { id: true, code: true },
      ...(limit ? { take: limit } : {}),
    });

    for (const cust of customers) {
      const codigo = (cust.code ?? '').slice(HS_CUSTOMER_PREFIX.length);
      if (!codigo) {
        res.skipped += 1;
        continue;
      }
      let faturas: HubsoftFatura[];
      try {
        faturas = await this.client.getFinanceiroCliente(cfg, codigo);
      } catch (e) {
        res.failed += 1;
        res.errors.push({ ref: codigo, message: e instanceof Error ? e.message : String(e) });
        continue;
      }
      res.fetched += faturas.length;

      for (const fat of faturas) {
        try {
          const r = await this.upsertInvoice(tenantId, cust.id, fat, dryRun, res);
          if (r === 'skipped') res.skipped += 1;
          else if (r === 'created') res.created += 1;
          else if (r === 'updated') res.updated += 1;
        } catch (e) {
          res.failed += 1;
          res.errors.push({
            ref: `fat:${this.str(fat.id_fatura)}`,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    this.logger.log(
      `[hubsoft-import] financeiro tenant=${tenantId} fetched=${res.fetched} created=${res.created} updated=${res.updated} failed=${res.failed}${dryRun ? ' (dry-run)' : ''}`,
    );
    return res;
  }

  private async upsertInvoice(
    tenantId: string,
    customerId: string,
    fat: HubsoftFatura,
    dryRun: boolean,
    res: HubsoftSyncEntityResult,
  ): Promise<'created' | 'updated' | 'skipped'> {
    const fatId = this.str(fat.id_fatura);
    if (!fatId) return 'skipped';
    const reference = `${HS_INVOICE_PREFIX}${fatId}`;

    // A fatura precisa de um contrato. Casamos pelo serviço (id_cliente_servico);
    // se não houver, usamos o 1º contrato do cliente como fallback.
    let contractId: string | null = null;
    const svcId = this.str(fat.id_cliente_servico);
    if (svcId) {
      const c = await this.prisma.contract.findUnique({
        where: { tenantId_code: { tenantId, code: `${HS_CONTRACT_PREFIX}${svcId}` } },
        select: { id: true },
      });
      contractId = c?.id ?? null;
    }
    if (!contractId) {
      const c = await this.prisma.contract.findFirst({
        where: { tenantId, customerId },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      contractId = c?.id ?? null;
    }
    if (!contractId) return 'skipped'; // sem contrato → não dá pra ancorar a fatura

    const data = {
      amount: this.decimal(fat.valor),
      dueDate: this.dateOrNull(fat.data_vencimento) ?? new Date(),
      status: this.mapInvoiceStatus(this.str(fat.status ?? fat.status_fatura)),
      paidAt: this.dateOrNull(fat.data_pagamento),
      paidAmount: fat.valor_pago != null ? this.decimal(fat.valor_pago) : null,
      reference,
    };

    if (dryRun) {
      res.preview!.push({ contractId, ...data });
      // Conta como "created/updated" virtual só pra telemetria do preview.
      const exists = await this.prisma.contractInvoice.findFirst({
        where: { tenantId, reference },
        select: { id: true },
      });
      return exists ? 'updated' : 'created';
    }

    const existing = await this.prisma.contractInvoice.findFirst({
      where: { tenantId, reference },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.contractInvoice.update({ where: { id: existing.id }, data });
      return 'updated';
    }
    await this.prisma.contractInvoice.create({ data: { tenantId, contractId, ...data } });
    return 'created';
  }

  // ===========================================================================
  // Helpers de normalização
  // ===========================================================================
  private str(v: unknown): string {
    return v == null ? '' : String(v).trim();
  }

  /** "1.234,56" | "1234.56" | 1234.5 → number (2 casas). 0 se inválido. */
  private decimal(v: unknown): number {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const s = this.str(v);
    if (!s) return 0;
    // Formato BR: remove separador de milhar '.', troca ',' decimal por '.'.
    const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
    const n = Number(normalized.replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  /** Primeiro inteiro do nome do plano ("300 MEGA" → 300). 0 se nenhum. */
  private bandwidth(planName: unknown): number {
    const m = this.str(planName).match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
  }

  private dateOrNull(v: unknown): Date | null {
    const s = this.str(v);
    if (!s) return null;
    // ISO "2020-03-05" ou "2020-03-05 10:00:00".
    let d = new Date(s.replace(' ', 'T'));
    if (!isNaN(d.getTime())) return d;
    // BR "05/03/2020".
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) {
      d = new Date(`${m[3]}-${m[2]}-${m[1]}`);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  }

  private enderecoStr(e: HubsoftEndereco | string | undefined): string {
    if (!e) return '';
    if (typeof e === 'string') return e.trim();
    if (e.completo) return this.str(e.completo);
    const parts = [e.logradouro ?? e.endereco, e.numero, e.bairro, e.cidade, e.uf, e.cep].filter(
      Boolean,
    );
    return parts.join(', ');
  }

  private firstName(full: string): string {
    return full.split(/\s+/)[0]?.slice(0, 120) || full.slice(0, 120);
  }

  private lastName(full: string): string | null {
    const rest = full.split(/\s+/).slice(1).join(' ').trim();
    return rest ? rest.slice(0, 120) : null;
  }

  private mapCustomerStatus(s: string): CustomerStatus {
    const t = s.toLowerCase();
    if (/cancel|churn/.test(t)) return CustomerStatus.CHURNED;
    if (/inativ|desativ/.test(t)) return CustomerStatus.INACTIVE;
    if (/bloque|suspens/.test(t)) return CustomerStatus.SUSPENDED;
    return CustomerStatus.ACTIVE;
  }

  private mapContractStatus(s: string): ContractStatus {
    const t = s.toLowerCase();
    if (/cancel/.test(t)) return ContractStatus.CANCELLED;
    if (/bloque|suspens|inativ/.test(t)) return ContractStatus.SUSPENDED;
    return ContractStatus.ACTIVE;
  }

  private mapInvoiceStatus(s: string): InvoiceStatus {
    const t = s.toLowerCase();
    if (/pag|quit|liquid/.test(t)) return InvoiceStatus.PAID;
    if (/cancel/.test(t)) return InvoiceStatus.CANCELLED;
    if (/venc|atras/.test(t)) return InvoiceStatus.OVERDUE;
    return InvoiceStatus.OPEN;
  }
}

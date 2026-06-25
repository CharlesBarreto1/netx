/**
 * Importa dados do Hubsoft para os modelos do NetX (read-only no Hubsoft).
 *
 * Idempotência por CHAVE EXTERNA estável:
 *   - Customer.code        = "HS-{codigo_cliente}"
 *   - Contract.externalRef = "HS-SVC-{id_cliente_servico}" (identidade estável);
 *     Contract.code = código do cliente (2561), e 2561-1/2561-2 do 2º serviço
 *     em diante — é o NÚMERO do contrato visível no NetX
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
  BrowseHubsoftCustomersRequest,
  BrowseHubsoftCustomersResponse,
  HubsoftCustomerFilters,
  HubsoftCustomerListItem,
  HubsoftServiceStatus,
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
// /cliente/all NÃO embute endereços sem `incluir` (default "Nenhum") — sem isto
// o filtro/coluna de cidade fica vazio.
const HS_INCLUIR_ENDERECOS =
  'endereco_instalacao,endereco_cadastral,endereco_cobranca,endereco_fiscal';

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
          results.push(
            await this.importCustomers(tenantId, cfg, dryRun, {
              limit,
              filters: opts.filters,
              codigos: opts.codigos,
              onlyImported: opts.onlyImported,
            }),
          );
        } else if (entity === 'financeiro') {
          results.push(
            await this.importFinanceiro(tenantId, cfg, dryRun, { limit, codigos: opts.codigos }),
          );
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
  // BROWSE — listar clientes do Hubsoft p/ escolher quem importar (não grava)
  // ===========================================================================
  async browse(
    tenantId: string,
    req: BrowseHubsoftCustomersRequest,
  ): Promise<BrowseHubsoftCustomersResponse> {
    const cfg = await this.config.resolve(tenantId);
    const filters = req.filters;
    const cancelado: 'sim' | 'nao' = filters?.status?.includes('cancelado') ? 'sim' : 'nao';
    const page = req.page ?? 1;
    const pageSize = req.pageSize ?? 50;
    const hasClientFilter = !!(
      filters?.cidades?.length ||
      filters?.status?.length ||
      filters?.grupos?.length
    );

    const imported = await this.importedCodigos(tenantId);
    const toItems = (list: HubsoftCliente[]) =>
      list
        .filter((cli) => this.str(cli.codigo_cliente ?? cli.id_cliente))
        .map((cli) => this.toListItem(cli, imported, filters));

    // 1) Busca textual → rota /cliente (server-side, rápida). Conjunto pequeno;
    //    aplica filtros client-side e pagina em memória.
    if (req.search) {
      const digits = req.search.replace(/\D/g, '');
      const byDoc = digits.length >= 11;
      const found = await this.client.getClientes(cfg, {
        busca: byDoc ? 'cpf_cnpj' : 'nome_razaosocial',
        termo_busca: byDoc ? digits : req.search,
        cancelado,
      });
      const filtered = this.applyBrowseFilters(found, filters);
      const slice = filtered.slice((page - 1) * pageSize, page * pageSize);
      return {
        items: toItems(slice),
        total: filtered.length,
        page,
        pageSize,
        hasMore: page * pageSize < filtered.length,
      };
    }

    // 2) Com filtros client-side (cidade/status/grupo) precisamos da base toda
    //    p/ filtrar — /cliente/all (timeout generoso), filtra e pagina em memória.
    //    `incluir` traz endereços (cidade) e, p/ grupo, pacotes/grupos.
    if (hasClientFilter) {
      const incluir = filters?.grupos?.length
        ? `${HS_INCLUIR_ENDERECOS},pacotes,grupos`
        : HS_INCLUIR_ENDERECOS;
      const all = await this.client.getClientesAll(cfg, { cancelado, incluir });
      const filtered = this.applyBrowseFilters(all, filters);
      const slice = filtered.slice((page - 1) * pageSize, page * pageSize);
      return {
        items: toItems(slice),
        total: filtered.length,
        page,
        pageSize,
        hasMore: page * pageSize < filtered.length,
      };
    }

    // 3) Listagem pura → pagina SERVER-SIDE no /cliente/all (limit+offset).
    //    Evita baixar a base inteira e o timeout. Total fica desconhecido.
    const pageItems = await this.client.getClientesAll(cfg, {
      cancelado,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      incluir: HS_INCLUIR_ENDERECOS, // p/ a coluna Cidade aparecer
    });
    return {
      items: toItems(pageItems),
      total: null,
      page,
      pageSize,
      hasMore: pageItems.length === pageSize,
    };
  }

  /** Filtros client-side (cidade/status/grupo) sobre a lista do Hubsoft. */
  private applyBrowseFilters(
    clientes: HubsoftCliente[],
    filters?: HubsoftCustomerFilters,
  ): HubsoftCliente[] {
    const hasServiceFilter = !!(filters?.status?.length || filters?.grupos?.length);
    if (!filters?.cidades?.length && !hasServiceFilter) return clientes;
    return clientes.filter((cli) => {
      if (filters?.cidades?.length && !this.matchCity(cli, filters.cidades)) return false;
      if (hasServiceFilter && this.matchServicos(cli.servicos ?? [], filters).length === 0) {
        return false;
      }
      return true;
    });
  }

  /**
   * Busca clientes por código, um a um, via /cliente?busca=codigo_cliente —
   * rota leve e confiável (a /cliente/all pode ser pesada/instável). Tolera
   * falhas por código (vão pra `errors`) e ignora códigos não encontrados,
   * registrando-os para visibilidade.
   */
  private async fetchByCodigos(
    cfg: HubsoftResolvedConfig,
    codigos: string[],
    cancelado: 'sim' | 'nao',
  ): Promise<{ clientes: HubsoftCliente[]; errors: Array<{ ref: string; message: string }> }> {
    const clientes: HubsoftCliente[] = [];
    const errors: Array<{ ref: string; message: string }> = [];
    const seen = new Set<string>();
    for (const codigo of codigos) {
      try {
        const found = await this.client.getClientes(cfg, {
          busca: 'codigo_cliente',
          termo_busca: codigo,
          cancelado,
        });
        // /cliente pode casar parcialmente — fica só com o código exato.
        const exact = found.filter(
          (c) => this.str(c.codigo_cliente ?? c.id_cliente) === String(codigo),
        );
        if (!exact.length) {
          errors.push({ ref: codigo, message: 'cliente não encontrado no Hubsoft' });
          continue;
        }
        for (const c of exact) {
          const key = this.str(c.codigo_cliente ?? c.id_cliente);
          if (key && !seen.has(key)) {
            seen.add(key);
            clientes.push(c);
          }
        }
      } catch (e) {
        errors.push({ ref: codigo, message: e instanceof Error ? e.message : String(e) });
      }
    }
    return { clientes, errors };
  }

  /** Conjunto de codigo_cliente já importados no NetX (Customer HS-<codigo>). */
  private async importedCodigos(tenantId: string): Promise<Set<string>> {
    const rows = await this.prisma.customer.findMany({
      where: { tenantId, code: { startsWith: HS_CUSTOMER_PREFIX } },
      select: { code: true },
    });
    return new Set(
      rows.map((r) => (r.code ?? '').slice(HS_CUSTOMER_PREFIX.length)).filter(Boolean),
    );
  }

  private toListItem(
    cli: HubsoftCliente,
    imported: Set<string>,
    filters?: HubsoftCustomerFilters,
  ): HubsoftCustomerListItem {
    const codigo = this.str(cli.codigo_cliente ?? cli.id_cliente);
    const servicos =
      filters?.status?.length || filters?.grupos?.length
        ? this.matchServicos(cli.servicos ?? [], filters)
        : cli.servicos ?? [];
    const planos = [...new Set(servicos.map((s) => this.planName(s)).filter(Boolean))];
    return {
      codigo,
      id: this.str(cli.id_cliente),
      nome: this.str(cli.nome_razaosocial) || this.str(cli.nome) || `Cliente HS ${codigo}`,
      cpfCnpj: this.str(cli.cpf_cnpj),
      cidade: this.firstCidade(cli),
      statusLabel:
        this.str(cli.status_txt ?? cli.status) ||
        (servicos[0] ? this.serviceStatusText(servicos[0]) : ''),
      planos,
      servicosCount: servicos.length,
      alreadyImported: imported.has(codigo),
    };
  }

  private firstCidade(cli: HubsoftCliente): string {
    const cands = [
      cli.endereco_instalacao,
      cli.endereco_cadastral,
      cli.endereco_cobranca,
      cli.endereco_fiscal,
      ...(cli.servicos ?? []).map((s) => s.endereco_instalacao),
    ];
    for (const e of cands) {
      if (e && typeof e === 'object' && e.cidade) return this.str(e.cidade);
    }
    return '';
  }

  // ===========================================================================
  // Clientes + Contratos (+ Planos)
  // ===========================================================================
  private async importCustomers(
    tenantId: string,
    cfg: HubsoftResolvedConfig,
    dryRun: boolean,
    opts: {
      limit?: number;
      filters?: HubsoftCustomerFilters;
      codigos?: string[]; // importar apenas estes (seleção manual)
      onlyImported?: boolean; // re-sync só dos já importados (cron)
    } = {},
  ): Promise<HubsoftSyncEntityResult> {
    const { limit, filters, codigos, onlyImported } = opts;
    const res: HubsoftSyncEntityResult = {
      entity: 'customers',
      fetched: 0,
      filteredOut: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      preview: dryRun ? [] : undefined,
    };

    // Pushdown: a API só filtra `cancelado`. Se o filtro de status NÃO inclui
    // 'cancelado', pedimos cancelado=nao (não traz serviços cancelados — mais
    // leve). Se inclui, cancelado=sim. Sem filtro de status → comportamento
    // padrão da API (nao). Cidade/status/grupo são aplicados client-side abaixo.
    const cancelado: 'sim' | 'nao' = filters?.status?.includes('cancelado') ? 'sim' : 'nao';

    // Seleção (codigos) e re-sync de importados (onlyImported) buscam CADA cliente
    // por código via /cliente?busca=codigo_cliente — rota leve e confiável. Só a
    // importação em massa (sem seleção) usa /cliente/all.
    let clientes: HubsoftCliente[];
    if (codigos?.length) {
      const r = await this.fetchByCodigos(cfg, codigos, cancelado);
      clientes = r.clientes;
      res.errors.push(...r.errors);
      res.failed += r.errors.length;
    } else if (onlyImported) {
      const imported = [...(await this.importedCodigos(tenantId))];
      const r = await this.fetchByCodigos(cfg, imported, cancelado);
      clientes = r.clientes;
      res.errors.push(...r.errors);
      res.failed += r.errors.length;
    } else {
      clientes = await this.client.getClientesAll(cfg, {
        cancelado,
        incluir: HS_INCLUIR_ENDERECOS,
        ...(limit ? { limit } : {}),
      });
    }
    if (limit) clientes = clientes.slice(0, limit);
    res.fetched = clientes.length;

    const hasServiceFilter = !!(filters?.status?.length || filters?.grupos?.length);

    for (const cli of clientes) {
      const codigo = this.str(cli.codigo_cliente ?? cli.id_cliente);
      if (!codigo) {
        res.skipped += 1;
        continue;
      }

      // Filtro por cidade (qualquer endereço do cliente ou da instalação).
      if (filters?.cidades?.length && !this.matchCity(cli, filters.cidades)) {
        res.filteredOut! += 1;
        continue;
      }

      // Filtro por status/grupo: restringe os serviços que viram contratos.
      const servicos = this.matchServicos(cli.servicos ?? [], filters);
      if (hasServiceFilter && servicos.length === 0) {
        res.filteredOut! += 1;
        continue;
      }

      try {
        const customerData = this.mapCliente(cli, codigo);
        // Ordena por id_cliente_servico (imutável) → o nº do contrato é estável:
        // 1º serviço = codigo do cliente; demais = codigo-1, codigo-2, ...
        const sorted = this.sortServicos(servicos);

        if (dryRun) {
          res.preview!.push({
            customer: customerData,
            contracts: sorted.map((s, index) => this.mapServicoPreview(s, codigo, index)),
          });
          continue;
        }

        const { id: customerId, created } = await this.upsertCustomer(tenantId, customerData);
        if (created) res.created += 1;
        else res.updated += 1;

        for (let index = 0; index < sorted.length; index++) {
          const svc = sorted[index];
          try {
            await this.upsertContract(tenantId, customerId, cli, svc, codigo, index);
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
      `[hubsoft-import] customers tenant=${tenantId} fetched=${res.fetched} filteredOut=${res.filteredOut} created=${res.created} updated=${res.updated} failed=${res.failed}${dryRun ? ' (dry-run)' : ''}`,
    );
    return res;
  }

  // ---------------------------------------------------------------------------
  // Filtros client-side (a API do Hubsoft não filtra cidade/status/grupo)
  // ---------------------------------------------------------------------------
  /** Serviços que satisfazem os filtros de status e grupo (AND). */
  private matchServicos(
    servicos: HubsoftServico[],
    filters?: HubsoftCustomerFilters,
  ): HubsoftServico[] {
    const hasStatus = !!filters?.status?.length;
    const hasGrupos = !!filters?.grupos?.length;
    if (!hasStatus && !hasGrupos) return servicos;
    return servicos.filter(
      (svc) =>
        (!hasStatus ||
          filters!.status!.includes(this.classifyServiceStatus(svc) as HubsoftServiceStatus)) &&
        (!hasGrupos || this.matchGroup(svc, filters!.grupos!)),
    );
  }

  /** Cliente casa se qualquer endereço (cadastral/cobrança/fiscal/instalação) for de uma das cidades. */
  private matchCity(cli: HubsoftCliente, cidades: string[]): boolean {
    const wanted = cidades.map((c) => this.cityKey(c)).filter(Boolean);
    const candidates: Array<HubsoftEndereco | string | undefined> = [
      cli.endereco_instalacao,
      cli.endereco_cadastral,
      cli.endereco_cobranca,
      cli.endereco_fiscal,
      ...(cli.servicos ?? []).map((s) => s.endereco_instalacao),
    ];
    for (const e of candidates) {
      if (!e || typeof e !== 'object' || !e.cidade) continue;
      const city = this.cityKey(this.str(e.cidade));
      if (!city) continue;
      // Tolerante: igualdade OU prefixo (cobre "Iretama/PR", "Iretama - PR").
      if (wanted.some((w) => city === w || city.startsWith(w) || w.startsWith(city))) {
        return true;
      }
    }
    return false;
  }

  /** Normaliza cidade e descarta sufixo de UF ("Iretama/PR", "Iretama - PR" → "iretama"). */
  private cityKey(s: string): string {
    return this.normalize(this.str(s).split(/[/\-–|]/)[0]);
  }

  /** status_prefixo (ou texto) → ativo | bloqueado | cancelado | outro. */
  private classifyServiceStatus(svc: HubsoftServico): HubsoftServiceStatus | 'outro' {
    const t = this.normalize(
      this.str(svc.status_prefixo) || this.str(svc.status ?? svc.status_txt),
    );
    if (/cancel|desativ/.test(t)) return 'cancelado';
    if (/bloque|suspens|desabilit/.test(t)) return 'bloqueado';
    if (/habilit|ativ/.test(t)) return 'ativo';
    return 'outro';
  }

  /** Grupo casa contra id_servico, nome/numero do plano e código/descrição dos pacotes. */
  private matchGroup(svc: HubsoftServico, grupos: string[]): boolean {
    const wanted = new Set(grupos.map((g) => this.normalize(g)));
    const cand: string[] = [
      this.str(svc.id_servico),
      this.str(svc.numero_plano),
      this.str(svc.nome),
      ...(svc.pacotes ?? []).flatMap((p) => [
        this.str(p.id_pacote),
        this.str(p.codigo),
        this.str(p.descricao),
      ]),
    ].filter(Boolean);
    return cand.some((c) => wanted.has(this.normalize(c)));
  }

  /** minúsculas + sem acento, para casar cidade/grupo de forma robusta. */
  private normalize(s: string): string {
    return s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
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

  private mapServicoPreview(svc: HubsoftServico, codigo: string, index: number) {
    return {
      code: this.contractCode(codigo, index),
      externalRef: `${HS_CONTRACT_PREFIX}${this.str(svc.id_cliente_servico)}`,
      planName: this.planName(svc) || null,
      pppoeUsername: this.str(svc.login) || null,
      monthlyValue: this.decimal(svc.valor),
      bandwidthMbps: this.bandwidth(this.planName(svc)),
      status: this.mapContractStatus(this.serviceStatusText(svc)),
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
    codigo: string,
    index: number,
  ): Promise<void> {
    const svcId = this.str(svc.id_cliente_servico);
    if (!svcId) return; // sem chave estável → não dá pra ser idempotente
    // Nº do contrato = código do cliente; do 2º serviço em diante, -1, -2, ...
    const code = this.contractCode(codigo, index);
    // Identidade estável do serviço no Hubsoft (idempotência + vínculo da fatura).
    const externalRef = `${HS_CONTRACT_PREFIX}${svcId}`;

    const planId = await this.upsertPlan(tenantId, svc);
    const login = this.str(svc.login) || null;
    const installationAddress =
      this.enderecoStr(svc.endereco_instalacao) ||
      this.enderecoStr(cli.endereco_instalacao) ||
      this.enderecoStr(cli.endereco_cadastral) ||
      'Endereço não informado (Hubsoft)';

    const data = {
      code,
      externalRef,
      authMethod: login ? ContractAuthMethod.PPPOE : ContractAuthMethod.IPOE,
      pppoeUsername: login,
      pppoePassword: this.str(svc.senha) || null,
      installationAddress: installationAddress.slice(0, 500),
      planId,
      monthlyValue: this.decimal(svc.valor),
      bandwidthMbps: this.bandwidth(this.planName(svc)),
      uploadMbps: this.bandwidth(this.planName(svc)),
      dueDay: DEFAULT_DUE_DAY,
      status: this.mapContractStatus(this.serviceStatusText(svc)),
      notes: `Importado do Hubsoft (serviço ${svcId}).`,
    };

    // Match pela identidade estável (externalRef), não pelo `code` — assim o nº do
    // contrato pode ser atualizado sem duplicar na re-sincronização.
    const existing = await this.prisma.contract.findFirst({
      where: { tenantId, externalRef },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.contract.update({ where: { id: existing.id }, data });
    } else {
      await this.prisma.contract.create({ data: { tenantId, customerId, ...data } });
    }
  }

  /** Nº do contrato: 1º serviço = código do cliente; demais = codigo-1, codigo-2... */
  private contractCode(codigo: string, index: number): string {
    return index === 0 ? codigo : `${codigo}-${index}`;
  }

  /** Ordena serviços por id_cliente_servico (imutável) — base p/ o nº estável. */
  private sortServicos(servicos: HubsoftServico[]): HubsoftServico[] {
    return [...servicos].sort((a, b) => {
      const na = Number(this.str(a.id_cliente_servico));
      const nb = Number(this.str(b.id_cliente_servico));
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return this.str(a.id_cliente_servico).localeCompare(this.str(b.id_cliente_servico));
    });
  }

  /** Casa/insere o plano pelo nome. Retorna planId ou null se sem nome. */
  private async upsertPlan(tenantId: string, svc: HubsoftServico): Promise<string | null> {
    const name = this.planName(svc);
    if (!name) return null;
    const mbps = this.bandwidth(name);
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
    opts: { limit?: number; codigos?: string[] } = {},
  ): Promise<HubsoftSyncEntityResult> {
    const { limit, codigos } = opts;
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
    // de quem realmente migrou. Se vier `codigos`, restringe a essa seleção.
    const customers = await this.prisma.customer.findMany({
      where: {
        tenantId,
        code: codigos?.length
          ? { in: codigos.map((c) => `${HS_CUSTOMER_PREFIX}${c}`) }
          : { startsWith: HS_CUSTOMER_PREFIX },
      },
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
      // Vínculo pela identidade estável do serviço (externalRef), não pelo nº do contrato.
      const c = await this.prisma.contract.findFirst({
        where: { tenantId, externalRef: `${HS_CONTRACT_PREFIX}${svcId}` },
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

    const issuedAt = this.dateOrNull(fat.data_emissao);
    const data = {
      amount: this.decimal(fat.valor),
      dueDate: this.dateOrNull(fat.data_vencimento) ?? new Date(),
      status: this.mapInvoiceStatus(this.str(fat.status ?? fat.status_fatura)),
      paidAt: this.dateOrNull(fat.data_pagamento),
      paidAmount: fat.valor_pago != null ? this.decimal(fat.valor_pago) : null,
      reference,
      // Data de emissão real (histórico) — senão usa o default now() na criação.
      ...(issuedAt ? { issuedAt } : {}),
      // Boleto/Pix já gerados no Hubsoft → reimpressão no NetX (sem nova cobrança).
      extSource: 'hubsoft',
      extBoletoUrl: this.str(fat.link) || null,
      extDigitableLine: this.str(fat.linha_digitavel) || null,
      extBarcode: this.str(fat.codigo_barras) || null,
      extPixCode: this.str(fat.pix_copia_cola) || null,
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

  /**
   * Nome do plano, robusto à variação de shape entre rotas: em /cliente/all o
   * nome vem em `nome` (e `numero_plano` é numérico); em /cliente pode vir em
   * `numero_plano`. Preferimos `nome`, com fallback para `numero_plano`.
   */
  private planName(svc: HubsoftServico): string {
    return this.str(svc.nome) || this.str(svc.numero_plano);
  }

  /** Texto de status do serviço, preferindo o código estável `status_prefixo`. */
  private serviceStatusText(svc: HubsoftServico): string {
    return this.str(svc.status_prefixo) || this.str(svc.status ?? svc.status_txt);
  }

  /**
   * Parse de DATA (dia) ancorado ao MEIO-DIA UTC. Datas só-data (@db.Date)
   * salvas como UTC-meia-noite recuam 1 dia em fuso a oeste de UTC (ex.: BRT-3:
   * 15/07 vira 14/07). Ancorar em 12:00Z mantém o dia correto em qualquer fuso.
   * Aceita "YYYY-MM-DD[ HH:MM:SS]" e "DD/MM/YYYY".
   */
  private dateOrNull(v: unknown): Date | null {
    const s = this.str(v);
    if (!s) return null;
    let y: number, mo: number, d: number;
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      y = +iso[1];
      mo = +iso[2];
      d = +iso[3];
    } else {
      const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (!br) return null;
      d = +br[1];
      mo = +br[2];
      y = +br[3];
    }
    const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
    return isNaN(dt.getTime()) ? null : dt;
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

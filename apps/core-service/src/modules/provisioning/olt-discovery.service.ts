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
import { HubsoftImportService } from '../hubsoft/hubsoft-import.service';
import type { HubsoftResolvedConfig } from '../hubsoft/hubsoft.types';
import { RadiusSyncService } from '../contracts/radius-sync.service';
import { PrismaService } from '../prisma/prisma.service';

import { buildConnectionContext } from './olt-context.util';
import { OltDriverFactory } from './drivers/olt-driver.factory';
import type { DiscoveredOntRaw } from './drivers/olt-driver.interface';
import { ontSerialKeys } from './ont-serial.util';
import { provisioningPathsFor, vendorFor } from './tr069-paths.registry';

const HS_CONTRACT_PREFIX = 'HS-SVC-';

/** Referência a um serviço do Hubsoft no índice de reconciliação. */
interface HubRef {
  codigo: string;
  servicoId: string;
  status: string;
  cancelled: boolean;
  rawSerial: string;
  source: 'SERVICO' | 'CPE';
}

/** Um sinal de dono coletado de uma fonte, para uma ONT. */
interface OntSignal {
  source: 'OLT' | 'SERVICO' | 'COMODATO' | 'CPE' | 'PPPOE';
  codigo: string;
  servicoId: string;
  status?: string;
  cancelled: boolean;
  rawSerial?: string;
}

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
    private readonly hubsoftImport: HubsoftImportService,
    private readonly radiusSync: RadiusSyncService,
  ) {}

  // ===========================================================================
  // Camada 1 — SCAN: OLT → discovered_onts
  // ===========================================================================
  async scan(
    tenantId: string,
    oltId: string,
    opts: { collectMac?: boolean; scope?: { slot: number; pon: number } } = {},
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
      collectMac: opts.collectMac ?? false,
      scope: opts.scope,
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
  // Camada 2 — MATCH: discovered_onts → cliente no Hubsoft, por SERIAL.
  // ===========================================================================
  // A chave é a SERIAL da ONU (phy_id). O Hubsoft expõe a serial no serviço
  // (campo `phy_addr`), mas NÃO permite busca reversa por serial — então
  // importamos a base (/cliente/todos, paginada) UMA vez, montamos um índice
  // serial→{cliente,serviço} em memória e cruzamos com as ONUs descobertas.
  // 1 varredura da OLT + 1 leitura do ERP, cruzadas localmente (não N buscas).
  async matchAgainstHubsoft(
    tenantId: string,
    opts: { limit?: number } = {},
  ): Promise<OltMatchResult> {
    const cfg = await this.hubsoftConfig.resolve(tenantId);

    // ── 1) Índice de sinais do SERVIÇO (a fonte principal) ────────────────────
    // Cada CHAVE (toda forma de serial — amigável+hex — e cada MAC) aponta para
    // o(s) serviço(s) do Hubsoft, com o status (para detectar cancelado). Uma
    // leitura da base cobre a fonte SERVICO. Comodato/CPE são consultados sob
    // demanda só para as ONTs que o serviço não resolver (custo controlado).
    const index = new Map<string, HubRef[]>();
    const addKey = (key: string, ref: HubRef) => {
      if (!key) return;
      const arr = index.get(key) ?? [];
      if (!arr.some((r) => r.servicoId === ref.servicoId)) arr.push(ref);
      index.set(key, arr);
    };

    const PAGE = 500;
    // Inclui ATIVOS e CANCELADOS: uma ONU de cliente cancelado ainda pode estar
    // fisicamente na OLT (equipamento a recolher) — queremos identificá-la.
    for (const cancelado of ['nao', 'sim'] as const) {
      let pagina = 1;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const clientes = await this.hubsoftClient.getClientesAll(cfg, {
          limit: PAGE,
          offset: (pagina - 1) * PAGE,
          cancelado,
        });
        if (clientes.length === 0) break;
        for (const cli of clientes) {
          const codigo = this.str(cli.codigo_cliente ?? cli.id_cliente);
          for (const svc of cli.servicos ?? []) {
            const servicoId = this.str(svc.id_cliente_servico);
            if (!servicoId) continue;
            const status = this.str(svc.status_prefixo || svc.status);
            const ref: HubRef = {
              codigo,
              servicoId,
              status,
              // "cancelado" é do STATUS do serviço, NÃO da página de varredura: a
              // lista cancelado=sim traz clientes com ALGUM serviço cancelado, mas
              // o serviço específico desta ONT pode estar habilitado. A verdade é
              // o status_prefixo (servico_cancelado/desativado).
              cancelled: this.isCancelledStatus(status),
              rawSerial: this.str(svc.phy_addr),
              source: 'SERVICO',
            };
            for (const k of ontSerialKeys(this.str(svc.phy_addr))) addKey(k, ref);
            const mac = this.macCanonical(svc.mac_addr);
            if (mac) addKey('MAC:' + mac, ref);
          }
        }
        if (clientes.length < PAGE) break;
        pagina += 1;
      }
    }
    const svcKeys = index.size;

    // ── 1b) Índice do CPE (/rede/cpe/todos) — PREENCHE OS BURACOS do serviço ────
    // O /cliente/todos do Hubsoft OMITE clientes (retorna menos do que
    // total_registros; ex.: cliente 340 com serviço habilitado não aparece). O
    // CPE gerenciado pelo ACS traz phy_addr(serial) + servicos[] com o dono, e
    // cobre esses omitidos. Marcamos a fonte com um flag no ref (fromCpe) para
    // a nota da reconciliação.
    let cpePag = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const cpes = await this.hubsoftClient.getCpesTodos(cfg, { pagina: cpePag, itensPorPagina: 500 });
      if (cpes.length === 0) break;
      for (const cpe of cpes) {
        const serial = this.str(cpe.phy_addr);
        if (!serial) continue;
        for (const s of cpe.servicos ?? []) {
          const servicoId = this.str(s.id_cliente_servico);
          if (!servicoId) continue;
          // código do cliente: vem em id_cliente OU no rótulo "(340) NOME - (INATIVO)".
          const codigo = this.codigoFromCpeServico(s);
          const status = this.str(s.status);
          // "(INATIVO)" no rótulo = cliente inativo (contrato vencido) — não é
          // cancelamento do serviço, mas sinaliza atenção. cancelled só se o
          // status do serviço disser cancelado.
          const ref: HubRef = {
            codigo,
            servicoId,
            status,
            cancelled: this.isCancelledStatus(status),
            rawSerial: serial,
            source: 'CPE',
          };
          for (const k of ontSerialKeys(serial)) addKey(k, ref);
        }
      }
      if (cpes.length < 500) break;
      cpePag += 1;
    }
    this.logger.log(`[olt-reconcile] índice: ${svcKeys} chaves do serviço + CPE → ${index.size} total`);

    // ── 2) Reconcilia cada ONT descoberta pendente ────────────────────────────
    const pend = await this.prisma.discoveredOnt.findMany({
      where: {
        tenantId,
        matchState: {
          in: [DiscoveredOntMatchState.DISCOVERED, DiscoveredOntMatchState.UNMATCHED],
        },
      },
      take: opts.limit ?? 5000,
      orderBy: [{ slot: 'asc' }, { pon: 'asc' }, { onuIndex: 'asc' }],
    });

    const res: OltMatchResult = { scanned: 0, matched: 0, unmatched: 0, ambiguous: 0, errors: 0 };
    for (const ont of pend) {
      res.scanned += 1;
      try {
        await this.reconcileOne(tenantId, cfg, ont, index, res);
      } catch (e) {
        res.errors += 1;
        this.logger.warn(`[olt-reconcile] ${ont.serial}: ${(e as Error).message}`);
      }
    }
    this.logger.log(
      `[olt-reconcile] tenant=${tenantId} scanned=${res.scanned} matched=${res.matched} unmatched=${res.unmatched} conflito/cancelado=${res.ambiguous} errors=${res.errors}`,
    );
    return res;
  }

  /**
   * Reconcilia UMA ONT: coleta sinais das fontes (serviço via índice; comodato
   * sob demanda se o serviço não resolveu), grava os sinais e decide o dono por
   * PRIORIDADE (SERVICO > COMODATO > CPE). Estado final:
   *   - 0 sinais            → UNMATCHED
   *   - sinais concordam    → MATCHED
   *   - sinais divergem     → CONFLICT (dono = maior prioridade, nota do conflito)
   *   - dono é cancelado    → CANCELLED_OWNER (não materializa/autoriza)
   */
  private async reconcileOne(
    tenantId: string,
    cfg: HubsoftResolvedConfig,
    ont: { id: string; serial: string; macAddress: string | null },
    index: Map<string, HubRef[]>,
    res: OltMatchResult,
  ): Promise<void> {
    const signals: OntSignal[] = [];

    // Fontes SERVICO e CPE (do índice): por qualquer forma do serial ou pelo MAC.
    // Um serviço pode ter vindo de ambas — mantém a de maior confiança (SERVICO).
    const refs = new Map<string, HubRef>();
    const merge = (r: HubRef) => {
      const cur = refs.get(r.servicoId);
      if (!cur || (cur.source === 'CPE' && r.source === 'SERVICO')) refs.set(r.servicoId, r);
    };
    for (const k of ontSerialKeys(ont.serial)) for (const r of index.get(k) ?? []) merge(r);
    const ontMac = this.macCanonical(ont.macAddress);
    if (ontMac) for (const r of index.get('MAC:' + ontMac) ?? []) merge(r);
    for (const r of refs.values()) {
      signals.push({ source: r.source, codigo: r.codigo, servicoId: r.servicoId, status: r.status, cancelled: r.cancelled, rawSerial: r.rawSerial });
    }

    // Fonte PATRIMÔNIO/COMODATO — só se as fontes em massa NÃO resolveram (evita
    // N chamadas). Consulta o estoque pelo SERIAL (produto_item/consultar): o
    // patrimônio indexa pela serial GPON REAL e diz em qual cliente_servico está
    // alocado — resolve os casos em que o Hubsoft guardou o MAC no phy_addr do
    // serviço (ex.: clientes 5145, 6097). Tenta as formas canônicas do serial
    // (amigável + hex Huawei 48575443...).
    if (signals.length === 0) {
      const pat = await this.findOwnerByPatrimonio(cfg, ont.serial).catch(() => null);
      if (pat) {
        signals.push({ source: 'COMODATO', codigo: pat.codigo, servicoId: pat.servicoId, status: pat.status, cancelled: pat.cancelled, rawSerial: pat.rawSerial });
      }
    }

    // Persiste os sinais (idempotente por ONT+fonte+serviço).
    await this.persistSignals(tenantId, ont.id, signals);

    // Decide o dono por prioridade e o estado.
    const decision = this.decideOwner(signals);
    const stateMap = {
      UNMATCHED: DiscoveredOntMatchState.UNMATCHED,
      MATCHED: DiscoveredOntMatchState.MATCHED,
      CONFLICT: DiscoveredOntMatchState.CONFLICT,
      CANCELLED_OWNER: DiscoveredOntMatchState.CANCELLED_OWNER,
    } as const;

    await this.setMatch(ont.id, stateMap[decision.state], {
      erpSource: decision.owner ? 'hubsoft' : null,
      erpCustomerCode: decision.owner?.codigo ?? null,
      erpServiceId: decision.owner?.servicoId ?? null,
      matchNote: decision.note,
    });

    if (decision.state === 'MATCHED') res.matched += 1;
    else if (decision.state === 'UNMATCHED') res.unmatched += 1;
    else res.ambiguous += 1; // reaproveita o contador p/ CONFLICT + CANCELLED_OWNER
  }

  /** Prioridade das fontes na disputa pelo dono. Maior = mais confiável.
   *  PPPOE (capturado do Inform TR-069) é a verdade física — vence todas. */
  private readonly SOURCE_PRIORITY: Record<OntSignal['source'], number> = {
    PPPOE: 4,
    SERVICO: 3,
    COMODATO: 2,
    CPE: 1,
    OLT: 0,
  };

  /** Decide o dono a partir dos sinais coletados (prioridade por fonte). */
  private decideOwner(signals: OntSignal[]): {
    state: 'UNMATCHED' | 'MATCHED' | 'CONFLICT' | 'CANCELLED_OWNER';
    owner: { codigo: string; servicoId: string } | null;
    note: string;
  } {
    if (signals.length === 0) {
      return { state: 'UNMATCHED', owner: null, note: 'Nenhuma fonte (serviço/comodato/CPE) aponta dono.' };
    }
    // Ordena por prioridade da fonte (desc); o topo é o dono escolhido.
    const sorted = [...signals].sort((a, b) => this.SOURCE_PRIORITY[b.source] - this.SOURCE_PRIORITY[a.source]);
    const winner = sorted[0];
    const owner = { codigo: winner.codigo, servicoId: winner.servicoId };
    const clientes = new Set(signals.map((s) => s.codigo));
    const desc = signals.map((s) => `${s.source}→cliente ${s.codigo}${s.cancelled ? '(cancelado)' : ''}`).join('; ');

    if (winner.cancelled) {
      return { state: 'CANCELLED_OWNER', owner, note: `Dono cancelado (${winner.source}). Sinais: ${desc}` };
    }
    if (clientes.size > 1) {
      return { state: 'CONFLICT', owner, note: `Fontes divergem — escolhido por prioridade ${winner.source} (cliente ${winner.codigo}). Sinais: ${desc}` };
    }
    return { state: 'MATCHED', owner, note: `Dono confirmado por ${signals.length} fonte(s): ${desc}` };
  }

  /** Grava os sinais coletados (idempotente por ONT+fonte+serviço). */
  private async persistSignals(tenantId: string, discoveredOntId: string, signals: OntSignal[]): Promise<void> {
    for (const s of signals) {
      await this.prisma.discoveredOntSignal.upsert({
        where: {
          discoveredOntId_source_erpServiceId: {
            discoveredOntId,
            source: s.source,
            erpServiceId: s.servicoId,
          },
        },
        create: {
          tenantId,
          discoveredOntId,
          source: s.source,
          rawSerial: s.rawSerial ?? null,
          erpCustomerCode: s.codigo,
          erpServiceId: s.servicoId,
          ownerStatus: s.status ?? null,
          cancelled: s.cancelled,
        },
        update: { ownerStatus: s.status ?? null, cancelled: s.cancelled, rawSerial: s.rawSerial ?? null },
      });
    }
  }

  // ===========================================================================
  // PPPoE do Inform TR-069 — a FONTE DE VERDADE (o equipamento diz quem autentica)
  // ===========================================================================
  /**
   * Processa as respostas de GET_PARAMS (purpose=pppoe-discovery) já concluídas:
   * extrai o PPPoE username capturado da ONT, casa com o `login` do serviço no
   * Hubsoft e grava um sinal PPPOE (prioridade máxima) no discovered_ont — depois
   * re-decide o dono. Se o PPPoE aponta um serviço diferente do que serviço/
   * comodato diziam, o PPPoE vence (é físico). Idempotente: marca a task como
   * processada via result.pppoeConsumed.
   */
  async reconcilePppoe(
    tenantId: string,
    opts: { limit?: number } = {},
  ): Promise<{ enqueued: number; processed: number; captured: number; matched: number; noLogin: number; skipped: number }> {
    const cfg = await this.hubsoftConfig.resolve(tenantId);

    // 0) Garante que todo device adotado com snapshot tenha um GetParams de PPPoE
    //    (deriva o path do snapshot). Cobre devices adotados antes desta lógica.
    let enqueued = 0;
    const adopted = await this.prisma.tr069Device.findMany({
      where: { tenantId, ontId: { not: null } },
      select: { id: true, deviceId: true, manufacturer: true, parametersSnapshot: true, tasks: { where: { action: 'GET_PARAMS', status: 'DONE' }, select: { id: true }, take: 1 } },
      take: 2000,
    });
    for (const d of adopted) {
      if (d.tasks.length > 0) continue; // já tem GetParams concluído
      const paths = this.pppoeUsernamePathsFromSnapshot(d.parametersSnapshot);
      if (paths.length === 0) continue;
      // evita duplicar tarefa PENDING de pppoe-discovery
      const pending = await this.prisma.tr069Task.count({ where: { deviceId: d.id, action: 'GET_PARAMS', status: 'PENDING' } });
      if (pending > 0) continue;
      await this.prisma.tr069Task.create({
        data: { tenantId, deviceId: d.id, action: 'GET_PARAMS', status: 'PENDING', payload: { names: paths, purpose: 'pppoe-discovery' } as object },
      });
      enqueued += 1;
    }

    // Tasks de PPPoE-discovery concluídas com resultado, ainda não consumidas.
    const tasks = await this.prisma.tr069Task.findMany({
      where: {
        tenantId,
        action: 'GET_PARAMS',
        status: 'DONE',
      },
      take: opts.limit ?? 500,
      orderBy: { completedAt: 'desc' },
      include: { device: { select: { ont: { select: { snGpon: true } } } } },
    });

    const res = { enqueued, processed: 0, captured: 0, matched: 0, noLogin: 0, skipped: 0 };
    // Filtra só as de PPPoE-discovery com Username no resultado.
    const withPppoe: Array<{ taskId: string; serial: string; login: string; result: unknown }> = [];
    for (const t of tasks) {
      const payload = t.payload as { purpose?: string } | null;
      if (payload?.purpose !== 'pppoe-discovery') continue;
      const serial = t.device?.ont?.snGpon;
      if (!serial) continue;
      const login = this.extractPppoeUsername(t.result);
      res.processed += 1;
      if (!login) {
        res.noLogin += 1;
        continue;
      }
      res.captured += 1;
      withPppoe.push({ taskId: t.id, serial, login, result: t.result });
    }
    if (withPppoe.length === 0) return res;

    // Índice login(normalizado) → serviço do Hubsoft (ativos + cancelados).
    const loginIndex = await this.buildLoginIndex(cfg);

    for (const item of withPppoe) {
      const key = this.normLogin(item.login);
      const ref = loginIndex.get(key);
      const disc = await this.prisma.discoveredOnt.findFirst({
        where: { tenantId, serial: item.serial },
        select: { id: true },
      });
      if (!disc) {
        res.skipped += 1;
        continue;
      }
      if (!ref) {
        // PPPoE capturado mas sem serviço correspondente — registra na nota, não força.
        await this.prisma.discoveredOnt.update({
          where: { id: disc.id },
          data: { matchNote: `PPPoE do Inform="${item.login}" sem serviço Hubsoft correspondente` },
        });
        continue;
      }
      // Grava o sinal PPPOE (prioridade máxima) e re-decide.
      await this.prisma.discoveredOntSignal.upsert({
        where: {
          discoveredOntId_source_erpServiceId: {
            discoveredOntId: disc.id,
            source: 'PPPOE',
            erpServiceId: ref.servicoId,
          },
        },
        create: {
          tenantId,
          discoveredOntId: disc.id,
          source: 'PPPOE',
          rawSerial: item.serial,
          erpCustomerCode: ref.codigo,
          erpServiceId: ref.servicoId,
          ownerStatus: ref.status,
          cancelled: ref.cancelled,
          detail: `PPPoE do Inform: ${item.login}`,
        },
        update: { ownerStatus: ref.status, cancelled: ref.cancelled, detail: `PPPoE do Inform: ${item.login}` },
      });
      await this.redecideFromSignals(tenantId, disc.id);
      res.matched += 1;
    }
    this.logger.log(`[pppoe-reconcile] tenant=${tenantId} processed=${res.processed} captured=${res.captured} matched=${res.matched} noLogin=${res.noLogin}`);
    return res;
  }

  /** Extrai um PPPoE username de um resultado de GET_PARAMS (result.params). */
  private extractPppoeUsername(result: unknown): string | null {
    const r = result as { params?: Record<string, string> } | null;
    const params = r?.params;
    if (!params) return null;
    for (const [name, value] of Object.entries(params)) {
      // qualquer path que termine em WANPPPConnection.*.Username com valor não-vazio
      if (/WANPPPConnection\.\d+\.Username$/i.test(name) || /PPP\..*Username$/i.test(name)) {
        const v = this.str(value);
        if (v) return v;
      }
    }
    return null;
  }

  /** Índice login(normalizado) → serviço do Hubsoft (ativos + cancelados). */
  private async buildLoginIndex(
    cfg: HubsoftResolvedConfig,
  ): Promise<Map<string, { codigo: string; servicoId: string; status: string; cancelled: boolean }>> {
    const index = new Map<string, { codigo: string; servicoId: string; status: string; cancelled: boolean }>();
    const PAGE = 500;
    for (const cancelado of ['nao', 'sim'] as const) {
      let pagina = 1;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const clientes = await this.hubsoftClient.getClientesAll(cfg, { limit: PAGE, offset: (pagina - 1) * PAGE, cancelado });
        if (clientes.length === 0) break;
        for (const cli of clientes) {
          const codigo = this.str(cli.codigo_cliente ?? cli.id_cliente);
          for (const svc of cli.servicos ?? []) {
            const login = this.normLogin(svc.login);
            const servicoId = this.str(svc.id_cliente_servico);
            if (!login || !servicoId) continue;
            const status = this.str(svc.status_prefixo || svc.status);
            index.set(login, { codigo, servicoId, status, cancelled: this.isCancelledStatus(status) });
          }
        }
        if (clientes.length < PAGE) break;
        pagina += 1;
      }
    }
    return index;
  }

  private normLogin(v: unknown): string {
    return this.str(v).toLowerCase();
  }

  /**
   * Um serviço está cancelado SÓ pelo seu status_prefixo (servico_cancelado/
   * desativado) — NÃO por ter vindo da varredura cancelado=sim (essa lista traz
   * clientes com ALGUM serviço cancelado; o serviço específico pode estar
   * habilitado). `servico_habilitado`/`servico_bloqueado`/`suspenso` NÃO são
   * cancelado. Isso corrige falsos CANCELLED_OWNER (ex. clientes 748, 773).
   */
  private isCancelledStatus(status: string): boolean {
    const t = this.str(status).toLowerCase();
    // servico_cancelado / servico_desabilitado_definitivo → cancelado.
    // servico_habilitado / servico_bloqueado / suspenso → NÃO.
    return /cancel|desabilitado_defin|desativad/.test(t);
  }

  /** Código do cliente a partir de um serviço de CPE (id_cliente direto ou do
   *  rótulo "(340) NOME - (INATIVO)"). Prefere o código entre parênteses. */
  private codigoFromCpeServico(s: { id_cliente?: number | string; cliente?: string }): string {
    const m = this.str(s.cliente).match(/\((\d+)\)/);
    if (m) return m[1];
    return this.str(s.id_cliente);
  }

  /** Recarrega os sinais de uma ONT do banco e re-decide o estado/dono. */
  private async redecideFromSignals(tenantId: string, discoveredOntId: string): Promise<void> {
    const rows = await this.prisma.discoveredOntSignal.findMany({ where: { tenantId, discoveredOntId } });
    const signals: OntSignal[] = rows.map((r) => ({
      source: r.source as OntSignal['source'],
      codigo: this.str(r.erpCustomerCode),
      servicoId: this.str(r.erpServiceId),
      status: r.ownerStatus ?? undefined,
      cancelled: r.cancelled,
    }));
    const decision = this.decideOwner(signals);
    const stateMap = {
      UNMATCHED: DiscoveredOntMatchState.UNMATCHED,
      MATCHED: DiscoveredOntMatchState.MATCHED,
      CONFLICT: DiscoveredOntMatchState.CONFLICT,
      CANCELLED_OWNER: DiscoveredOntMatchState.CANCELLED_OWNER,
    } as const;
    // Não rebaixa uma ONT já MATERIALIZED (o dono virou contrato).
    const cur = await this.prisma.discoveredOnt.findUnique({ where: { id: discoveredOntId }, select: { matchState: true } });
    if (cur?.matchState === DiscoveredOntMatchState.MATERIALIZED) return;
    await this.setMatch(discoveredOntId, stateMap[decision.state], {
      erpSource: decision.owner ? 'hubsoft' : null,
      erpCustomerCode: decision.owner?.codigo ?? null,
      erpServiceId: decision.owner?.servicoId ?? null,
      matchNote: decision.note,
    });
  }

  /**
   * Busca o dono de uma ONT consultando o PATRIMÔNIO por SERIAL
   * (produto_item/consultar?busca=numero_serie). Resolve os casos em que o
   * serviço guardou o MAC no phy_addr — o estoque indexa pela serial GPON real e
   * aponta o cliente_servico alocado. Tenta as formas canônicas (amigável + hex).
   */
  private async findOwnerByPatrimonio(
    cfg: HubsoftResolvedConfig,
    serial: string,
  ): Promise<{ codigo: string; servicoId: string; status: string; cancelled: boolean; rawSerial: string } | null> {
    // Tenta cada forma do serial (a Huawei pode estar em hex 48575443... no estoque).
    for (const form of ontSerialKeys(serial)) {
      const itens = await this.hubsoftClient.getPatrimonioBySerial(cfg, form).catch(() => []);
      for (const it of itens) {
        const cs = it.cliente_servico;
        const servicoId = cs ? this.str(cs.id_cliente_servico) : '';
        const codigo = cs?.cliente ? this.str(cs.cliente.codigo_cliente ?? cs.cliente.id_cliente) : '';
        if (!servicoId || !codigo) continue; // item em estoque, não alocado a cliente
        const status = this.str(it.produto_item_status?.prefixo ?? it.produto_item_status?.descricao);
        return {
          codigo,
          servicoId,
          status,
          // "comodato"/"instalado" NÃO é cancelamento; só marca cancelled se o
          // status do item disser cancelado/baixado.
          cancelled: this.isCancelledStatus(status),
          rawSerial: this.str(it.numero_serie) || form,
        };
      }
    }
    return null;
  }

  // ===========================================================================
  // Camada 3 — MATERIALIZE: MATCHED → Customer + Contract + Ont (+ RADIUS)
  // ===========================================================================
  // Para cada ONU MATCHED: (1) importa o cliente do Hubsoft por código (reusa
  // o HubsoftImportService — cria Customer+Contract com PPPoE/velocidade/valor
  // reais); (2) acha o Contract do serviço casado (externalRef HS-SVC-<id>);
  // (3) cria/atualiza o Ont ligando a ONU física ao contrato; (4) enfileira o
  // RADIUS conforme o STATUS do contrato (AUTHORIZE só se ativo — bloqueado/
  // cancelado enfileiram BLOCK/CANCEL, nunca sobem autorizados por engano);
  // (5) marca o DiscoveredOnt como MATERIALIZED.
  async materialize(
    tenantId: string,
    actorUserId: string,
    opts: { ids?: string[]; enqueueRadius?: boolean; limit?: number } = {},
  ): Promise<{
    processed: number;
    materialized: number;
    radiusEnqueued: number;
    skipped: number;
    failed: number;
    errors: Array<{ serial: string; message: string }>;
  }> {
    const enqueueRadius = opts.enqueueRadius ?? true;
    // cfg do Hubsoft resolvido uma vez (para buscar comodato por serviço).
    const cfg = await this.hubsoftConfig.resolve(tenantId);
    const rows = await this.prisma.discoveredOnt.findMany({
      where: {
        tenantId,
        matchState: DiscoveredOntMatchState.MATCHED,
        ...(opts.ids?.length ? { id: { in: opts.ids } } : {}),
      },
      take: opts.limit ?? 1000,
      orderBy: [{ slot: 'asc' }, { pon: 'asc' }, { onuIndex: 'asc' }],
    });

    const res = { processed: 0, materialized: 0, radiusEnqueued: 0, skipped: 0, failed: 0, errors: [] as Array<{ serial: string; message: string }> };

    for (const ont of rows) {
      res.processed += 1;
      const codigo = this.str(ont.erpCustomerCode);
      const svcId = this.str(ont.erpServiceId);
      if (!codigo || !svcId) {
        res.skipped += 1;
        res.errors.push({ serial: ont.serial, message: 'MATCHED sem erpCustomerCode/erpServiceId' });
        continue;
      }
      try {
        // 1) Importa o cliente casado do Hubsoft (Customer+Contract com endereço/
        //    coordenadas via relacoes) E o financeiro (faturas/boleto/Pix). O
        //    cron do Hubsoft (4x/dia) mantém a sincronia das faturas depois.
        await this.hubsoftImport.run(tenantId, actorUserId, {
          codigos: [codigo],
          entities: ['customers', 'financeiro'],
          dryRun: false,
        });

        // 2) Acha o Contract do serviço exato (identidade estável do Hubsoft).
        const contract = await this.prisma.contract.findFirst({
          where: { tenantId, externalRef: `${HS_CONTRACT_PREFIX}${svcId}` },
          select: {
            id: true, tenantId: true, authMethod: true, pppoeUsername: true,
            circuitId: true, macAddress: true, status: true,
          },
        });
        if (!contract) {
          res.failed += 1;
          res.errors.push({ serial: ont.serial, message: `Contract HS-SVC-${svcId} não encontrado após import` });
          continue;
        }

        // 3) Cria/atualiza o Ont (vínculo físico↔contrato). Idempotente por
        //    contractId (unique) e por olt+serial.
        await this.upsertOnt(tenantId, ont.oltId, contract.id, ont);

        // 3b) COMODATO — busca o equipamento em comodato do serviço no Hubsoft e
        //     enriquece o Ont (modelo + MAC + flag comodato). É a MESMA ONU que
        //     descobrimos na OLT (o serial do comodato bate com o phy_id), então
        //     não duplicamos — confirmamos e completamos o registro. Best-effort:
        //     falha aqui não derruba a materialização.
        try {
          const comodato = await this.resolveComodato(cfg, svcId, ont.serial);
          if (comodato) await this.enrichOntWithComodato(tenantId, contract.id, comodato);
        } catch (e) {
          this.logger.warn(`[olt-materialize] comodato ${ont.serial}: ${(e as Error).message}`);
        }

        // 3c) ADOÇÃO TR-069 — se alguma ONT já informou (Tr069PendingDevice) com
        //     este serial (forma canônica), adota: vincula o Tr069Device ao Ont
        //     recém-criado e dispara GetParams do PPPoE (fonte de verdade do dono).
        //     Best-effort.
        try {
          await this.adoptPendingTr069(tenantId, contract.id, ont.serial);
        } catch (e) {
          this.logger.warn(`[olt-materialize] adoção TR-069 ${ont.serial}: ${(e as Error).message}`);
        }

        // 4) RADIUS conforme status (AUTHORIZE só se ACTIVE — enqueueSync deriva
        //    a ação do status; suspenso/cancelado nunca sobe autorizado).
        if (enqueueRadius && contract.pppoeUsername) {
          await this.radiusSync.enqueueSync(contract, 'Materializado da descoberta de ONU');
          res.radiusEnqueued += 1;
        }

        // 5) Marca MATERIALIZED.
        await this.prisma.discoveredOnt.update({
          where: { id: ont.id },
          data: {
            matchState: DiscoveredOntMatchState.MATERIALIZED,
            contractId: contract.id,
            matchNote: `Materializado: contrato ${contract.id}`,
          },
        });
        res.materialized += 1;
      } catch (e) {
        res.failed += 1;
        res.errors.push({ serial: ont.serial, message: e instanceof Error ? e.message : String(e) });
        this.logger.warn(`[olt-materialize] ONU ${ont.serial} falhou: ${(e as Error).message}`);
      }
    }

    this.logger.log(
      `[olt-materialize] tenant=${tenantId} processed=${res.processed} materialized=${res.materialized} radius=${res.radiusEnqueued} skipped=${res.skipped} failed=${res.failed}`,
    );
    return res;
  }

  /**
   * Aplica (ou re-aplica) o comodato do Hubsoft aos Onts já MATERIALIZED — útil
   * para contratos materializados ANTES do import de comodato existir. Percorre
   * os discovered_onts MATERIALIZED, busca o comodato do serviço e enriquece o
   * Ont. Idempotente.
   */
  async applyComodatoToMaterialized(
    tenantId: string,
    opts: { limit?: number } = {},
  ): Promise<{ processed: number; enriched: number; noComodato: number; failed: number }> {
    const cfg = await this.hubsoftConfig.resolve(tenantId);
    const rows = await this.prisma.discoveredOnt.findMany({
      where: { tenantId, matchState: DiscoveredOntMatchState.MATERIALIZED, contractId: { not: null }, erpServiceId: { not: null } },
      take: opts.limit ?? 2000,
    });
    const res = { processed: 0, enriched: 0, noComodato: 0, failed: 0 };
    for (const ont of rows) {
      res.processed += 1;
      try {
        const comodato = await this.resolveComodato(cfg, this.str(ont.erpServiceId), ont.serial);
        if (!comodato) { res.noComodato += 1; continue; }
        await this.enrichOntWithComodato(tenantId, ont.contractId!, comodato);
        res.enriched += 1;
      } catch (e) {
        res.failed += 1;
        this.logger.warn(`[comodato-backfill] ${ont.serial}: ${(e as Error).message}`);
      }
    }
    this.logger.log(`[comodato-backfill] tenant=${tenantId} processed=${res.processed} enriched=${res.enriched} noComodato=${res.noComodato} failed=${res.failed}`);
    return res;
  }

  /**
   * Adoção de TR-069: procura na caixa de Informs órfãos (Tr069PendingDevice) um
   * device cujo serial (forma canônica, amigável↔hex) case com o Ont recém-criado
   * e o ADOTA — cria o Tr069Device vinculado ao Ont e remove o pending. Em
   * seguida enfileira um GetParams do PPPoE username (a fonte de verdade do dono:
   * o próprio equipamento diz qual login autentica). Idempotente.
   */
  private async adoptPendingTr069(tenantId: string, contractId: string, ontSerial: string): Promise<void> {
    const ont = await this.prisma.ont.findFirst({ where: { tenantId, contractId }, select: { id: true, snGpon: true, tr069Device: { select: { id: true } } } });
    if (!ont || ont.tr069Device) return; // já tem device ou sem ont

    const wanted = new Set(ontSerialKeys(ont.snGpon));
    // Pré-filtra por sufixo (igual nos dois formatos) e casa por forma canônica.
    const suffix = this.serialSuffixHex(ont.snGpon);
    const pendings = await this.prisma.tr069PendingDevice.findMany({
      where: suffix ? { serialNumber: { endsWith: suffix, mode: 'insensitive' } } : { serialNumber: { equals: ontSerial, mode: 'insensitive' } },
      take: 10,
    });
    const pend = pendings.find((p) => p.serialNumber && ontSerialKeys(p.serialNumber).some((k) => wanted.has(k)));
    if (!pend) return;

    // Cria o Tr069Device ligado ao Ont (tira da caixa de pending).
    const device = await this.prisma.tr069Device.create({
      data: {
        tenantId,
        ontId: ont.id,
        deviceId: pend.deviceId,
        manufacturer: pend.manufacturer,
        oui: pend.oui,
        productClass: pend.productClass,
        connectionRequestUrl: pend.connectionRequestUrl,
        parametersSnapshot: (pend.parametersSnapshot ?? undefined) as object | undefined,
        status: 'ONLINE',
        lastInformAt: pend.lastSeenAt,
      },
    });
    await this.prisma.tr069PendingDevice.delete({ where: { id: pend.id } }).catch(() => undefined);
    this.logger.log(`[tr069-adopt] ONT ${ont.snGpon} adotou device pendente ${pend.deviceId}`);

    // Enfileira GetParams do PPPoE username — deriva o path do próprio snapshot
    // que a ONT já mandou (à prova de vendor).
    await this.enqueuePppoeGetParams(tenantId, device.id, pend.manufacturer, pend.deviceId, pend.parametersSnapshot).catch((e) =>
      this.logger.warn(`[tr069-adopt] GetParams PPPoE ${pend.deviceId}: ${(e as Error).message}`),
    );
  }

  /** Sufixo hex do serial (após o vendor) — igual em ambos os formatos. */
  private serialSuffixHex(serial: string): string | null {
    const s = this.str(serial).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (/^[A-Z]{4}/.test(s)) return s.slice(4) || null;
    if (/^[0-9A-F]{8}/.test(s)) return s.slice(8) || null;
    return s || null;
  }

  /**
   * Enfileira um GET_PARAMS para capturar o PPPoE username, com o PATH EXATO
   * derivado do snapshot que a ONT já mandou no Inform (à prova de vendor: nem
   * todo CPE aceita GetParameterValues por prefixo de subárvore — a Parks
   * responde Fault 9005 "Invalid parameter name"; e o índice WANConnectionDevice/
   * WANPPPConnection varia por modelo). Procuramos no snapshot um path
   * `...WANPPPConnection.N.*` real e pedimos exatamente o `.Username` dele. Só se
   * o snapshot não revelar nada caímos na dica do registry por vendor.
   */
  private async enqueuePppoeGetParams(
    tenantId: string,
    deviceDbId: string,
    manufacturer: string | null,
    deviceId: string,
    snapshot: unknown,
  ): Promise<void> {
    const names: string[] = [];
    const derived = this.pppoeUsernamePathsFromSnapshot(snapshot);
    names.push(...derived);
    if (names.length === 0) {
      // Fallback: dica do registry (path específico do vendor conhecido).
      const vendor = vendorFor(manufacturer, deviceId);
      const hint = provisioningPathsFor(vendor)?.pppoeUsername;
      if (hint) names.push(hint);
    }
    if (names.length === 0) {
      this.logger.warn(`[tr069-adopt] sem path de PPPoE para device=${deviceId} (snapshot sem WANPPPConnection)`);
      return;
    }
    await this.prisma.tr069Task.create({
      data: {
        tenantId,
        deviceId: deviceDbId,
        action: 'GET_PARAMS',
        status: 'PENDING',
        payload: { names, purpose: 'pppoe-discovery' } as object,
      },
    });
    this.logger.log(`[tr069-adopt] GetParams PPPoE enfileirado (paths=${names.length}) para device=${deviceId}`);
  }

  /**
   * Deriva os paths de `...WANPPPConnection.N.Username` a partir das CHAVES do
   * snapshot do Inform. Ex.: se o snapshot tem
   * `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.MACAddress`,
   * o path do Username é o mesmo prefixo + `.Username`.
   */
  private pppoeUsernamePathsFromSnapshot(snapshot: unknown): string[] {
    if (!snapshot || typeof snapshot !== 'object') return [];
    const prefixes = new Set<string>();
    const re = /^(.*WANPPPConnection\.\d+)\./i;
    const reTr181 = /^(.*\.PPP\.Interface\.\d+)\./i;
    for (const key of Object.keys(snapshot as Record<string, unknown>)) {
      const m = re.exec(key) ?? reTr181.exec(key);
      if (m) prefixes.add(m[1]);
    }
    return [...prefixes].map((p) => `${p}.Username`);
  }

  /**
   * Upsert do Ont. A ONU física (serial) casa 1:1 com o contrato. Guardas:
   * um contrato só tem 1 Ont (contractId unique) e uma OLT não repete serial.
   */
  private async upsertOnt(
    tenantId: string,
    oltId: string,
    contractId: string,
    ont: { serial: string; slot: number; pon: number; onuIndex: number; macAddress: string | null },
  ): Promise<void> {
    const existing = await this.prisma.ont.findFirst({
      where: { OR: [{ contractId }, { oltId, snGpon: ont.serial }] },
      select: { id: true },
    });
    const data = {
      snGpon: ont.serial,
      macAddress: ont.macAddress,
      ponSlot: ont.slot,
      ponOnuIndex: ont.onuIndex,
      ponFrame: ont.pon, // a coordenada "pon" da Fiberhome mapeia no ponFrame do modelo
    };
    if (existing) {
      await this.prisma.ont.update({ where: { id: existing.id }, data: { oltId, ...data } });
    } else {
      await this.prisma.ont.create({ data: { tenantId, contractId, oltId, ...data } });
    }
  }

  /**
   * Resolve o equipamento em comodato de um serviço no Hubsoft: o produto
   * vinculado cujo patrimônio tem status `comodato`. Prefere o patrimônio cujo
   * serial bate com a ONU descoberta (validação cruzada OLT↔Hubsoft); senão o
   * primeiro em comodato. Retorna {serial, mac, modelo?} ou null.
   */
  private async resolveComodato(
    cfg: HubsoftResolvedConfig,
    idClienteServico: string,
    ontSerial: string,
  ): Promise<{ serial: string; mac: string | null; produtoId: string | null } | null> {
    const vinculos = await this.hubsoftClient.getComodatoServico(cfg, idClienteServico);
    // Chaves canônicas da ONU (amigável + hex) — o comodato costuma vir em hex.
    const alvoKeys = new Set(ontSerialKeys(ontSerial));
    let best: { serial: string; mac: string | null; produtoId: string | null } | null = null;
    for (const v of vinculos) {
      for (const pat of v.patrimonios ?? []) {
        const isComodato = /comodato/i.test(this.str(pat.produto_item_status?.prefixo ?? pat.produto_item_status?.descricao));
        if (!isComodato || !pat.numero_serie) continue;
        const cand = {
          serial: this.str(pat.numero_serie),
          mac: this.macCanonical(pat.mac_address),
          produtoId: v.id_produto != null ? this.str(v.id_produto) : null,
        };
        // Casa por QUALQUER forma canônica (resolve comodato-em-hex ↔ ONU-amigável).
        if (ontSerialKeys(cand.serial).some((k) => alvoKeys.has(k))) return cand;
        best = best ?? cand;
      }
    }
    return best;
  }

  /**
   * Enriquece o Ont do contrato com os dados do comodato (MAC se ausente, e
   * registra em notas que é comodato + serial do patrimônio). Não sobrescreve o
   * snGpon (a identidade física vem da OLT) nem cria estoque paralelo — o Ont é
   * o mesmo equipamento.
   */
  private async enrichOntWithComodato(
    tenantId: string,
    contractId: string,
    comodato: { serial: string; mac: string | null; produtoId: string | null },
  ): Promise<void> {
    const ont = await this.prisma.ont.findFirst({ where: { tenantId, contractId }, select: { id: true, macAddress: true, serialPhysical: true, notes: true } });
    if (!ont) return;
    const note = `Comodato Hubsoft: serial patrimônio ${comodato.serial}${comodato.produtoId ? ` (produto ${comodato.produtoId})` : ''}.`;
    await this.prisma.ont.update({
      where: { id: ont.id },
      data: {
        // MAC do comodato só se o Ont ainda não tem (o da OLT tem prioridade).
        macAddress: ont.macAddress ?? comodato.mac,
        // serialPhysical = serial de etiqueta do patrimônio (confirma a ONU).
        serialPhysical: ont.serialPhysical ?? comodato.serial,
        notes: ont.notes ? `${ont.notes}\n${note}` : note,
      },
    });
  }

  /** Canonicaliza MAC "aabb.ccdd.eeff"/"AA-BB-.." → "AA:BB:CC:DD:EE:FF" ou null. */
  private macCanonical(v: unknown): string | null {
    const hex = this.str(v).replace(/[^0-9a-fA-F]/g, '');
    if (hex.length !== 12) return null;
    return (hex.match(/.{2}/g) as string[]).join(':').toUpperCase();
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
}

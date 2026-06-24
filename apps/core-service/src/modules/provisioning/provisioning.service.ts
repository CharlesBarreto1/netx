/**
 * ProvisioningService — orquestra o fluxo de ativação ZTP em campo.
 *
 * Endpoint principal: POST /v1/provisioning/install/:contractId
 *   1. Valida que contrato existe + está PENDING_INSTALL (ou ACTIVE pra
 *      re-provisionar troca de ONT)
 *   2. Valida OLT existe + active
 *   3. Resolve driver (OltDriverFactory) baseado em vendor/providerMode
 *   4. Decrypta credenciais → monta ConnectionContext
 *   5. Chama driver.authorizeOnt() → cria/atualiza Ont row
 *   6. Atualiza Contract: status=ACTIVE, salva ssid + wifiPasswordEnc, MAC, etc.
 *   7. Enfileira Tr069Task SET_PARAMS (Wi-Fi) — Fase 3 ACS aplica
 *   8. Enfileira radius_event AUTHORIZE via RadiusSyncService
 *   9. Persiste ProvisioningEvent pra auditoria de cada passo
 *  10. Retorna timeline pro front mostrar progresso
 *
 * Tudo em transação Prisma? **Não** — chamadas de driver são externas e podem
 * levar segundos. Estratégia:
 *   - Cria Ont em PENDING_AUTH ANTES de chamar driver (idempotência: re-run
 *     vê Ont existente)
 *   - Chama driver (fora da TX)
 *   - Em sucesso: TX atômica que atualiza Ont status, Contract, enfileira
 *     radius_event + tr069_task
 *   - Em falha: marca Ont status=FAULT, lastError. Contract continua PENDING.
 *
 * Auditoria: cada chamada de driver vira um ProvisioningEvent (sucesso ou
 * falha) — rastreável em /contracts/:id timeline.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  type InstallCustomerRequest,
  type InstallCustomerResponse,
  type InstallTimelineEvent,
  type ListPendingInstallsQuery,
  type Paginated,
  type PendingInstallItem,
  paginationMeta,
} from '@netx/shared';
import {
  type Contract,
  ContractStatus as PrismaContractStatus,
  type Olt,
  type Ont,
  Prisma,
  type ProvisioningEventAction,
  type ProvisioningEventStatus,
} from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { BrBillingService } from '../br-billing/br-billing.service';
import { recalcCustomerStatus } from '../contracts/customer-status';
import { InvoiceGeneratorService } from '../contracts/invoice-generator.service';
import { RadiusSyncService } from '../contracts/radius-sync.service';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { ComodatoService } from '../stock/comodato.service';

import { UfinetOrdersService } from '../ufinet/ufinet-orders.service';

import { OltDriverFactory } from './drivers/olt-driver.factory';
import { OltProvisioningProfilesService } from './olt-provisioning-profiles.service';
import { buildConnectionContext } from './olt-context.util';
import { Tr069TasksService } from './tr069-tasks.service';
import { EventBusPublisher } from '../events/event-bus.publisher';
import {
  CPE_ONT_SWAPPED,
  ERP_CONTRACT_INSTALLED,
  type OntSwappedPayload,
  type ContractInstalledPayload,
} from '../events/event-types';

@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly radius: RadiusSyncService,
    private readonly tr069: Tr069TasksService,
    private readonly drivers: OltDriverFactory,
    private readonly comodato: ComodatoService,
    private readonly ufinet: UfinetOrdersService,
    private readonly invoiceGen: InvoiceGeneratorService,
    private readonly bus: EventBusPublisher,
    private readonly profiles: OltProvisioningProfilesService,
    private readonly brBilling: BrBillingService,
  ) {}

  /**
   * Lista contratos aguardando provisionamento (status=PENDING_INSTALL).
   * UI: /provisioning/pending.
   */
  async listPending(
    tenantId: string,
    q: ListPendingInstallsQuery,
  ): Promise<Paginated<PendingInstallItem>> {
    const where: Prisma.ContractWhereInput = {
      tenantId,
      deletedAt: null,
      status: PrismaContractStatus.PENDING_INSTALL,
      ...(q.search && {
        OR: [
          { code: { contains: q.search, mode: 'insensitive' } },
          { installationAddress: { contains: q.search, mode: 'insensitive' } },
          {
            customer: {
              displayName: { contains: q.search, mode: 'insensitive' },
            },
          },
        ],
      }),
    };
    const skip = (q.page - 1) * q.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        include: {
          customer: { select: { id: true, displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: q.pageSize,
      }),
      this.prisma.contract.count({ where }),
    ]);
    return {
      data: rows.map((c) => ({
        contractId: c.id,
        contractCode: c.code,
        customerId: c.customerId,
        customerName: c.customer.displayName,
        installationAddress: c.installationAddress,
        bandwidthMbps: c.bandwidthMbps,
        monthlyValue: c.monthlyValue.toString(),
        createdAt: c.createdAt.toISOString(),
      })),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  /**
   * Orquestrador principal. Idempotente: se já tem Ont vinculada ao contrato,
   * faz retry do passo que falhou.
   */
  async installCustomer(
    tenantId: string,
    actorUserId: string,
    contractId: string,
    input: InstallCustomerRequest,
  ): Promise<InstallCustomerResponse> {
    const timeline: InstallTimelineEvent[] = [];
    const pushEvent = (
      action: ProvisioningEventAction,
      status: ProvisioningEventStatus,
      message: string,
      durationMs: number | null = null,
      error: string | null = null,
    ): void => {
      timeline.push({
        action,
        status,
        message,
        durationMs,
        at: new Date().toISOString(),
        error,
      });
    };

    // ── 1. Carrega Contract + OLT ──────────────────────────────────────────
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, tenantId, deletedAt: null },
      include: { ont: true },
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado');
    if (
      contract.status !== PrismaContractStatus.PENDING_INSTALL &&
      contract.status !== PrismaContractStatus.ACTIVE
    ) {
      throw new BadRequestException(
        `Contrato em status ${contract.status} — só PENDING_INSTALL ou ACTIVE (re-provision) podem ser instalados`,
      );
    }

    const olt = await this.prisma.olt.findFirst({
      where: { id: input.oltId, tenantId, deletedAt: null },
    });
    if (!olt) throw new NotFoundException('OLT não encontrada');

    // Defesa pré-driver: o driver Huawei SSH (DIRECT) ainda é stub e lançaria
    // mensagem técnica confusa pro técnico. Damos um erro amigável antes.
    // UFINET/ORCHESTRATOR JÁ é suportado (módulo ufinet — alta/confirmar-ONT
    // assíncronos); EXTERNAL e GENERIC (mock) sempre passam.
    const isStub = olt.providerMode === 'DIRECT' && olt.vendor === 'HUAWEI';
    if (isStub) {
      throw new BadRequestException(
        `Driver ${olt.vendor}/${olt.providerMode} ainda não implementado ` +
          '(Huawei SSH planejado pra fase BR). Pra ativar clientes agora, edite a ' +
          'OLT e troque "Modo" pra EXTERNAL — NetX registra a ONT e segue pra ' +
          'RADIUS + TR-069, com você provisionando o SN manualmente na OLT real.',
      );
    }

    // ── 1.5. Resolve SerialItem (estoque) → SN GPON definitivo ────────────
    // Trava de segurança: ONT precisa estar registrada no estoque ANTES de
    // ser entregue ao cliente. Quem provisionou sem cadastrar primeiro tinha
    // "ONT fantasma" — agora não rola.
    //
    // Dois caminhos:
    //   A) input.serialItemId fornecido → busca SerialItem, valida, usa serial dele
    //   B) input.allowStockBypass=true + input.snGpon → bypass (debug/migração)
    let resolvedSnGpon: string;
    let serialItemId: string | null = input.serialItemId ?? null;

    if (serialItemId) {
      const serial = await this.prisma.serialItem.findFirst({
        where: { id: serialItemId, tenantId },
        include: { product: { select: { type: true, name: true } } },
      });
      if (!serial) {
        throw new NotFoundException(
          'SerialItem (equipamento) não encontrado em estoque',
        );
      }
      if (serial.product.type !== 'PATRIMONIAL') {
        throw new BadRequestException(
          `Produto "${serial.product.name}" não é PATRIMONIAL — não dá pra usar como ONT`,
        );
      }
      if (serial.status === 'ALLOCATED' && serial.contractId === contractId) {
        // Idempotente — admin já alocou esse serial no contrato (re-execução)
      } else if (serial.status !== 'IN_STOCK') {
        throw new BadRequestException(
          `Serial ${serial.serial} está em status ${serial.status}. ` +
            'Só seriais IN_STOCK podem ser usados em provisionamento novo.',
        );
      }
      resolvedSnGpon = serial.serial;
    } else if (input.allowStockBypass && input.snGpon) {
      // Bypass explícito — admin assume responsabilidade. Logamos warning
      // pra audit posterior identificar "ONTs sem cadastro".
      this.logger.warn(
        `[PROV] allowStockBypass=true contract=${contractId} sn=${input.snGpon} ` +
          'actor=${actorUserId} — ONT entrando sem registro no estoque',
      );
      resolvedSnGpon = input.snGpon;
    } else {
      // Defesa em profundidade — DTO já validou, mas faço guarda aqui também
      throw new BadRequestException(
        'Selecione um equipamento do estoque (serialItemId) OU marque ' +
          'allowStockBypass=true e forneça snGpon.',
      );
    }

    // ── 2. Cria ou re-aproveita Ont row em PENDING_AUTH ───────────────────
    let ont: Ont;
    if (contract.ont) {
      // Re-provisionamento: usa Ont existente, atualiza SN se mudou
      if (contract.ont.snGpon !== resolvedSnGpon) {
        throw new ConflictException(
          `Contrato já tem ONT com SN ${contract.ont.snGpon}. Pra trocar, ` +
            'desautorize a antiga via /v1/provisioning/onts/:id antes.',
        );
      }
      ont = contract.ont;
    } else {
      // Verifica que SN não está vinculado a outro contrato na mesma OLT
      const collision = await this.prisma.ont.findFirst({
        where: { oltId: input.oltId, snGpon: resolvedSnGpon },
      });
      if (collision) {
        throw new ConflictException(
          `SN ${resolvedSnGpon} já vinculado a outro contrato nessa OLT`,
        );
      }
      ont = await this.prisma.ont.create({
        data: {
          tenantId,
          contractId,
          oltId: input.oltId,
          snGpon: resolvedSnGpon,
          macAddress: input.macAddress ?? null,
          serialPhysical: input.serialPhysical ?? null,
          ponFrame: input.ponFrame ?? null,
          ponSlot: input.ponSlot ?? null,
          status: 'PENDING_AUTH',
          // Modo Wi-Fi do modelo (escolhido pelo técnico no form). Usado
          // aqui e depois pelo ContractWifiCard (edição pós-instalação).
          wifiBandMode: input.wifiBandMode,
          notes: input.notes ?? null,
        },
      });
    }

    // ── 2.5. Aloca SerialItem em comodato (se veio do estoque) ────────────
    // Mover essa lógica pra DEPOIS de criar Ont garante que se algo falhar
    // no driver, podemos retry sem ter "alocado e perdido" o serial.
    // ComodatoService.allocate é idempotente — re-execução não duplica.
    if (serialItemId) {
      try {
        await this.comodato.allocate(tenantId, actorUserId, {
          contractId,
          serialItemId,
          notes: `Provisionado via /provisioning/install — ONT ${resolvedSnGpon}`,
        });
        pushEvent('CONTRACT_ACTIVATE', 'SUCCESS', `Equipamento alocado em comodato (estoque)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Falha de alocação = abort total. Sem comodato, não dá pra prosseguir
        // com instalação confiável (não saberíamos qual ONT entregamos).
        pushEvent('CONTRACT_ACTIVATE', 'FAILED', 'Falha na alocação de comodato', null, msg);
        throw err;
      }
    }

    // ── 3. Chama driver.authorizeOnt() ─────────────────────────────────────
    const driver = this.drivers.resolve(olt.vendor, olt.providerMode);
    const ctx = buildConnectionContext(olt, this.crypto);
    const isExternal = olt.providerMode === 'EXTERNAL';
    pushEvent(
      'OLT_AUTHORIZE',
      'PENDING',
      isExternal
        ? `Registrando ONT ${resolvedSnGpon} (OLT ${olt.name} é EXTERNAL — provisão real fora do NetX)`
        : `Autorizando SN ${resolvedSnGpon} na OLT ${olt.name}`,
    );

    // Template de provisionamento (Plan ?? OLT default). Drivers que renderizam
    // CLI estruturado (Zyxel) usam isto; mock/Ufinet/EXTERNAL ignoram.
    const provisioningProfile = await this.profiles.resolveForInstall(
      tenantId,
      contract.planId,
      olt.id,
    );

    const authResult = await driver.authorizeOnt(ctx, {
      snGpon: resolvedSnGpon,
      macAddress: input.macAddress ?? null,
      ponFrame: input.ponFrame ?? null,
      ponSlot: input.ponSlot ?? null,
      bandwidthMbps: contract.bandwidthMbps,
      vlanId: olt.serviceVlanId,
      contractRef: contract.code ?? contract.id,
      provisioningProfile,
    });

    await this.persistEvent({
      tenantId,
      contractId,
      ontId: ont.id,
      oltId: olt.id,
      action: 'OLT_AUTHORIZE',
      status: authResult.success ? 'SUCCESS' : 'FAILED',
      payload: authResult.success
        // JSON.parse(JSON.stringify(x)) força o objeto a passar a barreira
        // de tipos do Prisma JsonValue (interfaces TS strict não casam com
        // o index signature exigido por JsonObject, embora o conteúdo seja
        // 100% serializável).
        ? (JSON.parse(JSON.stringify({ sn: resolvedSnGpon, result: authResult.data })) as Prisma.JsonObject)
        : { sn: resolvedSnGpon },
      error: authResult.success ? null : authResult.error,
      durationMs: authResult.durationMs,
      actorUserId,
    });

    if (!authResult.success) {
      // Marca Ont em FAULT — operador pode retry depois
      await this.prisma.ont.update({
        where: { id: ont.id },
        data: { status: 'FAULT', lastError: authResult.error },
      });
      pushEvent(
        'OLT_AUTHORIZE',
        'FAILED',
        `Falha ao autorizar: ${authResult.error}`,
        authResult.durationMs,
        authResult.error,
      );
      return {
        contractId,
        ontId: ont.id,
        status: 'FAILED',
        timeline,
      };
    }
    pushEvent(
      'OLT_AUTHORIZE',
      'SUCCESS',
      `ONT autorizada em ${authResult.data.ponFrame ?? '?'}/` +
        `${authResult.data.ponSlot ?? '?'}/${authResult.data.ponOnuIndex ?? '?'}`,
      authResult.durationMs,
    );

    // ── 4. TX atômica: atualiza Ont + Contract + radius + tr069 task ───────
    const effectiveMac = authResult.data.macAddress ?? input.macAddress ?? null;

    // Wi-Fi: vem do CONTRATO (definido no cadastro). input.ssid/wifiPassword são
    // só fallback de clientes legados — se o contrato já tem, ignora o input.
    const effectiveSsid = contract.ssid ?? input.ssid ?? null;
    const effectiveWifiPassword = contract.wifiPasswordEnc
      ? this.crypto.decrypt(contract.wifiPasswordEnc)
      : input.wifiPassword ?? null;
    const hasWifi = !!(effectiveSsid && effectiveWifiPassword);
    let updatedContract: Contract | null = null;
    // Fatura inicial criada na ativação (se houver) — emitida no gateway
    // PÓS-commit (fora da tx). null = não gerou nesta ativação.
    let initialInvoiceId: string | null = null;
    try {
      updatedContract = await this.prisma.$transaction(async (tx) => {
        // 4.1 Atualiza Ont com resultado do driver
        await tx.ont.update({
          where: { id: ont.id },
          data: {
            status: 'AUTHORIZED',
            macAddress: effectiveMac,
            ponFrame: authResult.data.ponFrame,
            ponSlot: authResult.data.ponSlot,
            ponOnuIndex: authResult.data.ponOnuIndex,
            authorizedAt: new Date(),
            lastError: null,
          },
        });

        // 4.2 Atualiza Contract: status ACTIVE. O Wi-Fi normalmente já veio do
        // cadastro; só persiste aqui se o contrato ainda não tiver (fallback do
        // input legado).
        const c = await tx.contract.update({
          where: { id: contract.id },
          data: {
            status: PrismaContractStatus.ACTIVE,
            activatedAt: contract.activatedAt ?? new Date(),
            ...(!contract.ssid && effectiveSsid ? { ssid: effectiveSsid } : {}),
            ...(!contract.wifiPasswordEnc && effectiveWifiPassword
              ? { wifiPasswordEnc: this.crypto.encrypt(effectiveWifiPassword) }
              : {}),
            // Se IPoE e MAC veio do driver, atualiza identificador RADIUS
            ...(contract.authMethod === 'IPOE' && effectiveMac
              ? { macAddress: effectiveMac }
              : {}),
            updatedById: actorUserId,
          },
        });

        // 4.2b Fatura inicial: o contrato é ativado AQUI (fluxo ZTP padrão —
        // nasce PENDING_INSTALL e o técnico ativa em campo). O create() só
        // gera a INITIAL quando nasce ACTIVE direto, então a ativação via
        // instalação precisa gerá-la — senão PREPAID nunca fatura (o cron
        // depende de prepaidUntil, inicializado só em generateInitialInvoice).
        // Idempotente: só na 1ª ativação (vinha PENDING_INSTALL) e se ainda
        // não existe INITIAL — re-provision de contrato já ACTIVE não duplica.
        if (contract.status === PrismaContractStatus.PENDING_INSTALL) {
          const hasInitial = await tx.contractInvoice.findFirst({
            where: { tenantId, contractId: c.id, kind: 'INITIAL' },
            select: { id: true },
          });
          if (!hasInitial) {
            initialInvoiceId = await this.invoiceGen.generateInitialInvoice(tx, c, {
              activatedAt: c.activatedAt ?? new Date(),
            });
          }
        }

        // 4.3 Enfileira radius_event AUTHORIZE (já reativa se SUSPENDED)
        if (c.authMethod === 'IPOE' || c.authMethod === 'PPPOE') {
          const hasIdentifier =
            c.authMethod === 'IPOE'
              ? !!(c.circuitId ?? c.macAddress)
              : !!c.pppoeUsername;
          if (hasIdentifier) {
            await this.radius.enqueueSync(c, 'instalação concluída via provisioning', tx);
          } else {
            // IPoE sem MAC ainda (driver não retornou) — radius vai ser
            // sincronizado depois quando Inform/Accounting popular o MAC.
            this.logger.warn(
              `[PROV] contrato ${c.id} IPoE sem identificador — RADIUS sync ` +
                'adiado até MAC chegar via Accounting',
            );
          }
        }

        // Auto-status do customer: contrato saiu de PENDING_INSTALL → ACTIVE,
        // então o customer deixa de ser INACTIVE e vira ACTIVE.
        await recalcCustomerStatus(tx, tenantId, c.customerId);

        return c;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushEvent('CONTRACT_ACTIVATE', 'FAILED', 'Falha ao ativar contrato', null, message);
      throw err;
    }

    pushEvent(
      'CONTRACT_ACTIVATE',
      'SUCCESS',
      `Contrato ${updatedContract.code ?? updatedContract.id.slice(0, 8)} ativado`,
    );
    pushEvent('RADIUS_ENQUEUE', 'SUCCESS', 'RADIUS sync enfileirado (applier processa em ≤30s)');

    // Faz a fatura inicial "nascer" no gateway do contrato (MANUAL = no-op).
    // Pós-commit + best-effort (nunca lança); cron de autogen é a rede de
    // segurança se o gateway estiver fora.
    if (initialInvoiceId && updatedContract) {
      await this.brBilling.emitForInvoice(
        tenantId,
        actorUserId,
        initialInvoiceId,
        updatedContract.brBillingGateway,
      );
    }

    // ── 5. Enfileira Tr069Task SET_PARAMS (Wi-Fi) ─────────────────────────
    // Fora da TX porque a tabela tr069_tasks tem cascade no device, e device
    // upsert lê do mesmo DB. Mantemos sequencial — falha aqui não rola back
    // a ativação RADIUS (Wi-Fi é nice-to-have, técnico pode config manual).
    //
    // Sem Wi-Fi no contrato → pula (a ONT fica no SSID de fábrica; atendimento
    // pode definir depois pelo card de Wi-Fi). Não bloqueia a ativação.
    if (!hasWifi) {
      pushEvent(
        'TR069_TASK_ENQUEUE',
        'SUCCESS',
        'Sem Wi-Fi definido no contrato — etapa pulada (defina pelo card de Wi-Fi)',
      );
    } else try {
      // ZTP PPPoE: quando o contrato é PPPoE, injetamos a credencial do
      // contrato na WAN da ONT junto com o Wi-Fi — a ONG disca PPPoE
      // sozinha, técnico não toca em config de rede.
      const pppoe =
        updatedContract.authMethod === 'PPPOE' &&
        updatedContract.pppoeUsername &&
        updatedContract.pppoePassword
          ? {
              username: updatedContract.pppoeUsername,
              password: updatedContract.pppoePassword,
              // VLAN da WAN PPPoE — vem do form (default 1010 no DTO).
              vlan: input.pppoeVlan,
            }
          : undefined;

      const { taskId, deviceId } = await this.tr069.enqueueSetWifi(
        tenantId,
        ont.id,
        contractId,
        resolvedSnGpon,
        {
          ssid: effectiveSsid!,
          password: effectiveWifiPassword!,
          bothBands: true,
          wifiBandMode: ont.wifiBandMode,
          pppoe,
        },
      );
      await this.persistEvent({
        tenantId,
        contractId,
        ontId: ont.id,
        oltId: olt.id,
        action: 'TR069_TASK_ENQUEUE',
        status: 'SUCCESS',
        payload: {
          taskId,
          ssid: effectiveSsid,
          bands: ['2.4', '5'],
          pppoeInjected: !!pppoe,
        },
        actorUserId,
      });
      pushEvent(
        'TR069_TASK_ENQUEUE',
        'SUCCESS',
        pppoe
          ? `Wi-Fi + credencial PPPoE enfileirados pro ACS — task ${taskId.slice(0, 8)}`
          : `Wi-Fi enfileirado pro ACS aplicar — task ${taskId.slice(0, 8)}`,
      );

      // IP Acquisition Mode IPv6 (Origin=AutoConfigured) só aplica após reboot.
      // Política: no provisionamento reiniciamos imediatamente (estamos em
      // janela de instalação), mas só quando há PPPoE/IPv6 — que é a config
      // que exige reboot. FIFO garante SET → REBOOT na mesma sessão do Inform.
      if (pppoe) {
        const { taskId: rebootTaskId } = await this.tr069.enqueueReboot(
          tenantId,
          deviceId,
          contractId,
        );
        pushEvent(
          'TR069_TASK_ENQUEUE',
          'SUCCESS',
          `Reboot pós-config enfileirado (ativa IPv6 Automatic) — task ${rebootTaskId.slice(0, 8)}`,
        );
      }
    } catch (err) {
      // TR-069 falha NÃO impede ativação — só loga
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[PROV] TR-069 enqueue falhou: ${msg}`);
      pushEvent('TR069_TASK_ENQUEUE', 'FAILED', 'Wi-Fi não enfileirado', null, msg);
    }

    // ── 6. Ufinet (ORCHESTRATOR): confirma a ONT na rede neutra (async) ──────
    // Garante o serviço Ufinet (idempotente — auto-cura se a alta não foi
    // enfileirada na criação do contrato) e manda o SN. O poller leva
    // alta→reserva→confirmar-ONT→confirmação→ACTIVE; o RADIUS/PPPoE local já
    // autoriza o tráfego (Caso A), então a confirmação óptica é assíncrona.
    if (olt.vendor === 'UFINET' && olt.providerMode === 'ORCHESTRATOR') {
      try {
        await this.ufinet.enqueueProvide({
          tenantId,
          contractId,
          oltId: olt.id,
          actorUserId,
        });
        // A Ufinet controla só a CAIXA → ctoPort = caixa real do técnico
        // (sobrescreve a sugerida). A porta é só doc interna do NetX.
        await this.ufinet.requestConfirmOnt(tenantId, contractId, resolvedSnGpon, {
          ctoPort: input.ufinetCto?.trim() || null,
          dropPort: input.ufinetPort?.trim() || null,
          actorUserId,
        });
        pushEvent('OLT_AUTHORIZE', 'SUCCESS', 'ONT confirmada na fila Ufinet (poller conclui em background)');
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[PROV] Ufinet confirm-ONT falhou: ${m}`);
        pushEvent('OLT_AUTHORIZE', 'FAILED', 'Confirmação Ufinet não enfileirada', null, m);
      }
    }

    // Audit log de alto nível
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'provisioning.installed',
      resource: 'contracts',
      resourceId: contractId,
      metadata: {
        ontId: ont.id,
        oltId: olt.id,
        snGpon: resolvedSnGpon,
        serialItemId,
        stockBypass: input.allowStockBypass,
        bandwidthMbps: contract.bandwidthMbps,
      },
    });

    // Bus (Fase 3): contrato ativado em campo. Só na transição REAL
    // PENDING_INSTALL → ACTIVE — re-provision de contrato já ACTIVE não republica.
    if (contract.status === PrismaContractStatus.PENDING_INSTALL) {
      await this.bus.emit<ContractInstalledPayload>(ERP_CONTRACT_INSTALLED, tenantId, {
        contractId,
        customerId: updatedContract.customerId,
        ontId: ont.id,
        oltId: olt.id,
      });
    }

    return {
      contractId,
      ontId: ont.id,
      status: 'OK',
      timeline,
      pollUrl: `/v1/provisioning/onts/${ont.id}/status`,
    };
  }

  /** Status atual da ONT (UI faz poll). */
  async getOntStatus(tenantId: string, ontId: string): Promise<Ont & { oltName: string }> {
    const ont = await this.prisma.ont.findFirst({
      where: { id: ontId, tenantId },
      include: { olt: { select: { name: true } } },
    });
    if (!ont) throw new NotFoundException('ONT não encontrada');
    return { ...ont, oltName: ont.olt.name };
  }

  /**
   * Re-tentar o provisionamento da MESMA ONT (sem trocar equipamento): re-sync
   * RADIUS (AUTHORIZE) + re-enfileira o Wi-Fi via TR-069, usando o estado atual
   * do contrato/ONT. Usado na confirmação da O.S quando o cliente não subiu mas
   * a ONT é a certa (ex.: ainda não fez Inform / RADIUS não aplicou).
   */
  async reprovisionContract(
    tenantId: string,
    actorUserId: string,
    contractId: string,
  ): Promise<InstallCustomerResponse> {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, tenantId, deletedAt: null },
      include: { ont: { include: { olt: true } } },
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado');
    if (!contract.ont) {
      throw new BadRequestException('Contrato sem ONT — provisione primeiro.');
    }

    const timeline: InstallTimelineEvent[] = [];
    const at = (): string => new Date().toISOString();
    const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

    // RADIUS — re-enfileira AUTHORIZE pro identificador atual.
    try {
      await this.radius.enqueueSync(contract, 'Re-tentar provisionamento (O.S)');
      timeline.push({
        action: 'RADIUS_ENQUEUE',
        status: 'SUCCESS',
        message: 'RADIUS re-enfileirado (AUTHORIZE)',
        durationMs: null,
        at: at(),
        error: null,
      });
    } catch (err) {
      timeline.push({
        action: 'RADIUS_ENQUEUE',
        status: 'FAILED',
        message: 'RADIUS não re-enfileirado',
        durationMs: null,
        at: at(),
        error: errMsg(err),
      });
    }

    // TR-069 — re-aplica Wi-Fi (SSID + senha) nas 2 bandas.
    try {
      const password = contract.wifiPasswordEnc
        ? this.crypto.decrypt(contract.wifiPasswordEnc)
        : null;
      if (contract.ssid && password) {
        const { taskId } = await this.tr069.enqueueSetWifi(
          tenantId,
          contract.ont.id,
          contractId,
          contract.ont.snGpon,
          {
            ssid: contract.ssid,
            password,
            bothBands: true,
            wifiBandMode: contract.ont.wifiBandMode,
          },
        );
        timeline.push({
          action: 'TR069_TASK_ENQUEUE',
          status: 'SUCCESS',
          message: `Wi-Fi re-enfileirado pro ACS — task ${taskId.slice(0, 8)}`,
          durationMs: null,
          at: at(),
          error: null,
        });
      }
    } catch (err) {
      timeline.push({
        action: 'TR069_TASK_ENQUEUE',
        status: 'FAILED',
        message: 'Wi-Fi não re-enfileirado',
        durationMs: null,
        at: at(),
        error: errMsg(err),
      });
    }

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'provisioning.reprovisioned',
      resource: 'contracts',
      resourceId: contractId,
      metadata: { ontId: contract.ont.id },
    });

    return {
      contractId,
      ontId: contract.ont.id,
      status: 'OK',
      timeline,
      pollUrl: `/v1/provisioning/onts/${contract.ont.id}/status`,
    };
  }

  /**
   * Troca de ONT (O.S de suporte). Devolve a ONT antiga ao estoque e provisiona
   * a nova: Ufinet via "Cambio de ONT" (CHANGE_RESOURCE, assíncrono); rede
   * própria via deauthorize + re-install. TR-069 sempre re-cadastra device+Wi-Fi.
   */
  async swapOnt(
    tenantId: string,
    actorUserId: string,
    contractId: string,
    input: {
      newSerialItemId?: string | null;
      newSnGpon?: string | null;
      allowStockBypass?: boolean;
      returnLocationId: string;
      // Wi-Fi opcional — a troca mantém o do contrato; input só sobrescreve.
      ssid?: string | null;
      wifiPassword?: string | null;
      wifiBandMode?: 'BAND_STEERING' | 'DUAL_BAND';
    },
  ): Promise<{ status: 'OK' | 'PARTIAL' | 'FAILED' }> {
    const ont = await this.prisma.ont.findFirst({ where: { tenantId, contractId } });
    if (!ont) {
      throw new BadRequestException(
        'Contrato sem ONT atual pra trocar — use uma O.S de instalação.',
      );
    }

    // Wi-Fi herdado do contrato (definido no cadastro). input só sobrescreve.
    const contractWifi = await this.prisma.contract.findFirst({
      where: { id: contractId, tenantId },
      select: { ssid: true, wifiPasswordEnc: true },
    });
    const effectiveSsid = contractWifi?.ssid ?? input.ssid ?? null;
    const effectiveWifiPassword = contractWifi?.wifiPasswordEnc
      ? this.crypto.decrypt(contractWifi.wifiPasswordEnc)
      : input.wifiPassword ?? null;
    const olt = await this.prisma.olt.findFirst({
      where: { id: ont.oltId, tenantId, deletedAt: null },
    });
    if (!olt) throw new NotFoundException('OLT da ONT atual não encontrada');
    const oldSn = ont.snGpon;

    // Serial novo (do estoque ou manual via bypass).
    let newSn = input.newSnGpon?.trim() || null;
    if (input.newSerialItemId) {
      const si = await this.prisma.serialItem.findFirst({
        where: { id: input.newSerialItemId, tenantId },
        select: { serial: true },
      });
      if (!si) throw new BadRequestException('ONT nova não encontrada no estoque');
      newSn = si.serial;
    }
    if (!newSn)
      throw new BadRequestException('Informe a ONT nova (estoque ou serial manual).');

    const isUfinet = olt.vendor === 'UFINET' && olt.providerMode === 'ORCHESTRATOR';

    // VALIDAÇÃO ANTES de mexer em estoque/rede: troca Ufinet exige um
    // UfinetService já existente (contrato que passou pela alta/ativação). Sem
    // isso, requestSwapOnt lançaria erro DEPOIS de devolver a ONT antiga ao
    // estoque → estado inconsistente. Falha cedo com mensagem clara.
    if (isUfinet) {
      const ufSvc = await this.prisma.ufinetService.findUnique({
        where: { contractId },
        select: { id: true },
      });
      if (!ufSvc) {
        throw new ConflictException(
          'Este contrato não tem serviço Ufinet ativo — troca de ONT indisponível. ' +
            'Provavelmente foi ativado por outro caminho; use uma O.S de instalação.',
        );
      }
    }

    // Devolve a ONT antiga ao estoque (comodato) — só APÓS validações acima.
    const oldComodato = await this.prisma.serialItem.findFirst({
      where: { tenantId, contractId, status: 'ALLOCATED' },
      select: { id: true },
    });
    if (oldComodato) {
      await this.comodato.returnItem(
        tenantId,
        actorUserId,
        { serialItemId: oldComodato.id, toLocationId: input.returnLocationId, notes: 'Troca de ONT (O.S)' },
        { isAdmin: true, skipOntLinkGuard: true },
      );
    }

    if (isUfinet) {
      if (input.newSerialItemId) {
        await this.comodato.allocate(tenantId, actorUserId, {
          contractId,
          serialItemId: input.newSerialItemId,
        });
      }
      await this.ufinet.requestSwapOnt(tenantId, contractId, newSn, actorUserId);
      await this.prisma.tr069Device.deleteMany({ where: { tenantId, ontId: ont.id } });
      await this.prisma.ont.update({
        where: { id: ont.id },
        data: { snGpon: newSn, status: 'PENDING_AUTH' },
      });
      if (effectiveSsid && effectiveWifiPassword) {
        await this.tr069.enqueueSetWifi(tenantId, ont.id, contractId, newSn, {
          ssid: effectiveSsid,
          password: effectiveWifiPassword,
          bothBands: true,
          wifiBandMode: input.wifiBandMode ?? 'BAND_STEERING',
        });
      }
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'provisioning.ont_swap',
        resource: 'onts',
        resourceId: ont.id,
        metadata: { oldSn, newSn, network: 'ufinet' },
      });
      await this.bus.emit<OntSwappedPayload>(
        CPE_ONT_SWAPPED,
        tenantId,
        { contractId, ontId: ont.id, oldSn, newSn, network: 'ufinet', status: 'OK' },
        'netx-cpe',
      );
      return { status: 'OK' };
    }

    // Rede própria: desautoriza a antiga e re-instala a nova (reusa
    // installCustomer → cria Ont nova + autoriza + comodato + TR-069 + RADIUS).
    const ctx = buildConnectionContext(olt, this.crypto);
    try {
      await this.drivers.resolve(olt.vendor, olt.providerMode).deauthorizeOnt(ctx, oldSn);
    } catch (err) {
      this.logger.warn(
        `[swap] deauthorize da ONT antiga falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    await this.prisma.tr069Device.deleteMany({ where: { tenantId, ontId: ont.id } });
    await this.prisma.ont.delete({ where: { id: ont.id } });
    const res = await this.installCustomer(tenantId, actorUserId, contractId, {
      oltId: olt.id,
      serialItemId: input.newSerialItemId ?? null,
      allowStockBypass: input.allowStockBypass ?? false,
      snGpon: newSn,
      // installCustomer já lê o Wi-Fi do contrato; passamos o efetivo só como
      // fallback (idempotente — não sobrescreve o que o contrato já tem).
      ssid: effectiveSsid,
      wifiPassword: effectiveWifiPassword,
      wifiBandMode: input.wifiBandMode ?? 'BAND_STEERING',
      pppoeVlan: 1010,
    } as InstallCustomerRequest);
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'provisioning.ont_swap',
      resource: 'onts',
      resourceId: ont.id,
      metadata: { oldSn, newSn, network: 'own' },
    });
    await this.bus.emit<OntSwappedPayload>(
      CPE_ONT_SWAPPED,
      tenantId,
      // rede própria: a ONT antiga foi DELETADA (linha acima) e installCustomer
      // criou uma nova — usar res.ontId (a nova), não ont.id (a removida).
      { contractId, ontId: res.ontId, oldSn, newSn, network: 'own', status: res.status },
      'netx-cpe',
    );
    return { status: res.status };
  }

  /**
   * Desprovisiona (O.S de retirada): devolve equipamento(s) ao estoque +
   * desautoriza na OLT / dá baja na Ufinet. O cancelamento do contrato é
   * disparado pelo ServiceOrdersService (completeField).
   */
  async deprovision(
    tenantId: string,
    actorUserId: string,
    contractId: string,
    input: { returnLocationId: string },
  ): Promise<{ status: 'OK'; returned: number }> {
    const allocated = await this.prisma.serialItem.findMany({
      where: { tenantId, contractId, status: 'ALLOCATED' },
      select: { id: true },
    });
    for (const s of allocated) {
      await this.comodato.returnItem(
        tenantId,
        actorUserId,
        { serialItemId: s.id, toLocationId: input.returnLocationId, notes: 'Retirada de equipamento (O.S)' },
        { isAdmin: true, skipOntLinkGuard: true },
      );
    }
    const ont = await this.prisma.ont.findFirst({ where: { tenantId, contractId } });
    if (ont) {
      const olt = await this.prisma.olt.findFirst({ where: { id: ont.oltId, tenantId } });
      if (olt) {
        if (olt.vendor === 'UFINET' && olt.providerMode === 'ORCHESTRATOR') {
          try {
            await this.ufinet.requestTeardown(tenantId, contractId, actorUserId);
          } catch (err) {
            this.logger.warn(
              `[retrieval] ufinet teardown falhou: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        } else {
          try {
            const ctx = buildConnectionContext(olt, this.crypto);
            await this.drivers
              .resolve(olt.vendor, olt.providerMode)
              .deauthorizeOnt(ctx, ont.snGpon);
          } catch (err) {
            this.logger.warn(
              `[retrieval] deauthorize falhou: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
      await this.prisma.tr069Device.deleteMany({ where: { tenantId, ontId: ont.id } });
    }
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'provisioning.deprovision',
      resource: 'contracts',
      resourceId: contractId,
      metadata: { returned: allocated.length },
    });
    return { status: 'OK', returned: allocated.length };
  }

  /**
   * Desfaz uma instalação feita errada (ONT/cliente/SN errado) — volta o
   * contrato pra PENDING_INSTALL pra reinstalar do zero, SEM cancelar o
   * contrato. Reusa deprovision (devolve comodato + desautoriza OLT/Ufinet +
   * apaga o device TR-069), apaga a Ont row e remove o identificador do RADIUS.
   * Só funciona em contrato ACTIVE.
   */
  async deactivateInstall(
    tenantId: string,
    actorUserId: string,
    contractId: string,
    input: { returnLocationId: string },
  ): Promise<{ status: 'OK' }> {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, tenantId, deletedAt: null },
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado');
    if (contract.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Só dá pra desfazer a instalação de um contrato ATIVO. Pra outros casos use ' +
          'a O.S de retirada ou o cancelamento.',
      );
    }

    // 1. Desfaz a parte física (comodato + OLT/Ufinet + device TR-069).
    await this.deprovision(tenantId, actorUserId, contractId, {
      returnLocationId: input.returnLocationId,
    });

    // 2. Apaga a Ont row (a instalação vai ser refeita do zero).
    const ont = await this.prisma.ont.findFirst({ where: { tenantId, contractId } });
    if (ont) {
      await this.prisma.ont.delete({ where: { id: ont.id } }).catch(() => undefined);
    }

    // 3. Contrato volta pra fila de instalação.
    const updated = await this.prisma.contract.update({
      where: { id: contractId },
      data: {
        status: 'PENDING_INSTALL',
        activatedAt: null,
        updatedById: actorUserId,
      },
    });

    // 4. RADIUS: remove o identificador (contrato não está mais ACTIVE).
    try {
      await this.radius.enqueueDisconnect(updated, 'instalação desfeita');
      await this.radius.enqueueSync(updated, 'instalação desfeita');
    } catch (err) {
      this.logger.warn(
        `[deactivate] RADIUS cleanup falhou pra ${contractId} — reconciler corrige em ≤5min: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'provisioning.install_undone',
      resource: 'contracts',
      resourceId: contractId,
      afterState: { status: 'PENDING_INSTALL' },
    });
    return { status: 'OK' };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async persistEvent(opts: {
    tenantId: string;
    contractId: string | null;
    ontId: string | null;
    oltId: string | null;
    action: ProvisioningEventAction;
    status: ProvisioningEventStatus;
    payload?: Prisma.JsonValue;
    error?: string | null;
    durationMs?: number;
    actorUserId?: string;
  }): Promise<void> {
    await this.prisma.provisioningEvent.create({
      data: {
        tenantId: opts.tenantId,
        contractId: opts.contractId,
        ontId: opts.ontId,
        oltId: opts.oltId,
        action: opts.action,
        status: opts.status,
        payload: (opts.payload ?? null) as Prisma.InputJsonValue,
        error: opts.error ?? null,
        durationMs: opts.durationMs ?? null,
        actorUserId: opts.actorUserId ?? null,
        actorKind: opts.actorUserId ? 'user' : 'system',
      },
    });
  }
}

/** Sanity helper pra type narrowing em Olt sem expor o tipo Prisma. */
export type OltDbRow = Olt;

import { Injectable, Logger } from '@nestjs/common';

import type { BrPaymentGateway } from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';

/** Chave do TenantSetting que guarda o gateway BR padrão do tenant. */
const GATEWAY_SETTING_KEY = 'finance.br.gateway';

/** Emissor de cobrança de um gateway — registrado pelo módulo do gateway no boot. */
export type GatewayEmitter = (
  tenantId: string,
  actor: string,
  invoiceId: string,
) => Promise<unknown>;

/**
 * Dispatcher de cobrança BR — roteia a emissão de uma fatura para o gateway
 * escolhido NO CONTRATO (MANUAL | EFI | BTG). Ponto único que faz a fatura
 * "nascer" no gateway, chamado pelos criadores de fatura (manual + ativação) e
 * pelos crons de autogen (rede de segurança).
 *
 * INVERSÃO DE DEPENDÊNCIA (de propósito): este service NÃO importa EFI/BTG —
 * eles importam o ContractsModule (registerGatewayPayment), então importá-los
 * aqui fecharia um ciclo de DI. Em vez disso, cada módulo de gateway registra
 * seu emissor no boot via `register()`. Assim o BrBillingModule fica folha
 * (só Prisma) e o grafo de DI/imports fica acíclico.
 *
 * Extensível: gateway novo = registra seu emissor + 1 valor no enum.
 */
@Injectable()
export class BrBillingService {
  private readonly logger = new Logger(BrBillingService.name);
  private readonly emitters = new Map<string, GatewayEmitter>();

  constructor(private readonly prisma: PrismaService) {}

  /** EFI/BTG registram seu emissor no OnModuleInit (evita ciclo de imports). */
  register(gateway: 'EFI' | 'BTG', emitter: GatewayEmitter): void {
    this.emitters.set(gateway, emitter);
  }

  /** Gateway BR padrão do tenant — pré-preenche o contrato novo. MANUAL se ausente. */
  async defaultGateway(tenantId: string): Promise<BrPaymentGateway> {
    const row = await this.prisma.tenantSetting.findUnique({
      where: { tenantId_key: { tenantId, key: GATEWAY_SETTING_KEY } },
    });
    const v = typeof row?.value === 'string' ? row.value : undefined;
    return v === 'EFI' || v === 'BTG' || v === 'MANUAL' ? v : 'MANUAL';
  }

  /** Define o gateway BR padrão do tenant (usado nas configs). */
  async setDefaultGateway(tenantId: string, gateway: BrPaymentGateway): Promise<void> {
    await this.prisma.tenantSetting.upsert({
      where: { tenantId_key: { tenantId, key: GATEWAY_SETTING_KEY } },
      create: { tenantId, key: GATEWAY_SETTING_KEY, value: gateway },
      update: { value: gateway },
    });
  }

  /**
   * Emite a fatura no gateway do contrato — "na hora". MANUAL = no-op.
   * NUNCA lança: qualquer falha (gateway não configurado, API fora) vira log e
   * o cron de autogen reprocessa. Assim a fatura nasce mesmo se o gateway falhar.
   */
  async emitForInvoice(
    tenantId: string,
    actor: string,
    invoiceId: string,
    gateway: BrPaymentGateway,
  ): Promise<void> {
    if (gateway === 'MANUAL') return;
    const emit = this.emitters.get(gateway);
    if (!emit) {
      this.logger.warn(
        `Gateway ${gateway} sem emissor registrado — fatura ${invoiceId} não emitida`,
      );
      return;
    }
    try {
      await emit(tenantId, actor, invoiceId);
    } catch (e) {
      this.logger.warn(
        `emitForInvoice falhou (gateway=${gateway} invoice=${invoiceId}): ` +
          `${e instanceof Error ? e.message : String(e)} — cron de autogen reprocessa`,
      );
    }
  }
}

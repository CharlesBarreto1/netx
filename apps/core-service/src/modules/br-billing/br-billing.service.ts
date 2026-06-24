import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import type { BrPaymentGateway } from '@netx/shared';

import { BtgChargesService } from '../btg/btg-charges.service';
import { EfiChargesService } from '../efi/efi-charges.service';
import { PrismaService } from '../prisma/prisma.service';

/** Chave do TenantSetting que guarda o gateway BR padrão do tenant. */
const GATEWAY_SETTING_KEY = 'finance.br.gateway';

/**
 * Dispatcher de cobrança BR — roteia a emissão de uma fatura para o gateway
 * escolhido NO CONTRATO (MANUAL | EFI | BTG). Ponto único que faz a fatura
 * "nascer" no gateway, chamado pelos criadores de fatura (manual + cron de
 * geração) e pelo cron de autogen (rede de segurança).
 *
 * Resolve os charges services via ModuleRef lazy (`strict:false`) DE PROPÓSITO:
 * EfiModule/BtgModule já importam o ContractsModule (pra dar baixa via
 * registerGatewayPayment). Se este service os injetasse no construtor, fecharia
 * um ciclo de DI. Resolvendo sob demanda, o grafo de DI fica acíclico
 * (ContractInvoices/InvoiceGenerator → BrBilling → Prisma/ModuleRef).
 *
 * Extensível: gateway novo = +1 case em `emitForInvoice` + 1 valor no enum.
 */
@Injectable()
export class BrBillingService {
  private readonly logger = new Logger(BrBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleRef: ModuleRef,
  ) {}

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
    try {
      if (gateway === 'EFI') {
        await this.moduleRef
          .get(EfiChargesService, { strict: false })
          .createForInvoice(tenantId, actor, invoiceId, {});
      } else if (gateway === 'BTG') {
        await this.moduleRef
          .get(BtgChargesService, { strict: false })
          .createForInvoice(tenantId, actor, invoiceId, {});
      }
    } catch (e) {
      this.logger.warn(
        `emitForInvoice falhou (gateway=${gateway} invoice=${invoiceId}): ` +
          `${e instanceof Error ? e.message : String(e)} — cron de autogen reprocessa`,
      );
    }
  }
}

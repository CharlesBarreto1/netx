import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Desbloqueio em confiança — autoatendimento do cliente bloqueado por atraso.
 * Concede um prazo curto (TRUST_UNLOCK_DAYS) limitado por fatura em aberto
 * (TRUST_UNLOCK_MAX_PER_INVOICE). Enquanto vigente, o heartbeat trata o
 * licenciado como ACTIVE apesar da inadimplência.
 */
@Injectable()
export class TrustUnlockService {
  private readonly logger = new Logger(TrustUnlockService.name);

  constructor(private readonly prisma: PrismaService) {}

  private days(): number {
    return Number(process.env.TRUST_UNLOCK_DAYS ?? 3);
  }
  private maxPerInvoice(): number {
    return Number(process.env.TRUST_UNLOCK_MAX_PER_INVOICE ?? 1);
  }

  /** Quanto resta de cota e se há desbloqueio vigente — pra UI da central. */
  async status(licenseeId: string): Promise<{
    active: boolean;
    grantedUntil: string | null;
    remaining: number;
    days: number;
  }> {
    const now = new Date();
    const current = await this.prisma.trustUnlock.findFirst({
      where: { licenseeId, grantedUntil: { gt: now } },
      orderBy: { grantedUntil: 'desc' },
    });
    const target = await this.firstOverdue(licenseeId);
    const used = target
      ? await this.prisma.trustUnlock.count({ where: { invoiceId: target.id } })
      : 0;
    return {
      active: !!current,
      grantedUntil: current?.grantedUntil.toISOString() ?? null,
      remaining: Math.max(0, this.maxPerInvoice() - used),
      days: this.days(),
    };
  }

  /** Concede um desbloqueio em confiança (chamado pela central). */
  async grant(licenseeId: string, grantedBy?: string): Promise<{ grantedUntil: string }> {
    const target = await this.firstOverdue(licenseeId);
    if (!target) {
      throw new BadRequestException('Nenhuma fatura em atraso — desbloqueio não é necessário.');
    }
    const used = await this.prisma.trustUnlock.count({ where: { invoiceId: target.id } });
    if (used >= this.maxPerInvoice()) {
      throw new ConflictException(
        'Limite de desbloqueios em confiança desta fatura atingido. Regularize o pagamento.',
      );
    }
    const grantedUntil = new Date(Date.now() + this.days() * 86400 * 1000);
    await this.prisma.trustUnlock.create({
      data: { licenseeId, invoiceId: target.id, grantedUntil, grantedBy: grantedBy ?? null },
    });
    this.logger.log(`Trust-unlock concedido a ${licenseeId} até ${grantedUntil.toISOString()}`);
    return { grantedUntil: grantedUntil.toISOString() };
  }

  /** Fatura mais antiga em atraso (alvo do desbloqueio). */
  private async firstOverdue(licenseeId: string) {
    const graceDays = Number(process.env.LICENSE_GRACE_DAYS ?? 2);
    const cutoff = new Date(Date.now() - graceDays * 86400 * 1000);
    return this.prisma.invoice.findFirst({
      where: {
        licenseeId,
        OR: [{ status: 'OVERDUE' }, { status: 'OPEN', dueDate: { lt: cutoff } }],
      },
      orderBy: { dueDate: 'asc' },
      select: { id: true },
    });
  }
}

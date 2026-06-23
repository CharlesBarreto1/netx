import { Injectable, UnauthorizedException } from '@nestjs/common';

import { BillingService } from '../billing/billing.service';
import { TrustUnlockService } from '../billing/trust-unlock.service';
import { verifyPassword } from '../common/password';
import { signPortalJwt } from '../common/jwt';
import { PaymentProvider } from '../payments/payment.provider';
import { PrismaService } from '../prisma/prisma.service';

/** Lógica da central do cliente (ISP logado). */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly trust: TrustUnlockService,
    private readonly payments: PaymentProvider,
  ) {}

  async login(email: string, password: string): Promise<{ token: string }> {
    const user = await this.prisma.hubUser.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException('e-mail ou senha inválidos');
    }
    await this.prisma.hubUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    return {
      token: signPortalJwt({ sub: user.id, lid: user.licenseeId, email: user.email }),
    };
  }

  /** Resumo da central: dados do cliente, plano, situação (em dia/atraso). */
  async me(licenseeId: string) {
    const lic = await this.prisma.licensee.findUnique({
      where: { id: licenseeId },
      include: {
        instances: {
          select: {
            id: true,
            label: true,
            status: true,
            lastVersion: true,
            lastActiveContracts: true,
            lastHeartbeatAt: true,
          },
        },
      },
    });
    if (!lic) throw new UnauthorizedException('licenciado não encontrado');
    const delinquent = await this.billing.isDelinquent(licenseeId);
    const trust = await this.trust.status(licenseeId);
    return {
      licensee: {
        id: lic.id,
        name: lic.name,
        taxId: lic.taxId,
        plan: lic.plan,
        currency: lic.currency,
        pricePerContractCents: lic.pricePerContractCents,
        billingDay: lic.billingDay,
        contactEmail: lic.contactEmail,
        phone: lic.phone,
      },
      instances: lic.instances,
      delinquent,
      trustUnlock: trust,
    };
  }

  async invoices(licenseeId: string) {
    const rows = await this.prisma.invoice.findMany({
      where: { licenseeId },
      orderBy: { periodStart: 'desc' },
    });
    return rows.map((i) => ({
      id: i.id,
      periodStart: i.periodStart.toISOString().slice(0, 10),
      periodEnd: i.periodEnd.toISOString().slice(0, 10),
      activeContracts: i.activeContracts,
      unitPriceCents: i.unitPriceCents,
      amountCents: i.amountCents,
      currency: i.currency,
      dueDate: i.dueDate.toISOString().slice(0, 10),
      status: i.status,
      paidAt: i.paidAt?.toISOString() ?? null,
      paymentMethod: i.paymentMethod,
    }));
  }

  async grantTrustUnlock(licenseeId: string, email: string) {
    return this.trust.grant(licenseeId, email);
  }

  /** Inicia pagamento Pix de uma fatura (EFI). */
  async pay(licenseeId: string, invoiceId: string, method: 'PIX' | 'CARD') {
    const inv = await this.prisma.invoice.findFirst({ where: { id: invoiceId, licenseeId } });
    if (!inv) throw new UnauthorizedException('fatura não encontrada');
    return this.payments.createPixCharge(invoiceId, method);
  }
}

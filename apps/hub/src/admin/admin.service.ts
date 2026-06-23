import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { BillingService } from '../billing/billing.service';
import { generateLicenseKey, sha256Hex } from '../common/hash';
import { hashPassword } from '../common/password';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateHubUser,
  CreateInstance,
  LicenseeData,
  MarkPaid,
  SetStatus,
  UpdateLicensee,
} from './admin.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  // ── Licenciados ───────────────────────────────────────────────────────────
  createLicensee(input: LicenseeData) {
    return this.prisma.licensee.create({ data: input });
  }

  async updateLicensee(id: string, input: UpdateLicensee) {
    const exists = await this.prisma.licensee.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Licenciado não encontrado');
    return this.prisma.licensee.update({ where: { id }, data: input });
  }

  getLicensee(id: string) {
    return this.prisma.licensee.findUnique({
      where: { id },
      include: { instances: true, users: { select: { id: true, email: true, name: true, isActive: true, lastLoginAt: true } } },
    });
  }

  listLicensees() {
    return this.prisma.licensee.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { instances: true } } },
    });
  }

  // ── Usuários da central ─────────────────────────────────────────────────────
  async createHubUser(input: CreateHubUser) {
    const lic = await this.prisma.licensee.findUnique({ where: { id: input.licenseeId } });
    if (!lic) throw new NotFoundException('Licenciado não encontrado');
    const email = input.email.toLowerCase();
    const dupe = await this.prisma.hubUser.findUnique({ where: { email } });
    if (dupe) throw new ConflictException('E-mail já cadastrado');
    const user = await this.prisma.hubUser.create({
      data: {
        licenseeId: input.licenseeId,
        email,
        name: input.name ?? null,
        passwordHash: hashPassword(input.password),
      },
    });
    return { id: user.id, email: user.email };
  }

  // ── Faturas ──────────────────────────────────────────────────────────────────
  listInvoices(licenseeId?: string) {
    return this.prisma.invoice.findMany({
      where: licenseeId ? { licenseeId } : {},
      orderBy: { issuedAt: 'desc' },
      include: { licensee: { select: { id: true, name: true } } },
    });
  }

  /** Gera (ou retorna) a fatura do mês anterior pra um licenciado — sob demanda. */
  async generateInvoiceNow(licenseeId: string) {
    const lic = await this.prisma.licensee.findUnique({ where: { id: licenseeId } });
    if (!lic) throw new NotFoundException('Licenciado não encontrado');
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    return this.billing.generateInvoice(lic, periodStart, periodEnd);
  }

  async markInvoicePaid(invoiceId: string, input: MarkPaid) {
    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundException('Fatura não encontrada');
    await this.billing.markPaid(invoiceId, input);
    return { id: invoiceId, status: 'PAID' };
  }

  // ── Instâncias ──────────────────────────────────────────────────────────────
  /**
   * Cria a instância e devolve a license key EM CLARO uma única vez (só o hash
   * é persistido). Essa key vai pro NETX_LICENSE_KEY do cliente.
   */
  async createInstance(input: CreateInstance): Promise<{
    instanceId: string;
    licenseKey: string;
    hubHint: string;
  }> {
    const licensee = await this.prisma.licensee.findUnique({
      where: { id: input.licenseeId },
    });
    if (!licensee) throw new NotFoundException('Licenciado não encontrado');

    const existing = await this.prisma.instance.findUnique({ where: { id: input.instanceId } });
    if (existing) throw new ConflictException('Instância (instanceId) já cadastrada');

    const licenseKey = generateLicenseKey();
    await this.prisma.instance.create({
      data: {
        id: input.instanceId,
        licenseeId: input.licenseeId,
        label: input.label ?? null,
        blockMode: input.blockMode,
        keyHash: sha256Hex(licenseKey),
        status: 'ACTIVE',
      },
    });
    return {
      instanceId: input.instanceId,
      licenseKey,
      hubHint: 'Configure NETX_HUB_URL + NETX_LICENSE_KEY + NETX_INSTANCE_ID no .env do cliente.',
    };
  }

  /** Lista instâncias com telemetria do último heartbeat (pro painel). */
  listInstances() {
    return this.prisma.instance.findMany({
      orderBy: { lastHeartbeatAt: { sort: 'desc', nulls: 'last' } },
      select: {
        id: true,
        label: true,
        status: true,
        blockMode: true,
        lastVersion: true,
        lastActiveContracts: true,
        lastHeartbeatAt: true,
        lastIp: true,
        createdAt: true,
        licensee: { select: { id: true, name: true, plan: true, maxContracts: true } },
      },
    });
  }

  async setStatus(instanceId: string, input: SetStatus) {
    const inst = await this.prisma.instance.findUnique({ where: { id: instanceId } });
    if (!inst) throw new NotFoundException('Instância não encontrada');
    return this.prisma.instance.update({
      where: { id: instanceId },
      data: { status: input.status },
      select: { id: true, status: true },
    });
  }

  /** Re-emite a license key (rotação/perda). Devolve a nova em claro 1x. */
  async rotateKey(instanceId: string): Promise<{ instanceId: string; licenseKey: string }> {
    const inst = await this.prisma.instance.findUnique({ where: { id: instanceId } });
    if (!inst) throw new NotFoundException('Instância não encontrada');
    const licenseKey = generateLicenseKey();
    await this.prisma.instance.update({
      where: { id: instanceId },
      data: { keyHash: sha256Hex(licenseKey) },
    });
    return { instanceId, licenseKey };
  }
}

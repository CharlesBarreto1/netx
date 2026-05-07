import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import { EvolutionClient } from './evolution.client';

export interface CreateInstanceInput {
  name: string;
  evolutionUrl?: string;
  apiKey: string;
  instanceName: string; // nome interno no Evolution (sem espaços)
}

/**
 * CRUD + lifecycle das instâncias WhatsApp (sessões Evolution).
 *
 * Lifecycle típico:
 *   1. POST /v1/whatsapp/instances        — cria registro NetX + chama Evolution
 *      Evolution devolve QR code (base64) que persistimos.
 *   2. Admin escaneia o QR no celular do número da ISP.
 *   3. Webhook CONNECTION_UPDATE com state=open atualiza status pra CONNECTED.
 *   4. Mensagens começam a fluir.
 *
 * Ao deletar uma instância, fazemos delete remoto no Evolution (apaga sessão)
 * e deletamos o registro local. Conversas/mensagens caem por cascade.
 *
 * NOTA: o webhook URL é montado a partir de env `WEBHOOK_BASE_URL` quando
 * disponível, fallback localhost (modo single-host installer).
 */
@Injectable()
export class WhatsappInstancesService {
  private readonly logger = new Logger(WhatsappInstancesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly evolution: EvolutionClient,
  ) {}

  /**
   * URL pública pra Evolution entregar webhooks. Em prod single-host (modelo
   * NetX padrão), Evolution roda em localhost:8080 e fala com NetX em
   * localhost também — não precisa HTTPS público porque é loopback.
   */
  private webhookUrl(): string {
    const base = process.env.WEBHOOK_BASE_URL ?? 'http://localhost:3101';
    return `${base.replace(/\/$/, '')}/v1/webhooks/evolution`;
  }

  async list(tenantId: string) {
    return this.prisma.whatsappInstance.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        instanceName: true,
        evolutionUrl: true,
        phoneE164: true,
        status: true,
        active: true,
        connectedAt: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
        // Não expor apiKey nem webhookSecret na listagem
      },
    });
  }

  async findById(tenantId: string, id: string) {
    const inst = await this.prisma.whatsappInstance.findFirst({
      where: { id, tenantId },
    });
    if (!inst) throw new NotFoundException('Instância WhatsApp não encontrada');
    return inst;
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateInstanceInput,
  ) {
    const evolutionUrl = (input.evolutionUrl ?? 'http://localhost:8080').trim();
    const instanceName = input.instanceName.trim().replace(/\s+/g, '-').toLowerCase();
    if (!instanceName) throw new BadRequestException('instanceName inválido');

    // Idempotência: se já existe pelo nome interno, devolvemos a existente
    const existing = await this.prisma.whatsappInstance.findUnique({
      where: { tenantId_instanceName: { tenantId, instanceName } },
    });
    if (existing) {
      throw new BadRequestException('Instância com esse nome interno já existe');
    }

    const webhookSecret = randomBytes(24).toString('base64url');

    let qrCode: string | null = null;
    try {
      const res = await this.evolution.createInstance(
        evolutionUrl,
        input.apiKey,
        instanceName,
        this.webhookUrl(),
        webhookSecret,
      );
      qrCode = res.qrcode?.base64 ?? null;
    } catch (e) {
      this.logger.error(`Falha ao criar instância no Evolution: ${(e as Error).message}`);
      throw new BadRequestException(
        `Não foi possível criar instância no Evolution: ${(e as Error).message}`,
      );
    }

    const inst = await this.prisma.whatsappInstance.create({
      data: {
        tenantId,
        name: input.name.trim(),
        evolutionUrl,
        apiKey: input.apiKey, // TODO: criptografar at-rest com KMS quando disponível
        instanceName,
        webhookSecret,
        status: 'CONNECTING',
        qrCode,
      },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'whatsapp.instance.create',
      resource: 'whatsapp_instance',
      resourceId: inst.id,
    });

    return inst;
  }

  async refreshQr(tenantId: string, actorUserId: string, id: string) {
    const inst = await this.findById(tenantId, id);
    let res;
    try {
      res = await this.evolution.connect(inst.evolutionUrl, inst.apiKey, inst.instanceName);
    } catch (e) {
      throw new BadRequestException(`Evolution: ${(e as Error).message}`);
    }
    const updated = await this.prisma.whatsappInstance.update({
      where: { id },
      data: {
        qrCode: res.qrcode?.base64 ?? null,
        status: res.state === 'open' ? 'CONNECTED' : 'CONNECTING',
        lastError: null,
      },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'whatsapp.instance.refresh_qr',
      resource: 'whatsapp_instance',
      resourceId: id,
    });
    return updated;
  }

  async logout(tenantId: string, actorUserId: string, id: string) {
    const inst = await this.findById(tenantId, id);
    try {
      await this.evolution.logout(inst.evolutionUrl, inst.apiKey, inst.instanceName);
    } catch (e) {
      // não-fatal: já pode estar desconectada
      this.logger.warn(`Evolution logout falhou: ${(e as Error).message}`);
    }
    const updated = await this.prisma.whatsappInstance.update({
      where: { id },
      data: { status: 'DISCONNECTED', qrCode: null, connectedAt: null },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'whatsapp.instance.logout',
      resource: 'whatsapp_instance',
      resourceId: id,
    });
    return updated;
  }

  async remove(tenantId: string, actorUserId: string, id: string) {
    const inst = await this.findById(tenantId, id);
    try {
      await this.evolution.deleteInstance(inst.evolutionUrl, inst.apiKey, inst.instanceName);
    } catch (e) {
      this.logger.warn(`Evolution delete falhou: ${(e as Error).message}`);
    }
    await this.prisma.whatsappInstance.delete({ where: { id } });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'whatsapp.instance.delete',
      resource: 'whatsapp_instance',
      resourceId: id,
    });
  }

  // -- Acesso interno (usado pelo webhook handler e pelo conversations service)

  async findByInstanceName(instanceName: string) {
    return this.prisma.whatsappInstance.findFirst({
      where: { instanceName },
    });
  }

  async findActiveForTenant(tenantId: string) {
    return this.prisma.whatsappInstance.findFirst({
      where: { tenantId, active: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateConnectionState(
    instanceName: string,
    state: 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING' | 'ERROR',
    extra: { phoneE164?: string | null; qrCode?: string | null; lastError?: string | null } = {},
  ) {
    const inst = await this.findByInstanceName(instanceName);
    if (!inst) return null;
    return this.prisma.whatsappInstance.update({
      where: { id: inst.id },
      data: {
        status: state,
        ...(state === 'CONNECTED' ? { connectedAt: new Date(), qrCode: null } : {}),
        ...(extra.phoneE164 !== undefined ? { phoneE164: extra.phoneE164 } : {}),
        ...(extra.qrCode !== undefined ? { qrCode: extra.qrCode } : {}),
        ...(extra.lastError !== undefined ? { lastError: extra.lastError } : {}),
      },
    });
  }
}

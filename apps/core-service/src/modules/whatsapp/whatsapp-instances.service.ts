import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { WaChannel } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';

import { ChannelProviderFactory } from './providers/channel-provider.factory';
import { WhatsappCredentials } from './providers/whatsapp-credentials';

export interface CreateInstanceInput {
  name: string;
  channel?: WaChannel;
  instanceName: string; // nome interno (sem espaços)
  // --- WAHA ---
  evolutionUrl?: string; // base URL do WAHA
  apiKey?: string; // X-Api-Key do WAHA
  // --- Meta Cloud ---
  wabaId?: string;
  phoneNumberId?: string;
  accessToken?: string;
  appSecret?: string;
  verifyToken?: string;
}

/** Campos seguros pra retornar ao admin — NUNCA expõe segredos. */
const PUBLIC_SELECT = {
  id: true,
  name: true,
  channel: true,
  instanceName: true,
  evolutionUrl: true,
  phoneE164: true,
  status: true,
  active: true,
  connectedAt: true,
  lastError: true,
  wabaId: true,
  phoneNumberId: true,
  qrCode: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * CRUD + lifecycle das instâncias WhatsApp, agnóstico de canal.
 *
 * Canal WAHA (QR): create chama o provider, que cria a sessão e devolve QR;
 * o webhook session.status marca CONNECTED ao escanear.
 * Canal META_CLOUD (oficial): create valida o token via Graph API; se válido,
 * já marca CONNECTED (não há QR/sessão).
 *
 * Segredos (apiKey WAHA, accessToken/appSecret Meta) são cifrados at-rest com
 * CryptoService. A decifragem mora só no WhatsappCredentials.
 */
@Injectable()
export class WhatsappInstancesService {
  private readonly logger = new Logger(WhatsappInstancesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly factory: ChannelProviderFactory,
    private readonly creds: WhatsappCredentials,
  ) {}

  /** URL pública pra o provider entregar webhooks. */
  private webhookUrl(channel: WaChannel): string {
    const base = process.env.WEBHOOK_BASE_URL ?? 'http://localhost:3101';
    const path = channel === 'META_CLOUD' ? '/v1/webhooks/meta' : '/v1/webhooks/waha';
    return `${base.replace(/\/$/, '')}${path}`;
  }

  async list(tenantId: string) {
    return this.prisma.whatsappInstance.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: PUBLIC_SELECT,
    });
  }

  /** Detalhe seguro (sem segredos) — uso do painel admin. */
  async findById(tenantId: string, id: string) {
    const inst = await this.prisma.whatsappInstance.findFirst({
      where: { id, tenantId },
      select: PUBLIC_SELECT,
    });
    if (!inst) throw new NotFoundException('Instância WhatsApp não encontrada');
    return inst;
  }

  /** Registro CRU (com segredos) — uso interno (providers/webhook). */
  private async findRaw(tenantId: string, id: string) {
    const inst = await this.prisma.whatsappInstance.findFirst({ where: { id, tenantId } });
    if (!inst) throw new NotFoundException('Instância WhatsApp não encontrada');
    return inst;
  }

  async create(tenantId: string, actorUserId: string, input: CreateInstanceInput) {
    const channel: WaChannel = input.channel ?? 'WAHA';
    const instanceName = input.instanceName.trim().replace(/\s+/g, '-').toLowerCase();
    if (!instanceName) throw new BadRequestException('instanceName inválido');

    const existing = await this.prisma.whatsappInstance.findUnique({
      where: { tenantId_instanceName: { tenantId, instanceName } },
    });
    if (existing) throw new BadRequestException('Instância com esse nome interno já existe');

    const webhookSecret = randomBytes(24).toString('base64url');

    return channel === 'META_CLOUD'
      ? this.createMeta(tenantId, actorUserId, input, instanceName, webhookSecret)
      : this.createWaha(tenantId, actorUserId, input, instanceName, webhookSecret);
  }

  private async createWaha(
    tenantId: string,
    actorUserId: string,
    input: CreateInstanceInput,
    instanceName: string,
    webhookSecret: string,
  ) {
    const evolutionUrl = (input.evolutionUrl ?? 'http://localhost:3010').trim();
    if (!input.apiKey) throw new BadRequestException('apiKey (X-Api-Key do WAHA) é obrigatório');

    // Persiste primeiro (cifrado), depois cria a sessão remota e guarda o QR.
    const inst = await this.prisma.whatsappInstance.create({
      data: {
        tenantId,
        channel: 'WAHA',
        name: input.name.trim(),
        evolutionUrl,
        apiKey: this.crypto.encrypt(input.apiKey),
        instanceName,
        webhookSecret,
        status: 'CONNECTING',
      },
    });

    try {
      const conn = await this.factory
        .for('WAHA')
        .createSession(this.creds.decrypt(inst), this.webhookUrl('WAHA'));
      await this.prisma.whatsappInstance.update({
        where: { id: inst.id },
        data: {
          qrCode: conn.qrCode ?? null,
          status: conn.state === 'CONNECTED' ? 'CONNECTED' : 'CONNECTING',
        },
      });
    } catch (e) {
      await this.prisma.whatsappInstance.update({
        where: { id: inst.id },
        data: { status: 'ERROR', lastError: (e as Error).message },
      });
      this.logger.error(`Falha ao criar sessão WAHA: ${(e as Error).message}`);
      throw new BadRequestException(`Não foi possível criar sessão no WAHA: ${(e as Error).message}`);
    }

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'whatsapp.instance.create',
      resource: 'whatsapp_instance',
      resourceId: inst.id,
      metadata: { channel: 'WAHA' },
    });
    return this.findById(tenantId, inst.id);
  }

  private async createMeta(
    tenantId: string,
    actorUserId: string,
    input: CreateInstanceInput,
    instanceName: string,
    webhookSecret: string,
  ) {
    if (!input.phoneNumberId || !input.accessToken || !input.appSecret) {
      throw new BadRequestException('Meta Cloud exige phoneNumberId, accessToken e appSecret');
    }
    const verifyToken = input.verifyToken?.trim() || randomBytes(18).toString('base64url');

    const inst = await this.prisma.whatsappInstance.create({
      data: {
        tenantId,
        channel: 'META_CLOUD',
        name: input.name.trim(),
        evolutionUrl: 'https://graph.facebook.com',
        apiKey: this.crypto.encrypt(input.accessToken), // espelho do token (coluna NOT NULL)
        instanceName,
        webhookSecret,
        wabaId: input.wabaId?.trim() || null,
        phoneNumberId: input.phoneNumberId.trim(),
        verifyToken,
        apiCredentialsEnc: this.crypto.encrypt(
          JSON.stringify({ accessToken: input.accessToken, appSecret: input.appSecret }),
        ),
        status: 'CONNECTING',
      },
    });

    // Valida o token chamando a Graph API; se ok, marca CONNECTED (sem QR).
    try {
      const conn = await this.factory.for('META_CLOUD').connectionState(this.creds.decrypt(inst));
      await this.prisma.whatsappInstance.update({
        where: { id: inst.id },
        data: {
          status: conn.state,
          phoneE164: conn.phoneE164 ?? null,
          connectedAt: conn.state === 'CONNECTED' ? new Date() : null,
          lastError: conn.state === 'ERROR' ? 'Token Meta inválido ou sem permissão' : null,
        },
      });
    } catch (e) {
      await this.prisma.whatsappInstance.update({
        where: { id: inst.id },
        data: { status: 'ERROR', lastError: (e as Error).message },
      });
    }

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'whatsapp.instance.create',
      resource: 'whatsapp_instance',
      resourceId: inst.id,
      metadata: { channel: 'META_CLOUD', phoneNumberId: input.phoneNumberId },
    });
    return this.findById(tenantId, inst.id);
  }

  async refreshQr(tenantId: string, actorUserId: string, id: string) {
    const inst = await this.findRaw(tenantId, id);
    try {
      const conn = await this.factory.for(inst.channel).getQr(this.creds.decrypt(inst));
      await this.prisma.whatsappInstance.update({
        where: { id },
        data: {
          qrCode: conn.qrCode ?? null,
          status: conn.state,
          ...(conn.phoneE164 ? { phoneE164: conn.phoneE164 } : {}),
          lastError: null,
        },
      });
    } catch (e) {
      throw new BadRequestException(`Falha ao atualizar conexão: ${(e as Error).message}`);
    }
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'whatsapp.instance.refresh_qr',
      resource: 'whatsapp_instance',
      resourceId: id,
    });
    return this.findById(tenantId, id);
  }

  async logout(tenantId: string, actorUserId: string, id: string) {
    const inst = await this.findRaw(tenantId, id);
    try {
      await this.factory.for(inst.channel).logout(this.creds.decrypt(inst));
    } catch (e) {
      this.logger.warn(`logout falhou: ${(e as Error).message}`);
    }
    await this.prisma.whatsappInstance.update({
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
    return this.findById(tenantId, id);
  }

  async remove(tenantId: string, actorUserId: string, id: string) {
    const inst = await this.findRaw(tenantId, id);
    try {
      await this.factory.for(inst.channel).deleteSession(this.creds.decrypt(inst));
    } catch (e) {
      this.logger.warn(`deleteSession falhou: ${(e as Error).message}`);
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

  // -- acesso interno (webhook handlers / conversations) --

  /** Linha crua por instanceName (canal WAHA). */
  async findByInstanceName(instanceName: string) {
    return this.prisma.whatsappInstance.findFirst({ where: { instanceName } });
  }

  /** Linha crua por phoneNumberId (roteamento do webhook Meta POST). */
  async findByPhoneNumberId(phoneNumberId: string) {
    return this.prisma.whatsappInstance.findFirst({
      where: { phoneNumberId, channel: 'META_CLOUD' },
    });
  }

  /** Linha crua por verifyToken (verificação GET do webhook Meta). */
  async findByVerifyToken(verifyToken: string) {
    return this.prisma.whatsappInstance.findFirst({
      where: { verifyToken, channel: 'META_CLOUD' },
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

  /** Decifra uma instância (uso dos webhook controllers). */
  decrypt(inst: Parameters<WhatsappCredentials['decrypt']>[0]) {
    return this.creds.decrypt(inst);
  }
}

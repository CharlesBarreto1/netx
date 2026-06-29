import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma, type WaChannel } from '@prisma/client';

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

/**
 * Edição parcial. Todo campo é opcional; segredos em branco mantêm o atual.
 * `captureGroups` continua aqui pra compat com o toggle de grupos.
 */
export interface UpdateInstanceInput {
  name?: string;
  captureGroups?: boolean;
  // --- Meta Cloud ---
  wabaId?: string | null;
  phoneNumberId?: string;
  accessToken?: string;
  appSecret?: string;
  verifyToken?: string;
  // --- WAHA ---
  evolutionUrl?: string;
  apiKey?: string;
}

/** Mensagem de erro p/ o painel: usa o motivo real da Graph API se houver. */
function metaError(conn: { error?: string | null }): string {
  return conn.error?.trim() || 'Token Meta inválido ou sem permissão';
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
  captureGroups: true,
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
    const rows = await this.prisma.whatsappInstance.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
    // Refresh ao vivo das instâncias WAHA que estão conectando: assim o QR
    // aparece e o status vira CONNECTED no próprio polling da tela (sem
    // depender só do webhook). Best-effort — falha não derruba a listagem.
    await Promise.all(
      rows.map(async (r, i) => {
        if (r.channel !== 'WAHA' || r.status !== 'CONNECTING') return;
        try {
          const conn = await this.factory.for('WAHA').getQr(this.creds.decrypt(r));
          rows[i] = await this.prisma.whatsappInstance.update({
            where: { id: r.id },
            data: {
              status: conn.state,
              qrCode: conn.state === 'CONNECTED' ? null : conn.qrCode ?? r.qrCode,
              ...(conn.phoneE164 ? { phoneE164: conn.phoneE164 } : {}),
              ...(conn.state === 'CONNECTED' ? { connectedAt: new Date() } : {}),
            },
          });
        } catch {
          /* WAHA offline/instável — mantém o estado atual */
        }
      }),
    );
    return rows.map((r) => this.toPublic(r));
  }

  /** Projeção pública (sem segredos) de uma linha crua. */
  private toPublic(r: { [k: string]: unknown }) {
    return Object.fromEntries(
      Object.keys(PUBLIC_SELECT).map((k) => [k, r[k]]),
    ) as Record<string, unknown>;
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
    // URL e X-Api-Key do WAHA são config do SERVIDOR (env), não digitadas por
    // instância. Provisionadas pelo installer (WAHA_URL / WHATSAPP_API_KEY).
    // input.* só sobrescreve em casos especiais (ex.: WAHA externo).
    const evolutionUrl = (input.evolutionUrl ?? process.env.WAHA_URL ?? 'http://localhost:3010').trim();
    const apiKey = input.apiKey ?? process.env.WHATSAPP_API_KEY;
    if (!apiKey) {
      throw new BadRequestException(
        'WAHA não configurado no servidor (WHATSAPP_API_KEY ausente). Provisione o WAHA antes de criar a instância.',
      );
    }

    // Persiste primeiro (cifrado), depois cria a sessão remota e guarda o QR.
    const inst = await this.prisma.whatsappInstance.create({
      data: {
        tenantId,
        channel: 'WAHA',
        name: input.name.trim(),
        evolutionUrl,
        apiKey: this.crypto.encrypt(apiKey),
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
          lastError: conn.state === 'ERROR' ? metaError(conn) : null,
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

  /**
   * Edição da instância (admin). Permite corrigir nome + identificadores/segredos
   * do canal sem apagar e recriar. Segredos em branco MANTÊM o valor atual
   * (mescla com as creds decifradas). Se mexer em algo que afeta a conexão,
   * revalida na hora (Meta: token via Graph API).
   */
  async update(tenantId: string, actorUserId: string, id: string, input: UpdateInstanceInput) {
    const inst = await this.findRaw(tenantId, id);
    const data: Prisma.WhatsappInstanceUpdateInput = {};
    let connectionAffected = false;

    if (input.name !== undefined) data.name = input.name.trim();
    if (input.captureGroups !== undefined) data.captureGroups = input.captureGroups;

    if (inst.channel === 'META_CLOUD') {
      if (input.phoneNumberId !== undefined && input.phoneNumberId.trim()) {
        data.phoneNumberId = input.phoneNumberId.trim();
        connectionAffected = true;
      }
      if (input.wabaId !== undefined) data.wabaId = input.wabaId?.trim() || null;
      if (input.verifyToken !== undefined && input.verifyToken.trim()) {
        data.verifyToken = input.verifyToken.trim();
      }
      // accessToken/appSecret: branco = mantém. Recifra o JSON mesclado.
      const newToken = input.accessToken?.trim();
      const newSecret = input.appSecret?.trim();
      if (newToken || newSecret) {
        const cur = this.creds.decrypt(inst);
        const accessToken = newToken || cur.accessToken || '';
        const appSecret = newSecret || cur.appSecret || '';
        data.apiCredentialsEnc = this.crypto.encrypt(JSON.stringify({ accessToken, appSecret }));
        if (newToken) data.apiKey = this.crypto.encrypt(accessToken); // espelho (coluna NOT NULL)
        connectionAffected = true;
      }
    } else {
      // WAHA
      if (input.evolutionUrl !== undefined && input.evolutionUrl.trim()) {
        data.evolutionUrl = input.evolutionUrl.trim();
      }
      if (input.apiKey !== undefined && input.apiKey.trim()) {
        data.apiKey = this.crypto.encrypt(input.apiKey.trim());
      }
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Nenhum campo para atualizar');
    }

    const updated = await this.prisma.whatsappInstance.update({ where: { id }, data });

    // Revalida só o canal oficial: connectionState valida o token na Graph API.
    // (WAHA depende de QR/sessão — use "Reconectar" após mudar URL/chave.)
    if (connectionAffected && updated.channel === 'META_CLOUD') {
      try {
        const conn = await this.factory.for('META_CLOUD').connectionState(this.creds.decrypt(updated));
        await this.prisma.whatsappInstance.update({
          where: { id },
          data: {
            status: conn.state,
            phoneE164: conn.phoneE164 ?? updated.phoneE164,
            connectedAt: conn.state === 'CONNECTED' ? new Date() : null,
            lastError: conn.state === 'ERROR' ? metaError(conn) : null,
          },
        });
      } catch (e) {
        await this.prisma.whatsappInstance.update({
          where: { id },
          data: { status: 'ERROR', lastError: (e as Error).message },
        });
      }
    }

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'whatsapp.instance.update',
      resource: 'whatsapp_instance',
      resourceId: id,
      metadata: { channel: inst.channel, fields: Object.keys(data) },
    });
    return this.findById(tenantId, id);
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

  /**
   * Lista os grupos da conta conectada (WAHA/QR). Aproveita pra atualizar o
   * assunto dos grupos que já viraram conversa e marca quais estão capturados.
   */
  async listGroups(tenantId: string, id: string) {
    const inst = await this.findRaw(tenantId, id);
    const provider = this.factory.for(inst.channel);
    if (!provider.listGroups) {
      throw new BadRequestException('Este canal não expõe grupos (disponível apenas no WAHA/QR).');
    }
    let groups;
    try {
      groups = await provider.listGroups(this.creds.decrypt(inst));
    } catch (e) {
      throw new BadRequestException(`Não foi possível listar grupos: ${(e as Error).message}`);
    }

    // Mantém o assunto atualizado nos grupos que já têm contato/conversa.
    await Promise.all(
      groups
        .filter((g) => g.subject)
        .map((g) =>
          this.prisma.whatsappContact.updateMany({
            where: { tenantId, waGroupId: g.id },
            data: { pushName: g.subject as string },
          }),
        ),
    );

    const captured = await this.prisma.whatsappContact.findMany({
      where: { tenantId, isGroup: true, waGroupId: { in: groups.map((g) => g.id) } },
      select: { waGroupId: true },
    });
    const capturedSet = new Set(captured.map((c) => c.waGroupId));

    return {
      captureGroups: inst.captureGroups,
      groups: groups.map((g) => ({ ...g, captured: capturedSet.has(g.id) })),
    };
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

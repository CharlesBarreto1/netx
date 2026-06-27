import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import { MetaCloudProvider, type MetaTemplate } from './providers/meta-cloud.provider';
import { WhatsappCredentials } from './providers/whatsapp-credentials';

/**
 * Catálogo de templates HSM (canal META_CLOUD). Sincroniza da Graph API
 * (GET /{wabaId}/message_templates) e serve a lista de aprovados pro front
 * montar o picker fora da janela de 24h.
 */
@Injectable()
export class WhatsappTemplatesService {
  private readonly logger = new Logger(WhatsappTemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly meta: MetaCloudProvider,
    private readonly creds: WhatsappCredentials,
  ) {}

  /** Lista templates do tenant (default: só aprovados, pro picker). */
  async list(tenantId: string, onlyApproved = true) {
    return this.prisma.whatsappTemplate.findMany({
      where: { tenantId, ...(onlyApproved ? { status: 'APPROVED' } : {}) },
      orderBy: [{ name: 'asc' }, { language: 'asc' }],
    });
  }

  /** Sincroniza o catálogo a partir da WABA da instância Meta. */
  async sync(tenantId: string, actorUserId: string, instanceId: string) {
    const inst = await this.prisma.whatsappInstance.findFirst({
      where: { id: instanceId, tenantId },
    });
    if (!inst) throw new NotFoundException('Instância não encontrada');
    if (inst.channel !== 'META_CLOUD') {
      throw new BadRequestException('Sync de templates só no canal oficial Meta.');
    }

    let remote: MetaTemplate[];
    try {
      remote = await this.meta.listRemoteTemplates(this.creds.decrypt(inst));
    } catch (e) {
      throw new BadRequestException(`Falha ao sincronizar templates: ${(e as Error).message}`);
    }

    let upserts = 0;
    for (const t of remote) {
      if (!t?.name || !t?.language) continue;
      await this.prisma.whatsappTemplate.upsert({
        where: { tenantId_name_language: { tenantId, name: t.name, language: t.language } },
        create: {
          tenantId,
          instanceId,
          name: t.name,
          language: t.language,
          category: t.category ?? 'UTILITY',
          status: t.status ?? 'PENDING',
          bodyText: extractBody(t.components),
          components: (t.components ?? null) as never,
          metaTemplateId: t.id ?? null,
        },
        update: {
          category: t.category ?? 'UTILITY',
          status: t.status ?? 'PENDING',
          bodyText: extractBody(t.components),
          components: (t.components ?? null) as never,
          metaTemplateId: t.id ?? null,
          instanceId,
        },
      });
      upserts++;
    }

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'whatsapp.templates.sync',
      resource: 'whatsapp_instance',
      resourceId: instanceId,
      metadata: { count: upserts },
    });

    return { synced: upserts };
  }
}

/** Extrai o texto do componente BODY (preview com {{1}}). */
function extractBody(components: unknown): string | null {
  if (!Array.isArray(components)) return null;
  const body = components.find(
    (c) => c && typeof c === 'object' && (c as { type?: string }).type?.toUpperCase() === 'BODY',
  ) as { text?: string } | undefined;
  return body?.text ?? null;
}

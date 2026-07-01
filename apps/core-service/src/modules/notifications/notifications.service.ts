import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { NotificationsEventsBus } from './notifications.events';

/** Payload pra criar uma notificação. `type`/`icon` livres (o front mapeia). */
export interface NotifyInput {
  tenantId: string;
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  href?: string | null;
  icon?: string | null;
  /** Contexto livre do emissor (serializado como JSON). */
  data?: unknown;
}

/**
 * Centro de notificações do NetX. Ponto de entrada ENGATÁVEL: qualquer módulo
 * injeta este service (o módulo é @Global) e chama `notify()` pra avisar um
 * usuário — chat (menções), tarefas, alarmes do NMS, etc.
 *
 *   constructor(private readonly notifications: NotificationsService) {}
 *   await this.notifications.notify({ tenantId, userId, type: 'nms.alarm',
 *     title: 'OLT-3 caiu', href: '/nms/devices/123', icon: 'alarm' });
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: NotificationsEventsBus,
  ) {}

  /** Cria e empurra uma notificação pra UM usuário. Não-fatal pro chamador. */
  async notify(input: NotifyInput) {
    const n = await this.prisma.notification.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        href: input.href ?? null,
        icon: input.icon ?? null,
        data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    this.bus.emit({ type: 'notification.created', tenantId: input.tenantId, userId: input.userId, payload: n });
    return n;
  }

  /** Dispara a MESMA notificação pra vários usuários (ex.: todos do NOC). */
  async notifyMany(userIds: string[], base: Omit<NotifyInput, 'userId'>) {
    const unique = Array.from(new Set(userIds)).filter(Boolean);
    const results = await Promise.all(
      unique.map((userId) =>
        this.notify({ ...base, userId }).catch((e) => {
          this.logger.warn(`Falha ao notificar ${userId}: ${(e as Error).message}`);
          return null;
        }),
      ),
    );
    return results.filter((n) => n !== null);
  }

  /** Últimas notificações do usuário + total não-lidas (pro sino). */
  async list(tenantId: string, userId: string, limit = 30) {
    const [items, unread] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where: { tenantId, userId },
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 100),
      }),
      this.prisma.notification.count({ where: { tenantId, userId, readAt: null } }),
    ]);
    return { items, unread };
  }

  async unreadCount(tenantId: string, userId: string) {
    const unread = await this.prisma.notification.count({
      where: { tenantId, userId, readAt: null },
    });
    return { unread };
  }

  /** Marca uma como lida (idempotente — só as não-lidas). */
  async markRead(tenantId: string, userId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, tenantId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    this.bus.emit({ type: 'notification.read', tenantId, userId, payload: { id } });
    return this.unreadCount(tenantId, userId);
  }

  async markAllRead(tenantId: string, userId: string) {
    await this.prisma.notification.updateMany({
      where: { tenantId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    this.bus.emit({ type: 'notification.read', tenantId, userId, payload: { all: true } });
    return { unread: 0 };
  }

  /** Remove uma (some da lista). */
  async clear(tenantId: string, userId: string, id: string) {
    await this.prisma.notification.deleteMany({ where: { id, tenantId, userId } });
    this.bus.emit({ type: 'notification.cleared', tenantId, userId, payload: { id } });
    return this.unreadCount(tenantId, userId);
  }

  /** Limpa TODAS do usuário (o sino some). */
  async clearAll(tenantId: string, userId: string) {
    await this.prisma.notification.deleteMany({ where: { tenantId, userId } });
    this.bus.emit({ type: 'notification.cleared', tenantId, userId, payload: { all: true } });
    return { unread: 0 };
  }
}

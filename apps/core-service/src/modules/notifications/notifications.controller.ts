import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Observable, filter, interval, map, merge } from 'rxjs';
import { z } from 'zod';

import type { AuthenticatedPrincipal } from '@netx/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';

import { NotificationsEventsBus } from './notifications.events';
import { NotificationsService } from './notifications.service';

// Disparo cross-app (alarmes NMS, tarefas): cria notificação pra um usuário do
// mesmo tenant. Só quem tem notifications.dispatch pode. Módulos in-process
// usam NotificationsService.notify() direto (sem passar por aqui).
const DispatchBodySchema = z.object({
  userId: z.string().uuid(),
  type: z.string().min(1).max(60),
  title: z.string().min(1).max(200),
  body: z.string().max(4000).optional(),
  href: z.string().max(500).optional(),
  icon: z.string().max(40).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});
type DispatchBody = z.infer<typeof DispatchBodySchema>;

/**
 * Centro de notificações — sino global do NetX.
 *
 * Rotas "self" (qualquer autenticado, escopo = próprio usuário):
 *   GET    /v1/notifications                — lista + total não-lidas
 *   GET    /v1/notifications/unread-count   — só o contador (poll leve)
 *   POST   /v1/notifications/read-all       — marca todas lidas
 *   POST   /v1/notifications/:id/read       — marca uma lida
 *   DELETE /v1/notifications/:id            — remove uma
 *   DELETE /v1/notifications                — limpa todas (sino some)
 *   GET    /v1/notifications/stream         — SSE realtime (EventSource)
 *
 * Rota de disparo (permissão notifications.dispatch):
 *   POST   /v1/notifications/dispatch       — cria pra outro usuário
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly events: NotificationsEventsBus,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.notifications.list(user.tenantId, user.sub);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.notifications.unreadCount(user.tenantId, user.sub);
  }

  @Post('read-all')
  readAll(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.notifications.markAllRead(user.tenantId, user.sub);
  }

  /** Disparo cross-app: cria uma notificação pra outro usuário do tenant. */
  @Post('dispatch')
  @RequirePermissions('notifications.dispatch')
  dispatch(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(DispatchBodySchema) body: DispatchBody,
  ) {
    return this.notifications.notify({
      tenantId: user.tenantId,
      userId: body.userId,
      type: body.type,
      title: body.title,
      body: body.body,
      href: body.href,
      icon: body.icon,
      data: body.data as Record<string, unknown> | undefined,
    });
  }

  @Post(':id/read')
  markRead(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notifications.markRead(user.tenantId, user.sub, id);
  }

  @Delete(':id')
  clear(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notifications.clear(user.tenantId, user.sub, id);
  }

  @Delete()
  clearAll(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.notifications.clearAll(user.tenantId, user.sub);
  }

  /**
   * SSE realtime do próprio usuário. Filtra por (tenantId, userId) — notificação
   * é 1:1, sem vazamento cross-user. Heartbeat a cada 25s mantém a conexão viva.
   */
  @Sse('stream')
  stream(@CurrentUser() user: AuthenticatedPrincipal): Observable<MessageEvent> {
    const { tenantId, sub: userId } = user;
    const events$ = this.events.subject.asObservable().pipe(
      filter((e) => e.tenantId === tenantId && e.userId === userId),
      map((e) => ({ type: e.type, data: JSON.stringify({ type: e.type, payload: e.payload }) })),
    );
    const heartbeat$: Observable<MessageEvent> = interval(25_000).pipe(
      map(() => ({ type: 'ping', data: '{}' })),
    );
    return merge(events$, heartbeat$);
  }
}

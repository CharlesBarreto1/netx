import { Injectable, Logger } from '@nestjs/common';
import { Subject } from 'rxjs';

export type NotificationEventType =
  | 'notification.created'
  | 'notification.read'
  | 'notification.cleared';

export interface NotificationEvent {
  type: NotificationEventType;
  tenantId: string;
  /** Destinatário — o SSE filtra por este userId (notificação é 1:1). */
  userId: string;
  payload: unknown;
}

/**
 * Event bus em memória pra empurrar notificações às conexões SSE abertas do
 * usuário (sino global). Single-host, igual ao WhatsappEventsBus — multi-host
 * precisaria Redis pub/sub. YAGNI por ora.
 */
@Injectable()
export class NotificationsEventsBus {
  private readonly logger = new Logger(NotificationsEventsBus.name);
  readonly subject = new Subject<NotificationEvent>();

  emit(event: NotificationEvent) {
    this.logger.debug(`emit ${event.type} user=${event.userId}`);
    this.subject.next(event);
  }
}

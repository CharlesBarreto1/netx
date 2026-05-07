import { Injectable, Logger } from '@nestjs/common';
import { Subject } from 'rxjs';

export type WaEventType =
  | 'message.created'
  | 'message.updated'
  | 'conversation.created'
  | 'conversation.updated'
  | 'conversation.assigned'
  | 'conversation.resolved'
  | 'instance.updated';

export interface WaEvent {
  type: WaEventType;
  tenantId: string;
  payload: unknown;
}

/**
 * Event bus em memória pra distribuir eventos do WhatsApp pra todas as
 * conexões SSE abertas. Cada controller SSE assina o `subject` e filtra
 * por tenantId antes de enviar pro cliente.
 *
 * Esse design serve pra single-host (NetX padrão). Em multi-instância
 * (escala futura) precisaria de Redis pub/sub. Por enquanto YAGNI.
 */
@Injectable()
export class WhatsappEventsBus {
  private readonly logger = new Logger(WhatsappEventsBus.name);
  readonly subject = new Subject<WaEvent>();

  emit(event: WaEvent) {
    this.logger.debug(`emit ${event.type} tenant=${event.tenantId}`);
    this.subject.next(event);
  }
}

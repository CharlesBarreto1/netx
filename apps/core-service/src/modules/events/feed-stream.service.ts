import { Injectable } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';

/** Formato MessageEvent do @Sse do Nest. */
export interface SseEvent {
  type: string;
  data: string;
}

interface FeedMessage {
  tenantId: string;
  type: string;
  data: unknown;
}

/**
 * FeedStream — fan-out in-process do "feed" de eventos pro cliente (NEXUS no web
 * + copiloto do NetX Field). Um handler do bus AMQP publica aqui; o endpoint SSE
 * GET /v1/events/stream assina filtrando por tenant.
 *
 * Single-host, igual a AlarmStream/WhatsappEventsBus — multi-instância exigiria
 * Redis pub/sub (YAGNI por ora). Produtores in-process também podem chamar
 * publish() direto (sempre-ligado), independente do bus AMQP estar habilitado.
 */
@Injectable()
export class FeedStream {
  private readonly subject = new Subject<FeedMessage>();

  publish(tenantId: string, type: string, data: unknown): void {
    this.subject.next({ tenantId, type, data });
  }

  forTenant(tenantId: string): Observable<SseEvent> {
    return this.subject.asObservable().pipe(
      filter((m) => m.tenantId === tenantId),
      map((m) => ({ type: m.type, data: JSON.stringify(m.data) })),
    );
  }
}

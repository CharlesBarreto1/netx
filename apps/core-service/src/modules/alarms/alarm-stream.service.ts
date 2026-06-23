/**
 * AlarmStream — barramento in-process (RxJS) para real-time (Fase 3). O
 * correlator publica updates de incident e o coletor publica up/down por ONT;
 * o endpoint SSE (/v1/alarms/stream) assina filtrando pelo tenant. Leve, sem
 * WebSocket/broker — serve o painel e a tela "caixa ao vivo" do mobile.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { Injectable } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';

export type AlarmStreamType = 'incident' | 'ont';

interface AlarmStreamMessage {
  tenantId: string;
  type: AlarmStreamType;
  data: unknown;
}

/** Formato MessageEvent do @Sse do Nest. */
export interface SseEvent {
  type: string;
  data: string;
}

@Injectable()
export class AlarmStream {
  private readonly subject = new Subject<AlarmStreamMessage>();

  publish(tenantId: string, type: AlarmStreamType, data: unknown): void {
    this.subject.next({ tenantId, type, data });
  }

  /** Stream SSE filtrado pelo tenant (eventos `incident` e `ont`). */
  forTenant(tenantId: string): Observable<SseEvent> {
    return this.subject.asObservable().pipe(
      filter((m) => m.tenantId === tenantId),
      map((m) => ({ type: m.type, data: JSON.stringify(m.data) })),
    );
  }
}

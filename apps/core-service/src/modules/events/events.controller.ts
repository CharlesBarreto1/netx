/**
 * EventsController — SSE tenant-scoped do feed de eventos (NEXUS web + copiloto
 * do NetX Field). Autenticado por JWT; como EventSource não seta header, a auth
 * vai por ?access_token= (JwtStrategy já extrai da query). Reachable via gateway
 * em /api/v1/events/stream (o proxy detecta text/event-stream e faz streaming).
 */
import { Controller, Sse } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { interval, map, merge, type Observable } from 'rxjs';

import type { AuthenticatedPrincipal } from '@netx/shared';

import { CurrentUser } from '../../common/decorators';

import { FeedStream, type SseEvent } from './feed-stream.service';

@ApiTags('events')
@ApiBearerAuth()
@Controller('events')
export class EventsController {
  constructor(private readonly feed: FeedStream) {}

  /** Stream do feed do tenant + heartbeat de 25s (mantém a conexão viva no proxy). */
  @Sse('stream')
  stream(@CurrentUser() user: AuthenticatedPrincipal): Observable<SseEvent> {
    const events$ = this.feed.forTenant(user.tenantId);
    const heartbeat$: Observable<SseEvent> = interval(25_000).pipe(
      map(() => ({ type: 'ping', data: '{}' })),
    );
    return merge(events$, heartbeat$);
  }
}

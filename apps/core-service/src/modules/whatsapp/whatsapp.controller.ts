import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Observable, filter, map } from 'rxjs';

import type { AuthenticatedPrincipal } from '@netx/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';

import { WhatsappConversationsService, type InboxFilter } from './whatsapp-conversations.service';
import { WhatsappEventsBus } from './whatsapp-events.bus';

const MEDIA_ROOT = process.env.WHATSAPP_MEDIA_ROOT ?? '/var/lib/netx/whatsapp/media';

interface AssignBody {
  userId: string | null;
}
interface SendBody {
  text: string;
}

/**
 * Endpoints HTTP do módulo WhatsApp/Atendimento.
 *
 * Rotas:
 *   GET    /v1/whatsapp/conversations                — inbox (filter=mine|unassigned|all|resolved)
 *   GET    /v1/whatsapp/conversations/:id            — detalhe + mensagens (auditoria implícita)
 *   POST   /v1/whatsapp/conversations/:id/assign     — atribui/transfere
 *   POST   /v1/whatsapp/conversations/:id/resolve    — fecha
 *   POST   /v1/whatsapp/conversations/:id/messages   — envia texto
 *   GET    /v1/whatsapp/stream                       — SSE realtime (EventSource)
 *   GET    /v1/whatsapp/media/:filename              — serve mídia local
 */
@ApiTags('whatsapp')
@ApiBearerAuth()
@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly conversations: WhatsappConversationsService,
    private readonly events: WhatsappEventsBus,
  ) {}

  // ----- conversations -----

  @Get('conversations')
  @RequirePermissions('chat.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query('filter') filterParam?: string,
  ) {
    const f: InboxFilter =
      filterParam === 'unassigned' || filterParam === 'all' ||
      filterParam === 'resolved' || filterParam === 'mine'
        ? filterParam
        : 'mine';
    return this.conversations.list(user.tenantId, user.sub, f);
  }

  @Get('conversations/:id')
  @RequirePermissions('chat.read')
  findOne(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const canAudit = user.permissions.includes('chat.audit');
    return this.conversations.findById(user.tenantId, user.sub, canAudit, id);
  }

  @Post('conversations/:id/assign')
  @RequirePermissions('chat.assign')
  assign(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AssignBody,
  ) {
    return this.conversations.assign(user.tenantId, user.sub, id, body.userId);
  }

  @Post('conversations/:id/resolve')
  @RequirePermissions('chat.assign')
  resolve(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.conversations.resolve(user.tenantId, user.sub, id);
  }

  @Post('conversations/:id/messages')
  @RequirePermissions('chat.send')
  send(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SendBody,
  ) {
    if (!body?.text || typeof body.text !== 'string' || body.text.trim().length === 0) {
      throw new BadRequestException('texto obrigatório');
    }
    return this.conversations.sendText(user.tenantId, user.sub, id, body.text.trim());
  }

  // ----- realtime SSE -----

  /**
   * Stream de eventos em tempo real, escopado pelo tenant do user.
   *
   * Cliente abre `new EventSource('/v1/whatsapp/stream')` e ouve eventos:
   *   - message.created
   *   - message.updated
   *   - conversation.updated
   *   - conversation.assigned
   *   - conversation.resolved
   *   - instance.updated
   *
   * Filtra eventos pelo tenantId do JWT — sem vazamento cross-tenant.
   * Conexão fica viva enquanto o cliente mantiver o EventSource aberto;
   * pino-http já loga 200 com tempo aberto = duração da subscrição.
   */
  @Sse('stream')
  @RequirePermissions('chat.read')
  stream(@CurrentUser() user: AuthenticatedPrincipal): Observable<MessageEvent> {
    const tenantId = user.tenantId;
    return this.events.subject.asObservable().pipe(
      filter((e) => e.tenantId === tenantId),
      map((e) => ({
        type: e.type,
        data: JSON.stringify({ type: e.type, payload: e.payload }),
      })),
    );
  }

  // ----- media (servir mídia baixada) -----

  /**
   * Serve mídia baixada do WhatsApp. Path tradicional, com whitelist
   * implícita: filename precisa ser do tipo `<msgId>.<ext>` (sem path
   * traversal). Permission chat.read é suficiente — quem pode ver a
   * conversa pode ver a mídia dela.
   */
  @Get('media/:filename')
  @RequirePermissions('chat.read')
  async media(
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    if (filename.includes('/') || filename.includes('..') || filename.includes('\\')) {
      throw new BadRequestException('Filename inválido');
    }
    const path = join(MEDIA_ROOT, filename);
    let buf: Buffer;
    try {
      buf = await fs.readFile(path);
    } catch {
      throw new BadRequestException('Mídia não encontrada');
    }
    const ext = filename.split('.').pop() ?? 'bin';
    const mime: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      mp4: 'video/mp4',
      ogg: 'audio/ogg',
      mp3: 'audio/mpeg',
      pdf: 'application/pdf',
    };
    res.setHeader('Content-Type', mime[ext] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buf);
  }
}

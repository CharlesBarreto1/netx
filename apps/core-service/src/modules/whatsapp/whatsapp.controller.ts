import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  Sse,
  MessageEvent,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Observable, filter, interval, map, merge } from 'rxjs';
import { z } from 'zod';

import type { AuthenticatedPrincipal } from '@netx/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { RequiresModule } from '../licensing/license.decorators';

import { WhatsappBillingRemindersService } from './whatsapp-billing-reminders.service';
import { WhatsappConversationsService, type InboxFilter } from './whatsapp-conversations.service';
import { WhatsappEventsBus } from './whatsapp-events.bus';
import { WhatsappPresenceService } from './whatsapp-presence.service';
import { WhatsappQuickRepliesService } from './whatsapp-quick-replies.service';

const MEDIA_ROOT = process.env.WHATSAPP_MEDIA_ROOT ?? '/var/lib/netx/whatsapp/media';

// Schemas inline pros endpoints. Antes eram TS interfaces (não-validadas
// pelo ValidationPipe). Agora passam por ZodBody → garante shape + tamanhos.
const AssignBodySchema = z.object({
  userId: z.string().uuid().nullable(),
});
type AssignBody = z.infer<typeof AssignBodySchema>;

const SendBodySchema = z.object({
  // WhatsApp text limit: 4096 chars (oficial). Min 1 (não-vazio após trim).
  text: z.string().trim().min(1).max(4096),
  // Menções internas (@operador) — userIds acionados na mensagem (só grupos).
  mentions: z.array(z.string().uuid()).max(20).optional(),
});
type SendBody = z.infer<typeof SendBodySchema>;

// Heartbeat de presença: informa a conversa aberta agora (ou null).
const PresenceBodySchema = z.object({
  conversationId: z.string().uuid().nullable().optional(),
});
type PresenceBody = z.infer<typeof PresenceBodySchema>;

const SendTemplateBodySchema = z.object({
  templateName: z.string().min(1).max(120),
  language: z.string().min(2).max(10),
  variables: z.array(z.string().max(1024)).max(20).optional(),
  // Texto renderizado pra exibir no inbox (preview com as variáveis aplicadas).
  previewBody: z.string().max(4096).optional(),
});
type SendTemplateBody = z.infer<typeof SendTemplateBodySchema>;

// Envio outbound por TELEFONE (sem conversa prévia): cobrança, 1ª abordagem.
const OutboundTemplateBodySchema = z.object({
  phoneE164: z.string().min(8).max(20),
  templateName: z.string().min(1).max(120),
  language: z.string().min(2).max(10),
  variables: z.array(z.string().max(1024)).max(20).optional(),
  name: z.string().max(120).optional(),
  previewBody: z.string().max(4096).optional(),
});
type OutboundTemplateBody = z.infer<typeof OutboundTemplateBodySchema>;

// Disparo manual do lembrete de cobrança (teste). dryRun só loga.
const BillingRunBodySchema = z.object({
  dryRun: z.boolean().optional(),
});
type BillingRunBody = z.infer<typeof BillingRunBodySchema>;

// Config-mestre da régua de cobrança (liga/desliga + modo teste).
const BillingConfigBodySchema = z.object({
  enabled: z.boolean().optional(),
  testRecipient: z.string().trim().max(20).nullable().optional(),
});
type BillingConfigBody = z.infer<typeof BillingConfigBodySchema>;

// Regra da régua: quando/qual template/canal disparar.
const BillingRuleCreateSchema = z.object({
  enabled: z.boolean().optional(),
  label: z.string().trim().max(120).nullable().optional(),
  offsetDays: z.number().int().min(-60).max(60),
  channel: z.string().min(1).max(30),
  templateName: z.string().trim().min(1).max(120),
  language: z.string().trim().min(2).max(10).optional(),
  instanceId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});
type BillingRuleCreate = z.infer<typeof BillingRuleCreateSchema>;

const BillingRuleUpdateSchema = BillingRuleCreateSchema.partial();
type BillingRuleUpdate = z.infer<typeof BillingRuleUpdateSchema>;

// Preferências do operador no chat (self-service).
const AgentSettingsBodySchema = z.object({
  greeting: z.string().max(1000).optional(),
  showName: z.boolean().optional(),
});
type AgentSettingsBody = z.infer<typeof AgentSettingsBodySchema>;

// Respostas rápidas (mensagens predefinidas): saudações, encerramentos, etc.
const QuickReplyCreateSchema = z.object({
  scope: z.enum(['shared', 'personal']),
  category: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4096),
  shortcut: z.string().trim().max(40).optional().nullable(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});
type QuickReplyCreate = z.infer<typeof QuickReplyCreateSchema>;

const QuickReplyUpdateSchema = QuickReplyCreateSchema.partial();
type QuickReplyUpdate = z.infer<typeof QuickReplyUpdateSchema>;

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
@RequiresModule('netx-call')
@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly conversations: WhatsappConversationsService,
    private readonly events: WhatsappEventsBus,
    private readonly billing: WhatsappBillingRemindersService,
    private readonly quickReplies: WhatsappQuickRepliesService,
    private readonly presence: WhatsappPresenceService,
  ) {}

  // ----- outbound por telefone (sem conversa prévia) -----

  /** Dispara um template HSM para um número (cria/reusa conversa). */
  @Post('outbound/template')
  @RequirePermissions('chat.send')
  outboundTemplate(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(OutboundTemplateBodySchema) body: OutboundTemplateBody,
  ) {
    return this.conversations.sendTemplateToPhone(user.tenantId, {
      phoneE164: body.phoneE164,
      templateName: body.templateName,
      language: body.language,
      variables: body.variables,
      name: body.name ?? null,
      previewBody: body.previewBody,
      actor: user.sub,
    });
  }

  /** Roda a régua de cobrança agora (só o tenant do usuário). Respeita o modo teste. */
  @Post('billing/run')
  @RequirePermissions('chat.admin')
  runBilling(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(BillingRunBodySchema) body: BillingRunBody,
  ) {
    return this.billing.runOnce({ dryRun: body.dryRun ?? false, tenantId: user.tenantId });
  }

  // ----- régua de cobrança (config + regras) -----

  @Get('billing/config')
  @RequirePermissions('chat.admin')
  getBillingConfig(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.billing.getConfig(user.tenantId);
  }

  @Put('billing/config')
  @RequirePermissions('chat.admin')
  setBillingConfig(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(BillingConfigBodySchema) body: BillingConfigBody,
  ) {
    return this.billing.setConfig(user.tenantId, body);
  }

  @Post('billing/rules')
  @RequirePermissions('chat.admin')
  createBillingRule(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(BillingRuleCreateSchema) body: BillingRuleCreate,
  ) {
    return this.billing.createRule(user.tenantId, body);
  }

  @Put('billing/rules/:id')
  @RequirePermissions('chat.admin')
  updateBillingRule(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(BillingRuleUpdateSchema) body: BillingRuleUpdate,
  ) {
    return this.billing.updateRule(user.tenantId, id, body);
  }

  @Delete('billing/rules/:id')
  @RequirePermissions('chat.admin')
  deleteBillingRule(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.billing.deleteRule(user.tenantId, id);
  }

  /** Histórico de disparos: cliente, número, canal, status e horário. */
  @Get('billing/logs')
  @RequirePermissions('chat.admin')
  billingLogs(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.billing.listLogs(user.tenantId);
  }

  // ----- preferências do operador (saudação + mostrar nome) -----

  @Get('agent-settings')
  @RequirePermissions('chat.send')
  getAgentSettings(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.conversations.getAgentSettings(user.tenantId, user.sub);
  }

  @Put('agent-settings')
  @RequirePermissions('chat.send')
  setAgentSettings(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(AgentSettingsBodySchema) body: AgentSettingsBody,
  ) {
    return this.conversations.setAgentSettings(user.tenantId, user.sub, body);
  }

  // ----- respostas rápidas (mensagens predefinidas) -----

  /** Lista as respostas visíveis ao operador: compartilhadas + as dele. */
  @Get('quick-replies')
  @RequirePermissions('chat.send')
  listQuickReplies(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.quickReplies.list(user.tenantId, user.sub);
  }

  @Post('quick-replies')
  @RequirePermissions('chat.send')
  createQuickReply(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(QuickReplyCreateSchema) body: QuickReplyCreate,
  ) {
    return this.quickReplies.create(
      user.tenantId,
      user.sub,
      user.permissions.includes('chat.admin'),
      body,
    );
  }

  @Put('quick-replies/:id')
  @RequirePermissions('chat.send')
  updateQuickReply(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(QuickReplyUpdateSchema) body: QuickReplyUpdate,
  ) {
    return this.quickReplies.update(
      user.tenantId,
      user.sub,
      user.permissions.includes('chat.admin'),
      id,
      body,
    );
  }

  @Delete('quick-replies/:id')
  @RequirePermissions('chat.send')
  deleteQuickReply(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.quickReplies.remove(
      user.tenantId,
      user.sub,
      user.permissions.includes('chat.admin'),
      id,
    );
  }

  // ----- conversations -----

  @Get('conversations')
  @RequirePermissions('chat.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query('filter') filterParam?: string,
  ) {
    const valid: InboxFilter[] = [
      'mine', 'unassigned', 'all', 'resolved', 'groups', 'groupsMine', 'andamento', 'espera', 'automacao',
    ];
    const f: InboxFilter =
      filterParam && (valid as string[]).includes(filterParam) ? (filterParam as InboxFilter) : 'mine';
    return this.conversations.list(user.tenantId, user.sub, f);
  }

  // Estático ANTES de :id (senão o ParseUUIDPipe de :id rejeita "counts").
  @Get('conversations/counts')
  @RequirePermissions('chat.read')
  counts(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.conversations.counts(user.tenantId);
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

  @Get('conversations/:id/customer-context')
  @RequirePermissions('chat.read')
  customerContext(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.conversations.customerContext(user.tenantId, id);
  }

  @Get('conversations/:id/messages')
  @RequirePermissions('chat.read')
  olderMessages(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('before') before?: string,
  ) {
    const cursor = before ? new Date(before) : new Date();
    if (Number.isNaN(cursor.getTime())) {
      throw new BadRequestException('Parâmetro "before" inválido (ISO date esperado)');
    }
    const canAudit = user.permissions.includes('chat.audit');
    return this.conversations.messagesBefore(user.tenantId, user.sub, canAudit, id, cursor);
  }

  @Get('agents')
  @RequirePermissions('chat.assign')
  agents(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.conversations.listAgents(user.tenantId);
  }

  @Post('conversations/:id/assign')
  @RequirePermissions('chat.assign')
  assign(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(AssignBodySchema) body: AssignBody,
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

  /** Entra num grupo (atendimento compartilhado do NOC). chat.send basta. */
  @Post('conversations/:id/join')
  @RequirePermissions('chat.send')
  joinGroup(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.conversations.joinGroup(user.tenantId, user.sub, id);
  }

  /** Sai de um grupo (deixa de responder/ser notificado). */
  @Post('conversations/:id/leave')
  @RequirePermissions('chat.send')
  leaveGroup(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.conversations.leaveGroup(user.tenantId, user.sub, id);
  }

  @Post('conversations/:id/messages')
  @RequirePermissions('chat.send')
  send(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(SendBodySchema) body: SendBody,
  ) {
    // Zod já validou min(1) após trim — não precisa re-checar.
    return this.conversations.sendText(user.tenantId, user.sub, id, body.text, body.mentions);
  }

  /** Heartbeat de presença: marca online + informa a conversa aberta. Devolve os online. */
  @Post('presence')
  @RequirePermissions('chat.read')
  presenceBeat(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(PresenceBodySchema) body: PresenceBody,
  ) {
    this.presence.touch(user.tenantId, user.sub, body.conversationId ?? null);
    return { online: this.presence.online(user.tenantId) };
  }

  @Post('conversations/:id/messages/template')
  @RequirePermissions('chat.send')
  sendTemplate(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(SendTemplateBodySchema) body: SendTemplateBody,
  ) {
    return this.conversations.sendTemplate(
      user.tenantId,
      user.sub,
      id,
      { name: body.templateName, language: body.language, variables: body.variables },
      body.previewBody,
    );
  }

  /** Envia uma nota de voz gravada no atendente (upload multipart 'file'). */
  @Post('conversations/:id/messages/audio')
  @RequirePermissions('chat.send')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 16 * 1024 * 1024 } }))
  sendAudio(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Áudio ausente.');
    return this.conversations.sendAudio(user.tenantId, user.sub, id, {
      buffer: file.buffer,
      mimetype: file.mimetype,
    });
  }

  /**
   * Envia uma IMAGEM ou ARQUIVO anexado (upload multipart 'file' + 'caption'
   * opcional). Detecta imagem/vídeo/documento pelo mimetype. Limite 32MB.
   */
  @Post('conversations/:id/messages/media')
  @RequirePermissions('chat.send')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 32 * 1024 * 1024 } }))
  sendMedia(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('caption') caption?: string,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Arquivo ausente.');
    return this.conversations.sendMediaFile(
      user.tenantId,
      user.sub,
      id,
      { buffer: file.buffer, mimetype: file.mimetype, originalName: file.originalname },
      typeof caption === 'string' ? caption : undefined,
    );
  }

  /** Transcreve uma mensagem de áudio (sob demanda, whisper.cpp local). */
  @Post('conversations/:id/messages/:messageId/transcribe')
  @RequirePermissions('chat.read')
  transcribe(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('messageId', new ParseUUIDPipe()) messageId: string,
  ) {
    return this.conversations.transcribeMessage(user.tenantId, id, messageId);
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
    const events$ = this.events.subject.asObservable().pipe(
      filter((e) => e.tenantId === tenantId),
      map((e) => ({
        type: e.type,
        data: JSON.stringify({ type: e.type, payload: e.payload }),
      })),
    );
    // Heartbeat a cada 25s: mantém a conexão viva através dos timeouts de proxy
    // (nginx proxy_read_timeout ~60s, Cloudflare). Evento 'ping' não é ouvido
    // pelo cliente (só os named events conhecidos), então é inofensivo.
    const heartbeat$: Observable<MessageEvent> = interval(25_000).pipe(
      map(() => ({ type: 'ping', data: '{}' })),
    );
    return merge(events$, heartbeat$);
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
      gif: 'image/gif',
      mp4: 'video/mp4',
      ogg: 'audio/ogg',
      mp3: 'audio/mpeg',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      zip: 'application/zip',
      txt: 'text/plain',
    };
    res.setHeader('Content-Type', mime[ext] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buf);
  }
}

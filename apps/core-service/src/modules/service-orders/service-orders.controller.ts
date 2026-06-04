import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import {
  CancelServiceOrderRequestSchema,
  CheckinServiceOrderRequestSchema,
  CompleteFieldRequestSchema,
  CompleteInstallationRequestSchema,
  CompleteServiceOrderRequestSchema,
  CreateServiceOrderMessageRequestSchema,
  CreateServiceOrderRequestSchema,
  EnRouteServiceOrderRequestSchema,
  ListServiceOrdersQuerySchema,
  RegisterServiceOrderAttachmentRequestSchema,
  ReturnToQueueRequestSchema,
  ServiceOrderAttachmentPresignRequestSchema,
  ServiceOrderPhotoPresignRequestSchema,
  StartServiceOrderRequestSchema,
  UpdateServiceOrderRequestSchema,
  type AuthenticatedPrincipal,
  type CancelServiceOrderRequest,
  type CheckinServiceOrderRequest,
  type CompleteFieldRequest,
  type CompleteInstallationRequest,
  type CompleteServiceOrderRequest,
  type CreateServiceOrderMessageRequest,
  type CreateServiceOrderRequest,
  type EnRouteServiceOrderRequest,
  type ListServiceOrdersQuery,
  type RegisterServiceOrderAttachmentRequest,
  type ReturnToQueueRequest,
  type ServiceOrderAttachmentPresignRequest,
  type ServiceOrderPhotoPresignRequest,
  type StartServiceOrderRequest,
  type UpdateServiceOrderRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { ZodQueryPipe } from '../crm/zod-query.pipe';
import { ServiceOrdersService } from './service-orders.service';

@ApiTags('service-orders')
@ApiBearerAuth()
@Controller('service-orders')
export class ServiceOrdersController {
  constructor(private readonly orders: ServiceOrdersService) {}

  @Get()
  @RequirePermissions('service_orders.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListServiceOrdersQuerySchema)) q: ListServiceOrdersQuery,
  ) {
    return this.orders.list(user.tenantId, q);
  }

  @Get(':id')
  @RequirePermissions('service_orders.read')
  findOne(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.orders.findById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('service_orders.write')
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(CreateServiceOrderRequestSchema) body: CreateServiceOrderRequest,
  ) {
    return this.orders.create(user.tenantId, user.sub, body);
  }

  @Patch(':id')
  @RequirePermissions('service_orders.write')
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(UpdateServiceOrderRequestSchema) body: UpdateServiceOrderRequest,
  ) {
    return this.orders.update(user.tenantId, user.sub, id, body);
  }

  @Post(':id/start')
  @RequirePermissions('service_orders.write')
  start(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(StartServiceOrderRequestSchema) body: StartServiceOrderRequest,
  ) {
    return this.orders.start(user.tenantId, user.sub, id, body);
  }

  @Post(':id/complete')
  @RequirePermissions('service_orders.write')
  complete(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(CompleteServiceOrderRequestSchema) body: CompleteServiceOrderRequest,
  ) {
    return this.orders.complete(user.tenantId, user.sub, id, body);
  }

  @Post(':id/cancel')
  @RequirePermissions('service_orders.write')
  cancel(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(CancelServiceOrderRequestSchema) body: CancelServiceOrderRequest,
  ) {
    return this.orders.cancel(user.tenantId, user.sub, id, body);
  }

  // ── Lifecycle de campo (tela /os do técnico) ────────────────────────────
  @Post(':id/en-route')
  @RequirePermissions('service_orders.write')
  enRoute(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(EnRouteServiceOrderRequestSchema) body: EnRouteServiceOrderRequest,
  ) {
    return this.orders.enRoute(user.tenantId, user.sub, id, body);
  }

  @Post(':id/checkin')
  @RequirePermissions('service_orders.write')
  checkin(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(CheckinServiceOrderRequestSchema) body: CheckinServiceOrderRequest,
  ) {
    return this.orders.checkin(user.tenantId, user.sub, id, body);
  }

  /** Aborta deslocamento/execução e devolve a O.S pra fila (não cancela). */
  @Post(':id/return-to-queue')
  @RequirePermissions('service_orders.write')
  returnToQueue(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(ReturnToQueueRequestSchema) body: ReturnToQueueRequest,
  ) {
    return this.orders.returnToQueue(user.tenantId, user.sub, id, body);
  }

  /** Pede URL assinada pra subir foto de campo direto no MinIO. */
  @Post(':id/photos/presign')
  @RequirePermissions('service_orders.write')
  presignPhoto(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(ServiceOrderPhotoPresignRequestSchema) body: ServiceOrderPhotoPresignRequest,
  ) {
    return this.orders.presignPhoto(user.tenantId, id, body);
  }

  // ── Mensagens (thread atendente ↔ técnico) ──────────────────────────────
  @Get(':id/messages')
  @RequirePermissions('service_orders.read')
  listMessages(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.orders.listMessages(user.tenantId, id);
  }

  @Post(':id/messages')
  @RequirePermissions('service_orders.write')
  addMessage(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(CreateServiceOrderMessageRequestSchema) body: CreateServiceOrderMessageRequest,
  ) {
    return this.orders.createMessage(user.tenantId, user.sub, id, body);
  }

  // ── Anexos avulsos ───────────────────────────────────────────────────────
  @Get(':id/attachments')
  @RequirePermissions('service_orders.read')
  listAttachments(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.orders.listAttachments(user.tenantId, id);
  }

  /** Pede URL assinada pra subir um anexo direto no MinIO. */
  @Post(':id/attachments/presign')
  @RequirePermissions('service_orders.write')
  presignAttachment(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(ServiceOrderAttachmentPresignRequestSchema) body: ServiceOrderAttachmentPresignRequest,
  ) {
    return this.orders.presignAttachment(user.tenantId, id, body);
  }

  /** Registra o anexo já enviado ao bucket. */
  @Post(':id/attachments')
  @RequirePermissions('service_orders.write')
  registerAttachment(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(RegisterServiceOrderAttachmentRequestSchema) body: RegisterServiceOrderAttachmentRequest,
  ) {
    return this.orders.registerAttachment(user.tenantId, user.sub, id, body);
  }

  @Delete(':id/attachments/:attachmentId')
  @HttpCode(204)
  @RequirePermissions('service_orders.write')
  async removeAttachment(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
  ): Promise<void> {
    await this.orders.deleteAttachment(user.tenantId, user.sub, id, attachmentId);
  }

  /** ONE-TOUCH: provisiona + estoque + fotos + fecha a O.S numa tacada. */
  @Post(':id/complete-installation')
  @RequirePermissions('provisioning.write')
  completeInstallation(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(CompleteInstallationRequestSchema) body: CompleteInstallationRequest,
  ) {
    return this.orders.completeInstallation(user.tenantId, user.sub, id, body, {
      isAdmin: user.permissions.includes('stock.admin'),
    });
  }

  /**
   * Finalização de campo ramificada por tipo de O.S (instalação / suporte /
   * suporte com troca de ONT / retirada). A tela /os escolhe o `mode`.
   */
  @Post(':id/complete-field')
  @RequirePermissions('service_orders.write')
  completeField(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(CompleteFieldRequestSchema) body: CompleteFieldRequest,
  ) {
    return this.orders.completeField(user.tenantId, user.sub, id, body, {
      isAdmin: user.permissions.includes('stock.admin'),
    });
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('service_orders.delete')
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.orders.remove(user.tenantId, user.sub, id);
  }
}

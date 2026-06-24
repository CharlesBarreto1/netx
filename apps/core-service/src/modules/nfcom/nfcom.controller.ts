/**
 * NfcomController — emissão/consulta/cancelamento de NFCom.
 *
 * Rotas (/v1/nfcom/documents):
 *   GET    /                     nfcom.read
 *   POST   /                     nfcom.emit     (emite a partir de fatura/cobrança)
 *   GET    /:id                  nfcom.read
 *   GET    /:id/xml              nfcom.read     (XML autorizado, text/xml)
 *   POST   /:id/cancel           nfcom.cancel
 *   POST   /:id/substitute       nfcom.emit
 */
import {
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CancelNfcomDocumentRequestSchema,
  EmitNfcomDocumentRequestSchema,
  ListNfcomDocumentsQuerySchema,
  SubstituteNfcomDocumentRequestSchema,
  type AuthenticatedPrincipal,
  type CancelNfcomDocumentRequest,
  type EmitNfcomDocumentRequest,
  type ListNfcomDocumentsQuery,
  type SubstituteNfcomDocumentRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { ZodQueryPipe } from '../crm/zod-query.pipe';
import { NfcomService } from './nfcom.service';

@ApiTags('nfcom')
@ApiBearerAuth()
@Controller('nfcom/documents')
export class NfcomController {
  constructor(private readonly service: NfcomService) {}

  @Get()
  @RequirePermissions('nfcom.read')
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodQueryPipe(ListNfcomDocumentsQuerySchema)) query: ListNfcomDocumentsQuery,
  ) {
    return this.service.list(user.tenantId, query);
  }

  @Post()
  @RequirePermissions('nfcom.emit')
  emit(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(EmitNfcomDocumentRequestSchema) body: EmitNfcomDocumentRequest,
  ) {
    return this.service.emit(user.tenantId, user.sub, body);
  }

  @Get(':id')
  @RequirePermissions('nfcom.read')
  get(@CurrentUser() user: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.service.findById(user.tenantId, id);
  }

  @Get(':id/xml')
  @RequirePermissions('nfcom.read')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  getXml(@CurrentUser() user: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.service.getXml(user.tenantId, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('nfcom.cancel')
  cancel(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id') id: string,
    @ZodBody(CancelNfcomDocumentRequestSchema) body: CancelNfcomDocumentRequest,
  ) {
    return this.service.cancel(user.tenantId, user.sub, id, body);
  }

  @Post(':id/substitute')
  @HttpCode(200)
  @RequirePermissions('nfcom.emit')
  substitute(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id') id: string,
    @ZodBody(SubstituteNfcomDocumentRequestSchema) body: SubstituteNfcomDocumentRequest,
  ) {
    return this.service.substitute(user.tenantId, user.sub, id, body.reason);
  }
}

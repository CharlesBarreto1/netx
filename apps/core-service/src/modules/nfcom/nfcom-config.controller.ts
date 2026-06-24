/**
 * NfcomConfigController — config NFCom + upload de certificado .pfx (A1).
 *
 * Rotas:
 *   GET    /v1/nfcom/config                    nfcom.config
 *   PUT    /v1/nfcom/config                    nfcom.config
 *   POST   /v1/nfcom/config/certificate (file) nfcom.config
 *   DELETE /v1/nfcom/config/certificate        nfcom.config
 *
 * Upload usa Multer (memory storage, max 100KB). Senha vem no form field
 * `password`. Espelha o SifenConfigController.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  UpdateNfcomConfigRequestSchema,
  UploadNfcomCertificateRequestSchema,
  type AuthenticatedPrincipal,
  type UpdateNfcomConfigRequest,
  type UploadNfcomCertificateRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { NfcomConfigService } from './nfcom-config.service';

@ApiTags('nfcom-config')
@ApiBearerAuth()
@Controller('nfcom/config')
export class NfcomConfigController {
  constructor(private readonly configService: NfcomConfigService) {}

  @Get()
  @RequirePermissions('nfcom.config')
  getConfig(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.configService.getConfig(user.tenantId);
  }

  @Put()
  @RequirePermissions('nfcom.config')
  saveConfig(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(UpdateNfcomConfigRequestSchema) body: UpdateNfcomConfigRequest,
  ) {
    return this.configService.saveConfig(user.tenantId, user.sub, body);
  }

  @Post('certificate')
  @HttpCode(200)
  @RequirePermissions('nfcom.config')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 100 * 1024 } }),
  )
  uploadCertificate(
    @CurrentUser() user: AuthenticatedPrincipal,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Partial<UploadNfcomCertificateRequest>,
  ) {
    if (!file) {
      throw new BadRequestException('Arquivo .pfx ausente (field name = "file")');
    }
    // Magic bytes do PKCS#12: 0x30 0x82 (SEQUENCE ASN.1 com long length).
    if (file.size < 4 || file.buffer[0] !== 0x30 || file.buffer[1] !== 0x82) {
      throw new BadRequestException(
        'Arquivo não parece ser um .pfx válido (magic bytes ASN.1 ausentes)',
      );
    }
    const parsed = UploadNfcomCertificateRequestSchema.parse(body);
    return this.configService.uploadCertificate(
      user.tenantId,
      user.sub,
      file.buffer,
      parsed.password,
    );
  }

  @Delete('certificate')
  @HttpCode(200)
  @RequirePermissions('nfcom.config')
  deleteCertificate(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.configService.deleteCertificate(user.tenantId, user.sub);
  }

  /** "Testar conexão SVRS" — handshake mTLS (NFComStatusServico). */
  @Post('diagnose')
  @HttpCode(200)
  @RequirePermissions('nfcom.config')
  diagnose(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.configService.diagnose(user.tenantId);
  }
}

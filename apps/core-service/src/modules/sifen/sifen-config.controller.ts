/**
 * SifenConfigController — config SIFEN + upload de cert .p12.
 *
 * Rotas:
 *   GET    /v1/sifen/config                       sifen.config.read
 *   PUT    /v1/sifen/config                       sifen.config.write
 *   GET    /v1/sifen/config/certificate           sifen.config.read
 *   POST   /v1/sifen/config/certificate (file)    sifen.config.write
 *   DELETE /v1/sifen/config/certificate           sifen.config.write
 *
 * Upload usa Multer (memory storage, max 100KB). Senha vem como form field
 * `password`. Multer single file field `file`.
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
  UpdateSifenConfigRequestSchema,
  UploadCertificateRequestSchema,
  type AuthenticatedPrincipal,
  type UpdateSifenConfigRequest,
  type UploadCertificateRequest,
} from '@netx/shared';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ZodBody } from '../../common/zod.pipe';
import { SifenConfigService } from './sifen-config.service';

@ApiTags('sifen-config')
@ApiBearerAuth()
@Controller('sifen/config')
export class SifenConfigController {
  constructor(private readonly configService: SifenConfigService) {}

  @Get()
  @RequirePermissions('sifen.config.read')
  getConfig(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.configService.getConfig(user.tenantId);
  }

  @Put()
  @RequirePermissions('sifen.config.write')
  saveConfig(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(UpdateSifenConfigRequestSchema) body: UpdateSifenConfigRequest,
  ) {
    return this.configService.saveConfig(user.tenantId, user.sub, body);
  }

  @Get('certificate')
  @RequirePermissions('sifen.config.read')
  getCertificateInfo(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.configService.getCertificateInfo(user.tenantId);
  }

  /**
   * Upload do certificado .p12 + senha (multipart).
   *
   * Multer guarda o arquivo em memória (sem disco intermediário). Limite
   * 100KB já é validado pelo service também.
   *
   * Senha vem como campo `password` do form. Validamos com Zod manualmente
   * pra evitar interferência do FileInterceptor com o ZodBody.
   */
  @Post('certificate')
  @HttpCode(200)
  @RequirePermissions('sifen.config.write')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 100 * 1024 }, // 100KB
    }),
  )
  async uploadCertificate(
    @CurrentUser() user: AuthenticatedPrincipal,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Partial<UploadCertificateRequest>,
  ) {
    if (!file) {
      throw new BadRequestException('Arquivo .p12 ausente (field name = "file")');
    }
    // Magic bytes do PKCS#12 começam com 0x30 0x82 (SEQUENCE ASN.1 com long length).
    // Não é prova definitiva, mas filtra arquivo errado óbvio (txt, pdf…).
    if (file.size < 4 || file.buffer[0] !== 0x30 || file.buffer[1] !== 0x82) {
      throw new BadRequestException(
        'Arquivo não parece ser um .p12 válido (magic bytes ASN.1 ausentes)',
      );
    }
    const parsed = UploadCertificateRequestSchema.parse(body);
    return this.configService.uploadCertificate(
      user.tenantId,
      user.sub,
      file.buffer,
      parsed.password,
    );
  }

  @Delete('certificate')
  @HttpCode(200)
  @RequirePermissions('sifen.config.write')
  deleteCertificate(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.configService.deleteCertificate(user.tenantId, user.sub);
  }
}

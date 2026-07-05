/**
 * FibermapElementPhotosService — fotos de elemento via MinIO presigned.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Mesmo fluxo de 2 passos de O.S/RH: presign PUT → client sobe direto no
 * bucket → register confirma com headObject e persiste a referência.
 * Escopo da chave: fibermap/elements/{elementId}.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  FibermapElementPhotoResponse,
  PresignFibermapPhotoRequest,
  RegisterFibermapPhotoRequest,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class FibermapElementPhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private async assertElement(tenantId: string, elementId: string) {
    const el = await this.prisma.fibermapElement.findFirst({
      where: { id: elementId, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!el) throw new NotFoundException('Elemento não encontrado');
    return el;
  }

  async presign(
    tenantId: string,
    elementId: string,
    input: PresignFibermapPhotoRequest,
  ) {
    await this.assertElement(tenantId, elementId);
    const key = this.storage.buildKey(
      tenantId,
      `fibermap/elements/${elementId}`,
      input.fileName,
    );
    const { url, expiresIn } = await this.storage.presignUpload(
      key,
      input.contentType,
    );
    return { uploadUrl: url, storageKey: key, expiresIn };
  }

  async register(
    tenantId: string,
    actorUserId: string,
    elementId: string,
    input: RegisterFibermapPhotoRequest,
  ): Promise<FibermapElementPhotoResponse> {
    await this.assertElement(tenantId, elementId);
    // A chave TEM que ser do escopo deste elemento/tenant — bloqueia registrar
    // objeto alheio (a chave presignada embute tenant + elemento).
    const expectedPrefix = `${tenantId}/fibermap/elements/${elementId}/`;
    if (!input.storageKey.startsWith(expectedPrefix)) {
      throw new BadRequestException('storageKey fora do escopo do elemento');
    }
    const head = await this.storage.headObject(input.storageKey);
    if (!head) {
      throw new BadRequestException(
        'Objeto não encontrado no bucket — faça o upload pela uploadUrl antes de registrar',
      );
    }
    const created = await this.prisma.fibermapElementPhoto.create({
      data: {
        tenantId,
        elementId,
        storageKey: input.storageKey,
        fileName: input.fileName ?? null,
        caption: input.caption ?? null,
        takenAt: input.takenAt ?? null,
        createdById: actorUserId,
      },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.element.photo_added',
      resource: 'fibermap_element_photos',
      resourceId: created.id,
      afterState: { elementId, fileName: created.fileName },
    });
    return {
      id: created.id,
      fileName: created.fileName,
      caption: created.caption,
      takenAt: created.takenAt ? created.takenAt.toISOString() : null,
      createdAt: created.createdAt.toISOString(),
    };
  }

  async downloadUrl(tenantId: string, elementId: string, photoId: string) {
    const photo = await this.prisma.fibermapElementPhoto.findFirst({
      where: { id: photoId, elementId, tenantId },
    });
    if (!photo) throw new NotFoundException('Foto não encontrada');
    const { url, expiresIn } = await this.storage.presignDownload(
      photo.storageKey,
      photo.fileName ?? undefined,
    );
    return { downloadUrl: url, expiresIn };
  }

  async remove(
    tenantId: string,
    actorUserId: string,
    elementId: string,
    photoId: string,
  ): Promise<void> {
    const photo = await this.prisma.fibermapElementPhoto.findFirst({
      where: { id: photoId, elementId, tenantId },
    });
    if (!photo) throw new NotFoundException('Foto não encontrada');
    await this.prisma.fibermapElementPhoto.delete({ where: { id: photoId } });
    await this.storage.deleteObject(photo.storageKey);
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'fibermap.element.photo_removed',
      resource: 'fibermap_element_photos',
      resourceId: photoId,
      beforeState: { elementId, fileName: photo.fileName },
    });
  }
}

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeDocumentType, Prisma } from '@prisma/client';
import {
  type CreateEmployeeDocument,
  type DocumentSignatureResponse,
  type EmployeeDocumentResponse,
  type ListEmployeeDocumentsQuery,
  type RequestUploadUrl,
  type UpdateEmployeeDocument,
  type UploadUrlResponse,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const ACCEPT_TEXT =
  'Declaro que li e estou ciente do conteúdo deste documento.';

const docInclude = {
  signature: true,
} satisfies Prisma.EmployeeDocumentInclude;

type DocRow = Prisma.EmployeeDocumentGetPayload<{ include: typeof docInclude }>;

@Injectable()
export class EmployeeDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** Passo 1 do upload: URL presigned PUT pro client subir direto no MinIO. */
  async requestUploadUrl(
    tenantId: string,
    employeeId: string,
    body: RequestUploadUrl,
  ): Promise<UploadUrlResponse> {
    await this.assertEmployee(tenantId, employeeId);
    const key = this.storage.buildKey(tenantId, 'employee-docs', body.fileName);
    const { url, expiresIn } = await this.storage.presignUpload(
      key,
      body.contentType,
    );
    return { uploadUrl: url, storageKey: key, expiresIn };
  }

  async list(
    tenantId: string,
    employeeId: string,
    q: ListEmployeeDocumentsQuery,
  ): Promise<EmployeeDocumentResponse[]> {
    await this.assertEmployee(tenantId, employeeId);
    const rows = await this.prisma.employeeDocument.findMany({
      where: {
        tenantId,
        employeeId,
        deletedAt: null,
        ...(q.type ? { type: q.type as EmployeeDocumentType } : {}),
        ...(q.requiresSignature !== undefined
          ? { requiresSignature: q.requiresSignature }
          : {}),
        ...(q.search
          ? { title: { contains: q.search, mode: 'insensitive' } }
          : {}),
      },
      include: docInclude,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDocResponse);
  }

  async create(
    tenantId: string,
    actorUserId: string,
    employeeId: string,
    input: CreateEmployeeDocument,
  ): Promise<EmployeeDocumentResponse> {
    await this.assertEmployee(tenantId, employeeId);

    // Se há anexo, confirma no storage e captura tamanho/mime/etag reais.
    let mimeType: string | null = null;
    let fileSize: number | null = null;
    let fileHash: string | null = null;
    if (input.storageKey) {
      const head = await this.storage.headObject(input.storageKey);
      if (!head) {
        throw new ConflictException(
          'Arquivo não encontrado no storage — refaça o upload.',
        );
      }
      mimeType = head.contentType ?? null;
      fileSize = head.size;
      fileHash = head.etag ?? null;
    }

    const doc = await this.prisma.employeeDocument.create({
      data: {
        tenantId,
        employeeId,
        type: input.type as EmployeeDocumentType,
        title: input.title,
        description: input.description ?? null,
        storageKey: input.storageKey ?? null,
        fileName: input.fileName ?? null,
        mimeType,
        fileSize,
        fileHash,
        issuedAt: input.issuedAt ? new Date(input.issuedAt) : null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        requiresSignature: input.requiresSignature,
        uploadedById: actorUserId,
      },
      include: docInclude,
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'employee_document.created',
      resource: 'employee_documents',
      resourceId: doc.id,
      afterState: { employeeId, type: doc.type, title: doc.title },
    });

    return toDocResponse(doc);
  }

  async update(
    tenantId: string,
    actorUserId: string,
    employeeId: string,
    docId: string,
    input: UpdateEmployeeDocument,
  ): Promise<EmployeeDocumentResponse> {
    const before = await this.getOwned(tenantId, employeeId, docId);

    const doc = await this.prisma.employeeDocument.update({
      where: { id: before.id },
      data: {
        ...(input.type !== undefined
          ? { type: input.type as EmployeeDocumentType }
          : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.issuedAt !== undefined
          ? { issuedAt: input.issuedAt ? new Date(input.issuedAt) : null }
          : {}),
        ...(input.expiresAt !== undefined
          ? { expiresAt: input.expiresAt ? new Date(input.expiresAt) : null }
          : {}),
        ...(input.requiresSignature !== undefined
          ? { requiresSignature: input.requiresSignature }
          : {}),
      },
      include: docInclude,
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'employee_document.updated',
      resource: 'employee_documents',
      resourceId: docId,
    });

    return toDocResponse(doc);
  }

  async getDownloadUrl(
    tenantId: string,
    employeeId: string,
    docId: string,
  ): Promise<{ url: string; expiresIn: number }> {
    const doc = await this.getOwned(tenantId, employeeId, docId);
    if (!doc.storageKey) {
      throw new NotFoundException('Documento sem arquivo anexado.');
    }
    return this.storage.presignDownload(doc.storageKey, doc.fileName ?? undefined);
  }

  async remove(
    tenantId: string,
    actorUserId: string,
    employeeId: string,
    docId: string,
  ): Promise<void> {
    const doc = await this.getOwned(tenantId, employeeId, docId);
    await this.prisma.employeeDocument.update({
      where: { id: doc.id },
      data: { deletedAt: new Date() },
    });
    if (doc.storageKey && this.storage.isEnabled()) {
      await this.storage.deleteObject(doc.storageKey);
    }
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'employee_document.deleted',
      resource: 'employee_documents',
      resourceId: docId,
      beforeState: { title: doc.title },
    });
  }

  /**
   * Aceite eletrônico (protocolo). Chamado pelo RH (admin) ou pelo self-service.
   * Registra quem/quando/onde + hash do arquivo no momento. Idempotente: se já
   * assinado, retorna o registro existente.
   */
  async sign(
    tenantId: string,
    employeeId: string,
    docId: string,
    ctx: { ipAddress?: string | null; userAgent?: string | null; actorUserId?: string },
  ): Promise<DocumentSignatureResponse> {
    const doc = await this.getOwned(tenantId, employeeId, docId);
    if (!doc.requiresSignature) {
      throw new ConflictException('Documento não requer assinatura.');
    }
    if (doc.signature) return toSignatureResponse(doc.signature);

    const sig = await this.prisma.documentSignature.create({
      data: {
        tenantId,
        documentId: doc.id,
        employeeId,
        signedFileHash: doc.fileHash,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        acceptedText: ACCEPT_TEXT,
      },
    });

    await this.audit.log({
      tenantId,
      userId: ctx.actorUserId,
      action: 'employee_document.signed',
      resource: 'employee_documents',
      resourceId: doc.id,
      afterState: { employeeId, ip: ctx.ipAddress ?? null },
    });

    return toSignatureResponse(sig);
  }

  // ───────────────────────────────────────────────────────────────────────────
  private async getOwned(
    tenantId: string,
    employeeId: string,
    docId: string,
  ): Promise<DocRow> {
    const doc = await this.prisma.employeeDocument.findFirst({
      where: { id: docId, tenantId, employeeId, deletedAt: null },
      include: docInclude,
    });
    if (!doc) throw new NotFoundException('Documento não encontrado');
    return doc;
  }

  private async assertEmployee(tenantId: string, id: string): Promise<void> {
    const e = await this.prisma.employee.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!e) throw new NotFoundException('Colaborador não encontrado');
  }
}

function toSignatureResponse(s: {
  id: string;
  documentId: string;
  employeeId: string;
  signedAt: Date;
  signedFileHash: string | null;
  ipAddress: string | null;
  acceptedText: string | null;
}): DocumentSignatureResponse {
  return {
    id: s.id,
    documentId: s.documentId,
    employeeId: s.employeeId,
    signedAt: s.signedAt.toISOString(),
    signedFileHash: s.signedFileHash,
    ipAddress: s.ipAddress,
    acceptedText: s.acceptedText,
  };
}

function toDocResponse(d: DocRow): EmployeeDocumentResponse {
  return {
    id: d.id,
    tenantId: d.tenantId,
    employeeId: d.employeeId,
    type: d.type,
    title: d.title,
    description: d.description,
    storageKey: d.storageKey,
    fileName: d.fileName,
    mimeType: d.mimeType,
    fileSize: d.fileSize,
    fileHash: d.fileHash,
    issuedAt: d.issuedAt ? d.issuedAt.toISOString().slice(0, 10) : null,
    expiresAt: d.expiresAt ? d.expiresAt.toISOString().slice(0, 10) : null,
    requiresSignature: d.requiresSignature,
    uploadedById: d.uploadedById,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    signature: d.signature ? toSignatureResponse(d.signature) : null,
  };
}

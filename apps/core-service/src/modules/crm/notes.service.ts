import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import type {
  CreateCustomerNoteRequest,
  CustomerNoteResponse,
  UpdateCustomerNoteRequest,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class CustomerNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, customerId: string): Promise<CustomerNoteResponse[]> {
    await this.assertCustomer(tenantId, customerId);
    const rows = await this.prisma.customerNote.findMany({
      where: { tenantId, customerId },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      include: { author: { select: { firstName: true, lastName: true } } },
    });
    return rows.map(toNoteResponse);
  }

  async create(
    tenantId: string,
    actorUserId: string,
    customerId: string,
    input: CreateCustomerNoteRequest,
  ): Promise<CustomerNoteResponse> {
    await this.assertCustomer(tenantId, customerId);

    const row = await this.prisma.customerNote.create({
      data: {
        tenantId,
        customerId,
        authorId: actorUserId,
        title: input.title ?? null,
        body: input.body,
        pinned: input.pinned,
      },
      include: { author: { select: { firstName: true, lastName: true } } },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'customer.note.created',
      resource: 'customers',
      resourceId: customerId,
      afterState: { noteId: row.id, pinned: row.pinned },
    });

    return toNoteResponse(row);
  }

  async update(
    tenantId: string,
    actorUserId: string,
    customerId: string,
    noteId: string,
    input: UpdateCustomerNoteRequest,
  ): Promise<CustomerNoteResponse> {
    const before = await this.prisma.customerNote.findFirst({
      where: { id: noteId, tenantId, customerId },
    });
    if (!before) throw new NotFoundException('Anotação não encontrada');

    // Regra: só o autor (ou alguém com permissão de manage) pode editar.
    // O guard de permissão já cuida do segundo caso; aqui validamos autoria
    // como camada extra, mas permitimos override quando authorId é nulo (legado).
    if (before.authorId && before.authorId !== actorUserId) {
      throw new ForbiddenException('Apenas o autor pode editar esta anotação');
    }

    const row = await this.prisma.customerNote.update({
      where: { id: noteId },
      data: {
        title: input.title,
        body: input.body,
        pinned: input.pinned,
      },
      include: { author: { select: { firstName: true, lastName: true } } },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'customer.note.updated',
      resource: 'customers',
      resourceId: customerId,
      afterState: { noteId, pinned: row.pinned },
    });

    return toNoteResponse(row);
  }

  async remove(
    tenantId: string,
    actorUserId: string,
    customerId: string,
    noteId: string,
  ): Promise<void> {
    const before = await this.prisma.customerNote.findFirst({
      where: { id: noteId, tenantId, customerId },
      select: { id: true, authorId: true },
    });
    if (!before) throw new NotFoundException('Anotação não encontrada');
    if (before.authorId && before.authorId !== actorUserId) {
      throw new ForbiddenException('Apenas o autor pode remover esta anotação');
    }

    await this.prisma.customerNote.delete({ where: { id: noteId } });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'customer.note.deleted',
      resource: 'customers',
      resourceId: customerId,
      afterState: { noteId },
    });
  }

  private async assertCustomer(tenantId: string, customerId: string): Promise<void> {
    const c = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!c) throw new NotFoundException('Cliente não encontrado');
  }
}

function toNoteResponse(n: {
  id: string;
  customerId: string;
  authorId: string | null;
  title: string | null;
  body: string;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
  author?: { firstName: string | null; lastName: string | null } | null;
}): CustomerNoteResponse {
  const authorName = n.author
    ? [n.author.firstName, n.author.lastName].filter(Boolean).join(' ').trim() || null
    : null;
  return {
    id: n.id,
    customerId: n.customerId,
    authorId: n.authorId,
    authorName,
    title: n.title,
    body: n.body,
    pinned: n.pinned,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

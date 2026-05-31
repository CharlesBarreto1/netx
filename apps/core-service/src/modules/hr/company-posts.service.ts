import { Injectable, NotFoundException } from '@nestjs/common';
import { CompanyPostStatus, Prisma } from '@prisma/client';
import {
  paginationMeta,
  type CreateCompanyPostRequest,
  type CompanyPostResponse,
  type ListCompanyPostsQuery,
  type Paginated,
  type UpdateCompanyPostRequest,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

const postInclude = {
  author: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.CompanyPostInclude;

type PostRow = Prisma.CompanyPostGetPayload<{ include: typeof postInclude }>;

@Injectable()
export class CompanyPostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenantId: string,
    q: ListCompanyPostsQuery,
  ): Promise<Paginated<CompanyPostResponse>> {
    const where: Prisma.CompanyPostWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.status ? { status: q.status as CompanyPostStatus } : {}),
      ...(q.search
        ? { title: { contains: q.search, mode: 'insensitive' } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.companyPost.findMany({
        where,
        include: postInclude,
        orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.companyPost.count({ where }),
    ]);
    return {
      data: rows.map(toPostResponse),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  /** Feed publicado (self-service). */
  async listPublished(tenantId: string, limit = 20): Promise<CompanyPostResponse[]> {
    const rows = await this.prisma.companyPost.findMany({
      where: { tenantId, deletedAt: null, status: CompanyPostStatus.PUBLISHED },
      include: postInclude,
      orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
      take: limit,
    });
    return rows.map(toPostResponse);
  }

  async findById(tenantId: string, id: string): Promise<CompanyPostResponse> {
    const p = await this.prisma.companyPost.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: postInclude,
    });
    if (!p) throw new NotFoundException('Publicação não encontrada');
    return toPostResponse(p);
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateCompanyPostRequest,
  ): Promise<CompanyPostResponse> {
    const slug = await this.uniqueSlug(tenantId, input.title);
    const p = await this.prisma.companyPost.create({
      data: {
        tenantId,
        title: input.title,
        slug,
        excerpt: input.excerpt ?? null,
        body: input.body,
        coverStorageKey: input.coverStorageKey ?? null,
        status: input.status as CompanyPostStatus,
        pinned: input.pinned,
        publishedAt: input.status === 'PUBLISHED' ? new Date() : null,
        authorId: actorUserId,
      },
      include: postInclude,
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'company_post.created',
      resource: 'company_posts',
      resourceId: p.id,
      afterState: { title: p.title, status: p.status },
    });
    return toPostResponse(p);
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateCompanyPostRequest,
  ): Promise<CompanyPostResponse> {
    const before = await this.prisma.companyPost.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Publicação não encontrada');

    // Publicar pela primeira vez carimba publishedAt.
    const goingLive =
      input.status === 'PUBLISHED' && before.status !== 'PUBLISHED';

    const p = await this.prisma.companyPost.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.excerpt !== undefined ? { excerpt: input.excerpt } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.coverStorageKey !== undefined
          ? { coverStorageKey: input.coverStorageKey }
          : {}),
        ...(input.status !== undefined
          ? { status: input.status as CompanyPostStatus }
          : {}),
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
        ...(goingLive ? { publishedAt: new Date() } : {}),
      },
      include: postInclude,
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'company_post.updated',
      resource: 'company_posts',
      resourceId: id,
    });
    return toPostResponse(p);
  }

  async remove(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const before = await this.prisma.companyPost.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, title: true },
    });
    if (!before) throw new NotFoundException('Publicação não encontrada');
    await this.prisma.companyPost.update({
      where: { id },
      data: { deletedAt: new Date(), status: CompanyPostStatus.ARCHIVED },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'company_post.deleted',
      resource: 'company_posts',
      resourceId: id,
      beforeState: { title: before.title },
    });
  }

  private async uniqueSlug(tenantId: string, title: string): Promise<string> {
    const base =
      title
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '') // remove acentos (combining marks)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 240) || 'post';
    let slug = base;
    let n = 1;
    // Colisão por tenant é rara; loop curto resolve.
    while (
      await this.prisma.companyPost.findFirst({
        where: { tenantId, slug },
        select: { id: true },
      })
    ) {
      slug = `${base}-${++n}`;
    }
    return slug;
  }
}

function toPostResponse(p: PostRow): CompanyPostResponse {
  const authorName = p.author
    ? `${p.author.firstName} ${p.author.lastName}`.trim()
    : null;
  return {
    id: p.id,
    tenantId: p.tenantId,
    title: p.title,
    slug: p.slug,
    excerpt: p.excerpt,
    body: p.body,
    coverStorageKey: p.coverStorageKey,
    status: p.status,
    pinned: p.pinned,
    publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
    authorId: p.authorId,
    author: p.author ? { id: p.author.id, name: authorName ?? '' } : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

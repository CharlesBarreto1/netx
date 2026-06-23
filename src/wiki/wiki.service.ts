import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { WikiAudience } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { WIKI_SEED } from './wiki-seed';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

@Injectable()
export class WikiService implements OnModuleInit {
  private readonly logger = new Logger(WikiService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Popula a wiki com a doc do sistema na primeira vez (tabela vazia). */
  async onModuleInit(): Promise<void> {
    try {
      const count = await this.prisma.wikiArticle.count();
      if (count > 0) return;
      await this.prisma.wikiArticle.createMany({
        data: WIKI_SEED.map((a) => ({
          slug: a.slug,
          title: a.title,
          category: a.category,
          audience: a.audience,
          content: a.content,
          orderIndex: a.orderIndex,
        })),
        skipDuplicates: true,
      });
      this.logger.log(`Wiki populada com ${WIKI_SEED.length} artigos iniciais`);
    } catch (err) {
      // DB pode não estar migrado ainda no primeiro boot — não derruba o app.
      this.logger.warn(`Seed da wiki pulado: ${String(err)}`);
    }
  }

  /** Lista enxuta (sem o conteúdo) pra montar o índice por categoria. */
  list(audience?: WikiAudience) {
    return this.prisma.wikiArticle.findMany({
      where: audience ? { audience } : {},
      orderBy: [{ category: 'asc' }, { orderIndex: 'asc' }, { title: 'asc' }],
      select: { id: true, slug: true, title: true, category: true, audience: true, updatedAt: true },
    });
  }

  /** Busca por slug. Se `audience` vier, exige que o artigo seja daquele público
   *  (o portal não pode ler artigo interno mesmo sabendo o slug). */
  async getBySlug(slug: string, audience?: WikiAudience) {
    const a = await this.prisma.wikiArticle.findUnique({ where: { slug } });
    if (!a || (audience && a.audience !== audience)) {
      throw new NotFoundException('Artigo não encontrado');
    }
    return a;
  }

  async create(
    input: { title: string; category?: string; content: string; audience?: WikiAudience },
    byEmail?: string,
  ) {
    const base = slugify(input.title) || 'artigo';
    let slug = base;
    // Garante slug único.
    for (let i = 2; await this.prisma.wikiArticle.findUnique({ where: { slug } }); i++) {
      slug = `${base}-${i}`;
    }
    return this.prisma.wikiArticle.create({
      data: {
        slug,
        title: input.title,
        category: input.category?.trim() || 'Geral',
        audience: input.audience ?? 'INTERNAL',
        content: input.content,
        updatedByEmail: byEmail ?? null,
      },
    });
  }

  async update(
    id: string,
    input: {
      title?: string;
      category?: string;
      content?: string;
      orderIndex?: number;
      audience?: WikiAudience;
    },
    byEmail?: string,
  ) {
    const exists = await this.prisma.wikiArticle.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Artigo não encontrado');
    return this.prisma.wikiArticle.update({
      where: { id },
      data: {
        title: input.title,
        category: input.category?.trim() || undefined,
        audience: input.audience,
        content: input.content,
        orderIndex: input.orderIndex,
        updatedByEmail: byEmail ?? exists.updatedByEmail,
      },
    });
  }

  async remove(id: string): Promise<void> {
    await this.prisma.wikiArticle.deleteMany({ where: { id } });
  }
}

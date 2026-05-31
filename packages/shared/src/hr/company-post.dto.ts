import { z } from 'zod';

/** Blog / notícias da empresa (feed do portal do colaborador). Corpo em markdown. */

const optionalString = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : (v ?? null)));

export const CompanyPostStatusSchema = z.enum([
  'DRAFT',
  'PUBLISHED',
  'ARCHIVED',
]);
export type CompanyPostStatus = z.infer<typeof CompanyPostStatusSchema>;

export const CreateCompanyPostRequestSchema = z.object({
  title: z.string().min(2).max(250),
  excerpt: optionalString(500),
  body: z.string().min(1).max(50_000),
  coverStorageKey: optionalString(500),
  status: CompanyPostStatusSchema.default('DRAFT'),
  pinned: z.boolean().default(false),
});
export type CreateCompanyPostRequest = z.infer<
  typeof CreateCompanyPostRequestSchema
>;

export const UpdateCompanyPostRequestSchema =
  CreateCompanyPostRequestSchema.partial();
export type UpdateCompanyPostRequest = z.infer<
  typeof UpdateCompanyPostRequestSchema
>;

export const ListCompanyPostsQuerySchema = z.object({
  status: CompanyPostStatusSchema.optional(),
  search: z.string().max(255).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListCompanyPostsQuery = z.infer<typeof ListCompanyPostsQuerySchema>;

export interface CompanyPostResponse {
  id: string;
  tenantId: string;
  title: string;
  slug: string;
  excerpt: string | null;
  body: string;
  coverStorageKey: string | null;
  coverUrl?: string | null;
  status: CompanyPostStatus;
  pinned: boolean;
  publishedAt: string | null;
  authorId: string | null;
  author?: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

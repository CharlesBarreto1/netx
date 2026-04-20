import { z } from 'zod';

export const CreateCustomerTagRequestSchema = z.object({
  name: z.string().min(1).max(64),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  description: z.string().max(255).nullish(),
});
export type CreateCustomerTagRequest = z.infer<typeof CreateCustomerTagRequestSchema>;

export const UpdateCustomerTagRequestSchema = CreateCustomerTagRequestSchema.partial();
export type UpdateCustomerTagRequest = z.infer<typeof UpdateCustomerTagRequestSchema>;

export const AssignTagsRequestSchema = z.object({
  tagIds: z.array(z.string().uuid()).min(1),
});
export type AssignTagsRequest = z.infer<typeof AssignTagsRequestSchema>;

export interface CustomerTagResponse {
  id: string;
  tenantId: string;
  name: string;
  color: string | null;
  description: string | null;
  customerCount?: number;
  createdAt: string;
  updatedAt: string;
}

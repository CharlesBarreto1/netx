import { z } from 'zod';

export const CreateCustomerNoteRequestSchema = z.object({
  title: z.string().max(255).nullish(),
  body: z.string().min(1).max(10_000),
  pinned: z.boolean().default(false),
});
export type CreateCustomerNoteRequest = z.infer<typeof CreateCustomerNoteRequestSchema>;

export const UpdateCustomerNoteRequestSchema = CreateCustomerNoteRequestSchema.partial();
export type UpdateCustomerNoteRequest = z.infer<typeof UpdateCustomerNoteRequestSchema>;

export interface CustomerNoteResponse {
  id: string;
  customerId: string;
  authorId: string | null;
  authorName: string | null;
  title: string | null;
  body: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

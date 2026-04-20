import { z } from 'zod';

export const ContactTypeSchema = z.enum([
  'EMAIL',
  'PHONE',
  'MOBILE',
  'WHATSAPP',
  'TELEGRAM',
  'OTHER',
]);
export type ContactType = z.infer<typeof ContactTypeSchema>;

export const CreateCustomerContactRequestSchema = z.object({
  type: ContactTypeSchema,
  label: z.string().max(64).nullish(),
  value: z.string().min(1).max(255),
  isPrimary: z.boolean().default(false),
  optIn: z.boolean().default(false),
});
export type CreateCustomerContactRequest = z.infer<typeof CreateCustomerContactRequestSchema>;

export const UpdateCustomerContactRequestSchema = CreateCustomerContactRequestSchema.partial();
export type UpdateCustomerContactRequest = z.infer<typeof UpdateCustomerContactRequestSchema>;

export interface CustomerContactResponse {
  id: string;
  customerId: string;
  type: ContactType;
  label: string | null;
  value: string;
  isPrimary: boolean;
  isVerified: boolean;
  optIn: boolean;
  createdAt: string;
  updatedAt: string;
}

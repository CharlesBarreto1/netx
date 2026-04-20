import { z } from 'zod';

export const AddressTypeSchema = z.enum(['BILLING', 'SERVICE', 'SHIPPING', 'OTHER']);
export type AddressType = z.infer<typeof AddressTypeSchema>;

export const CreateCustomerAddressRequestSchema = z.object({
  type: AddressTypeSchema.default('BILLING'),
  label: z.string().max(64).nullish(),

  country: z.string().length(2).toUpperCase(),
  state: z.string().max(120).nullish(),
  city: z.string().min(1).max(120),
  district: z.string().max(120).nullish(),
  street: z.string().min(1).max(255),
  number: z.string().max(32).nullish(),
  complement: z.string().max(120).nullish(),
  postalCode: z.string().max(16).nullish(),

  latitude: z.coerce.number().min(-90).max(90).nullish(),
  longitude: z.coerce.number().min(-180).max(180).nullish(),

  isPrimary: z.boolean().default(false),
});
export type CreateCustomerAddressRequest = z.infer<typeof CreateCustomerAddressRequestSchema>;

export const UpdateCustomerAddressRequestSchema = CreateCustomerAddressRequestSchema.partial();
export type UpdateCustomerAddressRequest = z.infer<typeof UpdateCustomerAddressRequestSchema>;

export interface CustomerAddressResponse {
  id: string;
  customerId: string;
  type: AddressType;
  label: string | null;
  country: string;
  state: string | null;
  city: string;
  district: string | null;
  street: string;
  number: string | null;
  complement: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

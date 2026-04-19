import { z } from 'zod';

export const UserStatusSchema = z.enum(['ACTIVE', 'INVITED', 'SUSPENDED', 'DISABLED']);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const CreateUserRequestSchema = z.object({
  email: z.string().email().max(255),
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  phone: z.string().max(32).optional(),
  locale: z.string().max(10).optional(),
  timezone: z.string().max(64).optional(),
  roleIds: z.array(z.string().uuid()).default([]),
  sendInvite: z.boolean().default(true),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const UpdateUserRequestSchema = CreateUserRequestSchema.partial().extend({
  status: UserStatusSchema.optional(),
});
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

export interface UserResponse {
  id: string;
  tenantId: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  phone: string | null;
  locale: string | null;
  timezone: string | null;
  status: UserStatus;
  mfaEnabled: boolean;
  roles: Array<{ id: string; name: string }>;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

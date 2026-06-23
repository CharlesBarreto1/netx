import { z } from 'zod';

const RoleSchema = z.enum(['admin', 'operator', 'viewer']);

export const CreateUserSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, 'use letras, números, ponto, hífen ou underline'),
  password: z.string().min(8).max(256),
  name: z.string().max(120).optional(),
  role: RoleSchema.default('viewer'),
});
export type CreateUserDto = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z
  .object({
    name: z.string().max(120).nullable().optional(),
    password: z.string().min(8).max(256).optional(),
    role: RoleSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'nada para atualizar' });
export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;

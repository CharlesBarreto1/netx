import { z } from 'zod';

import { strongPasswordSchema } from './auth/password';

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
  /**
   * Override de visibilidade de menus por usuário. Null/undefined = sem
   * override (usa só permissões). Array = só esses menus aparecem no sidebar
   * (intersecção com permissões).
   */
  menuAccess: z.array(z.string().min(1).max(64)).max(64).nullish(),
  /**
   * Senha inicial. Quando informada, o user é criado com status ACTIVE e a
   * senha é hasheada antes de salvar. Quando ausente, geramos uma senha
   * temporária e marcamos como INVITED (fluxo legado de convite por email).
   * Aplica a política de senha forte (8+, Aa1!).
   */
  password: strongPasswordSchema.optional(),
  sendInvite: z.boolean().default(true),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const UpdateUserRequestSchema = CreateUserRequestSchema.partial().extend({
  status: UserStatusSchema.optional(),
  // Remove os defaults: o `.partial()` do Zod 4 AINDA injeta o default quando o
  // campo vem ausente. Sem isto, um PATCH sem roleIds injeta `[]` e ZERA todas
  // as roles do usuário (o service faz deleteMany+create). sendInvite só faz
  // sentido no create.
  roleIds: CreateUserRequestSchema.shape.roleIds.removeDefault().optional(),
  sendInvite: CreateUserRequestSchema.shape.sendInvite.removeDefault().optional(),
});
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

/**
 * "Eu mesmo edito o meu user" — endpoint /v1/users/me. Mais restritivo que
 * UpdateUser admin: só permite preferências pessoais, nunca status, roles
 * ou email. Locale aqui é o cara: o switcher de idioma chama esse endpoint.
 */
export const UpdateMyUserRequestSchema = z
  .object({
    firstName: z.string().min(1).max(120).optional(),
    lastName: z.string().min(1).max(120).optional(),
    phone: z.string().max(32).nullish(),
    locale: z.string().max(10).nullish(),
    timezone: z.string().max(64).nullish(),
  })
  .strict();
export type UpdateMyUserRequest = z.infer<typeof UpdateMyUserRequestSchema>;

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
  /** Lista de chaves de menu que esse user pode ver, ou null pra usar só perms. */
  menuAccess: string[] | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Senha temporária GERADA pelo backend (quando admin criou/resetou sem
   * informar). Aparece SÓ na resposta da operação de criação/reset — o admin
   * tem que mostrar/transmitir essa senha pro usuário, ela não fica gravada
   * em lugar nenhum em texto claro. Em listagens (GET /users) é sempre
   * `undefined`.
   */
  temporaryPassword?: string;
}

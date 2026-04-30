/**
 * Cliente tipado para os endpoints de usuários e papéis.
 * Rotas via gateway em `/api/v1/...`.
 */
import { api } from './api';
import type { Paginated } from './crm-types';

export type UserStatus = 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'DISABLED';

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
  /** Override de visibilidade de menus. null = sem restrição extra. */
  menuAccess: string[] | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoleResponse {
  id: string;
  tenantId: string | null;
  name: string;
  description: string | null;
  isSystem: boolean;
  priority: number;
  permissions: string[];
}

export interface CreateUserInput {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  locale?: string;
  timezone?: string;
  roleIds: string[];
  menuAccess?: string[] | null;
  /** Senha opcional. Se omitida, user nasce INVITED com senha temp. */
  password?: string;
  sendInvite?: boolean;
}

export interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  locale?: string | null;
  timezone?: string | null;
  roleIds?: string[];
  menuAccess?: string[] | null;
  status?: UserStatus;
  /** Reset de senha pelo admin. Quando informado, gera novo hash. */
  password?: string;
}

export const usersApi = {
  listPath: (params: { page?: number; pageSize?: number; search?: string } = {}) => {
    const usp = new URLSearchParams();
    if (params.page) usp.set('page', String(params.page));
    if (params.pageSize) usp.set('pageSize', String(params.pageSize));
    if (params.search) usp.set('search', params.search);
    const qs = usp.toString();
    return `/v1/users${qs ? `?${qs}` : ''}`;
  },
  list(params: { page?: number; pageSize?: number; search?: string } = {}) {
    return api.get<Paginated<UserResponse>>(this.listPath(params));
  },
  getPath: (id: string) => `/v1/users/${id}`,
  get(id: string) {
    return api.get<UserResponse>(this.getPath(id));
  },
  create(input: CreateUserInput) {
    return api.post<UserResponse>('/v1/users', input);
  },
  update(id: string, input: UpdateUserInput) {
    return api.patch<UserResponse>(`/v1/users/${id}`, input);
  },
  remove(id: string) {
    return api.delete(`/v1/users/${id}`);
  },
};

export const rolesApi = {
  path: () => '/v1/roles',
  list() {
    return api.get<RoleResponse[]>('/v1/roles');
  },
};

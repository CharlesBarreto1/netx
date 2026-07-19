/**
 * Factories dos testes de integração.
 *
 * Criam o mínimo obrigatório e aceitam override. O teste declara só o que
 * importa para ele; o resto é ruído preenchido aqui.
 */
import type { Prisma, Tenant, User } from '@prisma/client';

import { testPrisma } from './db';

/**
 * Contador por processo para valores únicos. O banco é truncado entre testes,
 * mas dentro de um mesmo teste dois registros precisam de slug/email distintos.
 */
let seq = 0;
const next = (): number => ++seq;

export async function createTenant(overrides: Partial<Prisma.TenantCreateInput> = {}): Promise<Tenant> {
  const n = next();
  return testPrisma().tenant.create({
    data: {
      slug: `tenant-${n}`,
      name: `Tenant de Teste ${n}`,
      country: 'BR',
      status: 'ACTIVE',
      ...overrides,
    },
  });
}

export async function createUser(
  tenantId: string,
  overrides: Partial<Omit<Prisma.UserCreateInput, 'tenant'>> = {},
): Promise<User> {
  const n = next();
  return testPrisma().user.create({
    data: {
      tenant: { connect: { id: tenantId } },
      email: `usuario-${n}@exemplo.test`,
      firstName: 'Usuário',
      lastName: `Teste ${n}`,
      status: 'ACTIVE',
      emailVerified: true,
      ...overrides,
    },
  });
}

/** Tenant + usuário ativo, que é o ponto de partida da maioria dos testes. */
export async function createTenantWithUser(
  tenantOverrides: Partial<Prisma.TenantCreateInput> = {},
  userOverrides: Partial<Omit<Prisma.UserCreateInput, 'tenant'>> = {},
): Promise<{ tenant: Tenant; user: User }> {
  const tenant = await createTenant(tenantOverrides);
  const user = await createUser(tenant.id, userOverrides);
  return { tenant, user };
}

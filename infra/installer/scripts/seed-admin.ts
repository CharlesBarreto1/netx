/**
 * seed-admin.ts — bootstrapa tenant inicial + admin user.
 *
 * Roda DEPOIS do seed canônico (que cria permissões/roles/tenant default).
 * Se o tenant pelo nome já existe, reaproveita; mesma coisa pro user.
 *
 * Lê do env (passado pelo install.sh):
 *   NETX_ADMIN_EMAIL
 *   NETX_ADMIN_PASSWORD
 *   NETX_TENANT_NAME
 *   NETX_TENANT_COUNTRY  (PY/BR/AR)
 *   NETX_TENANT_LOCALE   (es-PY/pt-BR/...)
 *   NETX_TENANT_CURRENCY (PYG/BRL/...)
 *
 * Uso:
 *   cd /opt/netx/apps/core-service
 *   npx ts-node /opt/netx/infra/installer/scripts/seed-admin.ts
 */

import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const env = (k: string, fallback?: string): string => {
  const v = process.env[k];
  if (!v && fallback === undefined) {
    throw new Error(`${k} não definido no ambiente`);
  }
  return v ?? (fallback as string);
};

const slugify = (s: string): string => {
  const out = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacríticos combinantes
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return out || 'tenant';
};

async function main() {
  const prisma = new PrismaClient();

  const adminEmail = env('NETX_ADMIN_EMAIL').toLowerCase().trim();
  const adminPassword = env('NETX_ADMIN_PASSWORD');
  const tenantName = env('NETX_TENANT_NAME');
  const tenantCountry = env('NETX_TENANT_COUNTRY', 'PY');
  const tenantLocale = env('NETX_TENANT_LOCALE', 'es-PY');
  const tenantCurrency = env('NETX_TENANT_CURRENCY', 'PYG');
  const tenantSlug = slugify(tenantName);

  console.log(`[seed-admin] tenant=${tenantSlug} admin=${adminEmail}`);

  try {
    // 1) Tenant
    const tenant = await prisma.tenant.upsert({
      where: { slug: tenantSlug },
      create: {
        slug: tenantSlug,
        name: tenantName,
        country: tenantCountry,
        locale: tenantLocale,
        currency: tenantCurrency,
        active: true,
      },
      update: {
        name: tenantName,
        country: tenantCountry,
        locale: tenantLocale,
        currency: tenantCurrency,
        active: true,
      },
    });

    // 2) Role "admin" — assumida criada pelo seed canônico
    const adminRole = await prisma.role.findFirst({
      where: { tenantId: tenant.id, code: 'admin' },
    });
    if (!adminRole) {
      console.error(
        '[seed-admin] role "admin" não encontrada — o seed canônico precisa rodar primeiro',
      );
      process.exit(1);
    }

    // 3) Hash senha
    const passwordHash = await argon2.hash(adminPassword, {
      type: argon2.argon2id,
      memoryCost: parseInt(process.env.ARGON2_MEMORY_COST ?? '19456', 10),
      timeCost: parseInt(process.env.ARGON2_TIME_COST ?? '2', 10),
      parallelism: parseInt(process.env.ARGON2_PARALLELISM ?? '1', 10),
    });

    // 4) User (upsert por email + tenantId composto único)
    const user = await prisma.user.upsert({
      where: {
        tenantId_email: { tenantId: tenant.id, email: adminEmail },
      },
      create: {
        tenantId: tenant.id,
        email: adminEmail,
        passwordHash,
        fullName: 'Administrator',
        active: true,
        locale: tenantLocale,
      },
      update: {
        passwordHash,
        active: true,
      },
    });

    // 5) Vincula role admin
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
      create: { userId: user.id, roleId: adminRole.id },
      update: {},
    });

    console.log(
      `[seed-admin] OK — tenant=${tenant.slug} (${tenant.id}) user=${user.email} (${user.id})`,
    );
  } catch (e) {
    console.error('[seed-admin] FALHOU:', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

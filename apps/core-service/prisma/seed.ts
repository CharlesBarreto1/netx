/**
 * Prisma seed script — creates baseline data to bootstrap a fresh database:
 *
 *   - System permissions (Module 1: Core)
 *   - System roles (superadmin, admin, operator, viewer)
 *   - A default tenant with an admin user
 *
 * Run with:  npm run db:seed
 */
import { PrismaClient, TenantStatus, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

// -----------------------------------------------------------------------------
// Permission catalog for Module 1 (Core). Each module will extend this list.
// -----------------------------------------------------------------------------
const corePermissions = [
  // Tenant administration
  { code: 'tenants.read', module: 'core', resource: 'tenants', action: 'read' },
  { code: 'tenants.update', module: 'core', resource: 'tenants', action: 'update' },
  { code: 'tenants.settings.manage', module: 'core', resource: 'tenant_settings', action: 'manage' },
  { code: 'tenants.features.manage', module: 'core', resource: 'tenant_features', action: 'manage' },

  // Users
  { code: 'users.create', module: 'core', resource: 'users', action: 'create' },
  { code: 'users.read', module: 'core', resource: 'users', action: 'read' },
  { code: 'users.update', module: 'core', resource: 'users', action: 'update' },
  { code: 'users.delete', module: 'core', resource: 'users', action: 'delete' },
  { code: 'users.invite', module: 'core', resource: 'users', action: 'invite' },
  { code: 'users.impersonate', module: 'core', resource: 'users', action: 'impersonate' },

  // Roles and permissions
  { code: 'roles.create', module: 'core', resource: 'roles', action: 'create' },
  { code: 'roles.read', module: 'core', resource: 'roles', action: 'read' },
  { code: 'roles.update', module: 'core', resource: 'roles', action: 'update' },
  { code: 'roles.delete', module: 'core', resource: 'roles', action: 'delete' },
  { code: 'roles.assign', module: 'core', resource: 'roles', action: 'assign' },

  // API Keys
  { code: 'api_keys.create', module: 'core', resource: 'api_keys', action: 'create' },
  { code: 'api_keys.read', module: 'core', resource: 'api_keys', action: 'read' },
  { code: 'api_keys.revoke', module: 'core', resource: 'api_keys', action: 'revoke' },

  // Audit
  { code: 'audit.read', module: 'core', resource: 'audit_logs', action: 'read' },
];

// Role → permission mapping
const systemRoles = [
  {
    name: 'superadmin',
    description: 'Acesso total, incluindo administração cross-tenant',
    priority: 0,
    permissions: '*', // all
  },
  {
    name: 'admin',
    description: 'Administrador do tenant — gerencia usuários, papéis e configurações',
    priority: 10,
    permissions: [
      'tenants.read',
      'tenants.update',
      'tenants.settings.manage',
      'users.create',
      'users.read',
      'users.update',
      'users.delete',
      'users.invite',
      'roles.create',
      'roles.read',
      'roles.update',
      'roles.delete',
      'roles.assign',
      'api_keys.create',
      'api_keys.read',
      'api_keys.revoke',
      'audit.read',
    ],
  },
  {
    name: 'operator',
    description: 'Operação diária — usuários e leitura de auditoria',
    priority: 50,
    permissions: [
      'tenants.read',
      'users.read',
      'users.update',
      'users.invite',
      'roles.read',
      'audit.read',
    ],
  },
  {
    name: 'viewer',
    description: 'Acesso somente-leitura',
    priority: 100,
    permissions: ['tenants.read', 'users.read', 'roles.read'],
  },
];

async function main() {
  console.log('🌱 Seeding NetX core database...');

  // 1. Permissions (global catalog)
  console.log('  → Permissions');
  for (const p of corePermissions) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { module: p.module, resource: p.resource, action: p.action },
      create: p,
    });
  }

  // 2. System roles (tenantId = null → system-wide templates)
  // Prisma não suporta `null` em composite unique, então usamos findFirst + create/update
  console.log('  → System roles');
  const allPermissions = await prisma.permission.findMany();
  for (const r of systemRoles) {
    const existing = await prisma.role.findFirst({
      where: { name: r.name, tenantId: null },
    });

    const role = existing
      ? await prisma.role.update({
          where: { id: existing.id },
          data: { description: r.description, priority: r.priority, isSystem: true },
        })
      : await prisma.role.create({
          data: {
            name: r.name,
            description: r.description,
            priority: r.priority,
            isSystem: true,
          },
        });

    const perms =
      r.permissions === '*'
        ? allPermissions
        : allPermissions.filter((p) => (r.permissions as string[]).includes(p.code));

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }

  // 3. Default tenant (dev only)
  console.log('  → Default tenant');
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'default' },
    update: {},
    create: {
      slug: 'default',
      name: 'NetX Development ISP',
      legalName: 'NetX Dev LTDA',
      taxId: '00.000.000/0001-00',
      country: 'BR',
      locale: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      currency: 'BRL',
      status: TenantStatus.ACTIVE,
    },
  });

  // Copy system admin role to this tenant
  const systemAdmin = await prisma.role.findFirst({
    where: { name: 'admin', tenantId: null },
    include: { rolePermissions: true },
  });
  if (!systemAdmin) throw new Error('System admin role not found');

  const tenantAdmin = await prisma.role.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'admin' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'admin',
      description: 'Administrador do tenant',
      priority: 10,
      isSystem: false,
    },
  });
  await prisma.rolePermission.deleteMany({ where: { roleId: tenantAdmin.id } });
  await prisma.rolePermission.createMany({
    data: systemAdmin.rolePermissions.map((rp) => ({
      roleId: tenantAdmin.id,
      permissionId: rp.permissionId,
    })),
    skipDuplicates: true,
  });

  // 4. Admin user
  console.log('  → Admin user');
  const passwordHash = await argon2.hash('ChangeMe!2026', {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  const admin = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@netx.local' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'admin@netx.local',
      emailVerified: true,
      passwordHash,
      firstName: 'NetX',
      lastName: 'Admin',
      status: UserStatus.ACTIVE,
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: tenantAdmin.id } },
    update: {},
    create: { userId: admin.id, roleId: tenantAdmin.id },
  });

  console.log('✅ Seed completed.');
  console.log('');
  console.log('   Login de desenvolvimento:');
  console.log('     email:    admin@netx.local');
  console.log('     senha:    ChangeMe!2026');
  console.log('     tenant:   default');
  console.log('');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

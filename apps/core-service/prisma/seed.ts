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

// -----------------------------------------------------------------------------
// Permission catalog for Module 2 (CRM / Clientes)
// -----------------------------------------------------------------------------
const crmPermissions = [
  { code: 'customers.create', module: 'crm', resource: 'customers', action: 'create' },
  { code: 'customers.read', module: 'crm', resource: 'customers', action: 'read' },
  { code: 'customers.update', module: 'crm', resource: 'customers', action: 'update' },
  { code: 'customers.delete', module: 'crm', resource: 'customers', action: 'delete' },
  { code: 'customers.tags.manage', module: 'crm', resource: 'customer_tags', action: 'manage' },
  { code: 'customers.consents.manage', module: 'crm', resource: 'customer_consents', action: 'manage' },
  { code: 'customers.notes.manage', module: 'crm', resource: 'customer_notes', action: 'manage' },

  // Vendas — pipelines/deals/activities
  { code: 'pipelines.manage', module: 'crm', resource: 'pipelines', action: 'manage' },
  { code: 'deals.read', module: 'crm', resource: 'deals', action: 'read' },
  { code: 'deals.write', module: 'crm', resource: 'deals', action: 'write' },
  { code: 'deals.delete', module: 'crm', resource: 'deals', action: 'delete' },
  { code: 'activities.read', module: 'crm', resource: 'activities', action: 'read' },
  { code: 'activities.write', module: 'crm', resource: 'activities', action: 'write' },
  { code: 'activities.delete', module: 'crm', resource: 'activities', action: 'delete' },
];

// -----------------------------------------------------------------------------
// Permission catalog for Module 3 (Contratos)
// -----------------------------------------------------------------------------
const contractsPermissions = [
  { code: 'contracts.read', module: 'contracts', resource: 'contracts', action: 'read' },
  { code: 'contracts.write', module: 'contracts', resource: 'contracts', action: 'write' },
  { code: 'contracts.delete', module: 'contracts', resource: 'contracts', action: 'delete' },
  { code: 'contracts.admin', module: 'contracts', resource: 'contracts', action: 'admin' },
];

// -----------------------------------------------------------------------------
// Permission catalog — Ordens de Serviço (O.S)
// -----------------------------------------------------------------------------
const serviceOrdersPermissions = [
  { code: 'service_orders.read', module: 'service_orders', resource: 'service_orders', action: 'read' },
  { code: 'service_orders.write', module: 'service_orders', resource: 'service_orders', action: 'write' },
  { code: 'service_orders.delete', module: 'service_orders', resource: 'service_orders', action: 'delete' },
  // Cadastro de motivos da O.S (config do tenant).
  { code: 'service_order_reasons.manage', module: 'service_orders', resource: 'service_order_reasons', action: 'manage' },
];

// -----------------------------------------------------------------------------
// Permission catalog — Finance (caixas + cobranças avulsas + descontos)
// -----------------------------------------------------------------------------
const financePermissions = [
  // Cadastro de caixas (admin).
  { code: 'cash_registers.manage', module: 'finance', resource: 'cash_registers', action: 'manage' },
  // Cobranças avulsas.
  { code: 'finance.charges.read', module: 'finance', resource: 'charges', action: 'read' },
  { code: 'finance.charges.write', module: 'finance', resource: 'charges', action: 'write' },
  { code: 'finance.charges.delete', module: 'finance', resource: 'charges', action: 'delete' },
  // Aplicar desconto em pagamento (sensível — não vai pro operator default).
  { code: 'finance.discount.apply', module: 'finance', resource: 'payments', action: 'discount' },
];

// -----------------------------------------------------------------------------
// Permission catalog — Reports
// -----------------------------------------------------------------------------
const reportsPermissions = [
  { code: 'reports.read', module: 'reports', resource: 'reports', action: 'read' },
];

// -----------------------------------------------------------------------------
// Permission catalog — Backups (admin-only)
// -----------------------------------------------------------------------------
const backupsPermissions = [
  { code: 'backups.manage', module: 'core', resource: 'backups', action: 'manage' },
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
      // CRM — clientes
      'customers.create',
      'customers.read',
      'customers.update',
      'customers.delete',
      'customers.tags.manage',
      'customers.consents.manage',
      'customers.notes.manage',
      // CRM — vendas
      'pipelines.manage',
      'deals.read',
      'deals.write',
      'deals.delete',
      'activities.read',
      'activities.write',
      'activities.delete',
      // Contratos
      'contracts.read',
      'contracts.write',
      'contracts.delete',
      'contracts.admin',
      // Ordens de Serviço
      'service_orders.read',
      'service_orders.write',
      'service_orders.delete',
      'service_order_reasons.manage',
      // Finance
      'cash_registers.manage',
      'finance.charges.read',
      'finance.charges.write',
      'finance.charges.delete',
      'finance.discount.apply',
      'reports.read',
      'backups.manage',
    ],
  },
  {
    name: 'operator',
    description: 'Operação diária — usuários, clientes e leitura de auditoria',
    priority: 50,
    permissions: [
      'tenants.read',
      'users.read',
      'users.update',
      'users.invite',
      'roles.read',
      'audit.read',
      // CRM (operação)
      'customers.create',
      'customers.read',
      'customers.update',
      'customers.tags.manage',
      'customers.consents.manage',
      'customers.notes.manage',
      // CRM — vendas (operação diária; sem excluir pipelines)
      'deals.read',
      'deals.write',
      'activities.read',
      'activities.write',
      // Contratos (operação)
      'contracts.read',
      'contracts.write',
      // Ordens de Serviço (operação — sem deletar nem mexer em motivos)
      'service_orders.read',
      'service_orders.write',
      // Finance (operação — pode criar/baixar cobrança, sem mexer em caixa
      // nem aplicar desconto)
      'finance.charges.read',
      'finance.charges.write',
      // Reports (operador também pode ver)
      'reports.read',
    ],
  },
  {
    name: 'viewer',
    description: 'Acesso somente-leitura',
    priority: 100,
    permissions: [
      'tenants.read',
      'users.read',
      'roles.read',
      'customers.read',
      'deals.read',
      'activities.read',
      'contracts.read',
      'service_orders.read',
      'finance.charges.read',
      'reports.read',
    ],
  },
];

async function main() {
  console.log('🌱 Seeding NetX core database...');

  // 1. Permissions (global catalog)
  console.log('  → Permissions');
  for (const p of [
    ...corePermissions,
    ...crmPermissions,
    ...contractsPermissions,
    ...serviceOrdersPermissions,
    ...financePermissions,
    ...reportsPermissions,
    ...backupsPermissions,
  ]) {
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

  // 5. Default sales pipeline (idempotente)
  console.log('  → Default sales pipeline');
  const existingDefault = await prisma.pipeline.findFirst({
    where: { tenantId: tenant.id, slug: 'vendas' },
  });
  if (!existingDefault) {
    await prisma.pipeline.create({
      data: {
        tenantId: tenant.id,
        name: 'Vendas',
        slug: 'vendas',
        description: 'Funil padrão — lead → qualificação → proposta → negociação → fechamento',
        color: '#0ea5e9',
        isDefault: true,
        stages: {
          create: [
            { tenantId: tenant.id, name: 'Novo lead',        order: 0, probability: 10,  color: '#64748b' },
            { tenantId: tenant.id, name: 'Qualificado',      order: 1, probability: 25,  color: '#0ea5e9' },
            { tenantId: tenant.id, name: 'Proposta enviada', order: 2, probability: 50,  color: '#a855f7' },
            { tenantId: tenant.id, name: 'Negociação',       order: 3, probability: 75,  color: '#f59e0b' },
            { tenantId: tenant.id, name: 'Ganho',            order: 4, probability: 100, color: '#22c55e', isWon: true },
            { tenantId: tenant.id, name: 'Perdido',          order: 5, probability: 0,   color: '#ef4444', isLost: true },
          ],
        },
      },
    });
  }

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
